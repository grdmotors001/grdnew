import { Pool } from "pg";
import { ensurePinSchema, readPinToken, verifyPinHash, buildStaffSession, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from "../../../../lib/server/pin";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const pin = String(b.pin || "");
    const p = readPinToken(b.pin_token, "pin_verify");
    await ensurePinSchema(pool);
    const q = await pool.query('SELECT id, login_pin_hash, pin_failed_attempts, pin_locked_until FROM "user" WHERE id=$1 LIMIT 1', [p.sub]);
    const u = q.rows[0];
    if (!u) return Response.json({ error: "User not found." }, { status: 404 });
    if (!u.login_pin_hash) return Response.json({ error: "PIN is not set. Please login again." }, { status: 400 });

    if (u.pin_locked_until && new Date(u.pin_locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(u.pin_locked_until).getTime() - Date.now()) / 60000);
      return Response.json({ error: `Too many wrong PIN attempts. Try again in ${mins} min or ask admin to reset your PIN.` }, { status: 429 });
    }

    if (!verifyPinHash(u.login_pin_hash, pin)) {
      const attempts = Number(u.pin_failed_attempts || 0) + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        await pool.query(`UPDATE "user" SET pin_failed_attempts=0, pin_locked_until=now()+interval '${PIN_LOCK_MINUTES} minutes' WHERE id=$1`, [u.id]);
        return Response.json({ error: `Too many wrong PIN attempts. Locked for ${PIN_LOCK_MINUTES} minutes.` }, { status: 429 });
      }
      await pool.query('UPDATE "user" SET pin_failed_attempts=$1 WHERE id=$2', [attempts, u.id]);
      return Response.json({ error: `Wrong PIN. ${MAX_PIN_ATTEMPTS - attempts} attempt(s) left.` }, { status: 401 });
    }

    await pool.query('UPDATE "user" SET pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$1', [u.id]);
    const s = await buildStaffSession(pool, u.id);
    return Response.json(s.body, { status: s.status });
  } catch (e: any) {
    return Response.json({ error: e.message || "PIN verification failed" }, { status: 401 });
  }
}

import { Pool } from "pg";
import { ensurePinSchema, readPinToken, buildStaffSession } from "../../../../lib/server/pin";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

// Only a "pin_setup" token (password OK, no PIN set yet) can skip. Users who already have a PIN get a
// "pin_verify" token, so they can never bypass the PIN from here.
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const p = readPinToken(b.pin_token, "pin_setup");
    await ensurePinSchema(pool);
    const q = await pool.query('SELECT login_pin_hash FROM "user" WHERE id=$1 LIMIT 1', [p.sub]);
    if (!q.rows[0]) return Response.json({ error: "User not found." }, { status: 404 });
    if (q.rows[0].login_pin_hash) return Response.json({ error: "PIN already set. Please login again." }, { status: 400 });
    const s = await buildStaffSession(pool, Number(p.sub));
    return Response.json(s.body, { status: s.status });
  } catch (e: any) {
    return Response.json({ error: e.message || "Could not continue" }, { status: 401 });
  }
}

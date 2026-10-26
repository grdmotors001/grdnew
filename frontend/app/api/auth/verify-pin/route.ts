import { Pool } from "pg";
import { ensurePinSchema, readPinToken, verifyPinHash, buildStaffSession, buildDealerSession, pinStore, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from "../../../../lib/server/pin";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const pin = String(b.pin || "");
    const p = readPinToken(b.pin_token, "pin_verify");
    await ensurePinSchema(pool);
    const id = Number(p.sub), store = pinStore(pool, p.kind);
    const u: any = await store.get(id);
    if (u.missing) return Response.json({ error: "User not found." }, { status: 404 });
    if (!u.hash) return Response.json({ error: "PIN is not set. Please login again." }, { status: 400 });

    if (u.locked && new Date(u.locked).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(u.locked).getTime() - Date.now()) / 60000);
      return Response.json({ error: `Too many wrong PIN attempts. Try again in ${mins} min or ask admin to reset your PIN.` }, { status: 429 });
    }

    if (!verifyPinHash(u.hash, pin)) {
      const attempts = Number(u.attempts || 0) + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        await store.lock(id);
        return Response.json({ error: `Too many wrong PIN attempts. Locked for ${PIN_LOCK_MINUTES} minutes.` }, { status: 429 });
      }
      await store.fail(id, attempts);
      return Response.json({ error: `Wrong PIN. ${MAX_PIN_ATTEMPTS - attempts} attempt(s) left.` }, { status: 401 });
    }

    await store.clearFails(id);
    const s = p.kind === "dealer" ? await buildDealerSession(pool, id) : await buildStaffSession(pool, id);
    return Response.json(s.body, { status: s.status });
  } catch (e: any) {
    return Response.json({ error: e.message || "PIN verification failed" }, { status: 401 });
  }
}

import { Pool } from "pg";
import { ensurePinSchema, readPinToken, buildStaffSession, buildDealerSession, pinStore } from "../../../../lib/server/pin";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

// Only a "pin_setup" token (password OK, no PIN set yet) can skip. Users who already have a PIN get a
// "pin_verify" token, so they can never bypass the PIN from here.
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const p = readPinToken(b.pin_token, "pin_setup");
    await ensurePinSchema(pool);
    const cur: any = await pinStore(pool, p.kind).get(Number(p.sub));
    if (cur.missing) return Response.json({ error: "User not found." }, { status: 404 });
    if (cur.hash) return Response.json({ error: "PIN already set. Please login again." }, { status: 400 });
    const s = p.kind === "dealer" ? await buildDealerSession(pool, Number(p.sub)) : await buildStaffSession(pool, Number(p.sub));
    return Response.json(s.body, { status: s.status });
  } catch (e: any) {
    return Response.json({ error: e.message || "Could not continue" }, { status: 401 });
  }
}

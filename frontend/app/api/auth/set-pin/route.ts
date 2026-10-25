import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { ensurePinSchema, readPinToken, hashPin, isValidPin, buildStaffSession, jwtSecret } from "../../../../lib/server/pin";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

function verifyPassword(hash: string, password: string) {
  // same PBKDF2 / scrypt formats used by the login route
  let m = String(hash || "").match(/^pbkdf2:(sha1|sha256|sha512):(\d+)\$([^$]+)\$([^$]+)$/);
  if (m) {
    const actual = crypto.pbkdf2Sync(password, m[3], Number(m[2]), Math.floor(m[4].length / 2), m[1]).toString("hex");
    return actual.length === m[4].length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(m[4]));
  }
  m = String(hash || "").match(/^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([^$]+)$/);
  if (m) {
    const N = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
    const actual = crypto.scryptSync(password, m[4], Buffer.from(m[5], "hex").length, { N, r, p, maxmem: Math.max(128 * N * r + 1024, 64 * 1024 * 1024) }).toString("hex");
    return actual.length === m[5].length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(m[5]));
  }
  return false;
}

// Two ways to call:
//  1) Right after login (no PIN yet):  { pin_token, pin, confirm_pin }            -> sets PIN and returns the full session
//  2) From Profile (logged in):        Bearer token + { current_password, pin, confirm_pin }  -> sets/changes PIN
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const pin = String(b.pin || ""), confirm = String(b.confirm_pin ?? b.pin ?? "");
    if (!isValidPin(pin)) return Response.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
    if (pin !== confirm) return Response.json({ error: "PIN and confirm PIN do not match." }, { status: 400 });
    await ensurePinSchema(pool);

    if (b.pin_token) {
      const p = readPinToken(b.pin_token, "pin_setup");
      const q = await pool.query('SELECT login_pin_hash FROM "user" WHERE id=$1 LIMIT 1', [p.sub]);
      if (!q.rows[0]) return Response.json({ error: "User not found." }, { status: 404 });
      if (q.rows[0].login_pin_hash) return Response.json({ error: "PIN already set. Please login again." }, { status: 400 });
      await pool.query('UPDATE "user" SET login_pin_hash=$1, pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$2', [hashPin(pin), p.sub]);
      const s = await buildStaffSession(pool, Number(p.sub));
      return Response.json(s.body, { status: s.status });
    }

    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let a: any;
    try { a = jwt.verify(bearer, jwtSecret); } catch { return Response.json({ error: "Authentication required." }, { status: 401 }); }
    if (a.scope !== "staff") return Response.json({ error: "Staff PIN only." }, { status: 403 });
    const q = await pool.query('SELECT password_hash FROM "user" WHERE id=$1 LIMIT 1', [a.sub]);
    if (!q.rows[0]) return Response.json({ error: "User not found." }, { status: 404 });
    if (!verifyPassword(q.rows[0].password_hash, String(b.current_password || ""))) return Response.json({ error: "Current password is incorrect." }, { status: 400 });
    await pool.query('UPDATE "user" SET login_pin_hash=$1, pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$2', [hashPin(pin), a.sub]);
    return Response.json({ success: true, has_pin: true });
  } catch (e: any) {
    return Response.json({ error: e.message || "Could not set PIN" }, { status: 400 });
  }
}

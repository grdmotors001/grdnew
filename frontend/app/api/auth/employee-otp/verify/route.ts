import crypto from "crypto";
import { Pool } from "pg";
import { buildStaffSession } from "../../../../../lib/server/pin";
import { ensureOtpSchema, cleanMobile, findEmployeeUser, hashOtp, OTP_MAX_TRIES } from "../../../../../lib/server/employeeOtp";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const mobile = cleanMobile(b.mobile), otp = String(b.otp || "").replace(/\D/g, "");
    const bad = Response.json({ error: "OTP galat hai ya expire ho gaya." }, { status: 401 });
    if (mobile.length !== 10 || otp.length !== 6) return bad;
    await ensureOtpSchema(pool);
    const u = await findEmployeeUser(pool, mobile);
    if (!u) return bad;
    const row = (await pool.query("SELECT otp_hash,attempts,expires_at FROM employee_login_otp WHERE user_id=$1", [u.id])).rows[0];
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return bad;
    if (Number(row.attempts) >= OTP_MAX_TRIES) return Response.json({ error: "Bahut galat koshish. Naya OTP mangwayein." }, { status: 429 });
    const a = Buffer.from(hashOtp(u.id, otp)), c = Buffer.from(row.otp_hash);
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) {
      await pool.query("UPDATE employee_login_otp SET attempts=attempts+1 WHERE user_id=$1", [u.id]);
      return Response.json({ error: "OTP galat hai. " + Math.max(0, OTP_MAX_TRIES - Number(row.attempts) - 1) + " koshish baaki." }, { status: 401 });
    }
    await pool.query("DELETE FROM employee_login_otp WHERE user_id=$1", [u.id]); // OTP ek hi baar chalta hai
    const s = await buildStaffSession(pool, u.id);
    return Response.json(s.body, { status: s.status });
  } catch (e: any) {
    console.error("[employee-otp-verify]", e);
    return Response.json({ error: "OTP verify nahi ho saka." }, { status: 500 });
  }
}

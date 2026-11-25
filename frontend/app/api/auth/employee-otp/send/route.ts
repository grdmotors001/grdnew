import crypto from "crypto";
import { Pool } from "pg";
import { ensureOtpSchema, cleanMobile, findEmployeeUser, hashOtp, sendOtpMessage, OTP_TTL_MIN, OTP_RESEND_SEC, OTP_MAX_PER_HOUR } from "../../../../../lib/server/employeeOtp";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const GENERIC = { success: true, message: "Agar ye number registered hai to mobile par OTP bhej diya gaya hai." };

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const mobile = cleanMobile(b.mobile);
    if (mobile.length !== 10) return Response.json({ error: "10 anko ka mobile number likhein." }, { status: 400 });
    await ensureOtpSchema(pool);
    const u = await findEmployeeUser(pool, mobile);
    if (!u) return Response.json(GENERIC); // number registered hai ya nahi, ye bahar nahi batate
    const cur = (await pool.query("SELECT last_sent_at,window_start,sent_count FROM employee_login_otp WHERE user_id=$1", [u.id])).rows[0];
    if (cur) {
      const sinceSent = (Date.now() - new Date(cur.last_sent_at).getTime()) / 1000;
      if (sinceSent < OTP_RESEND_SEC) return Response.json({ error: "Naya OTP " + Math.ceil(OTP_RESEND_SEC - sinceSent) + " second baad mangwayein." }, { status: 429 });
      const inWindow = Date.now() - new Date(cur.window_start).getTime() < 3600_000;
      if (inWindow && Number(cur.sent_count) >= OTP_MAX_PER_HOUR) return Response.json({ error: "Bahut baar OTP mangwa liya. Ek ghante baad koshish karein." }, { status: 429 });
    }
    const otp = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO employee_login_otp (user_id,otp_hash,expires_at,attempts,last_sent_at,window_start,sent_count)
       VALUES ($1,$2,now()+($3||' minutes')::interval,0,now(),now(),1)
       ON CONFLICT (user_id) DO UPDATE SET otp_hash=EXCLUDED.otp_hash,expires_at=EXCLUDED.expires_at,attempts=0,last_sent_at=now(),
         window_start=CASE WHEN now()-employee_login_otp.window_start<interval '1 hour' THEN employee_login_otp.window_start ELSE now() END,
         sent_count=CASE WHEN now()-employee_login_otp.window_start<interval '1 hour' THEN employee_login_otp.sent_count+1 ELSE 1 END`,
      [u.id, hashOtp(u.id, otp), String(OTP_TTL_MIN)]);
    try { await sendOtpMessage(mobile, otp); }
    catch (e: any) {
      await pool.query("DELETE FROM employee_login_otp WHERE user_id=$1", [u.id]);
      return Response.json({ error: e.message || "OTP nahi bheja ja saka." }, { status: 502 });
    }
    return Response.json(GENERIC);
  } catch (e: any) {
    console.error("[employee-otp-send]", e);
    return Response.json({ error: "OTP nahi bheja ja saka." }, { status: 500 });
  }
}

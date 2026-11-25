import crypto from "crypto";

// Employee (sirf attendance wale login) ke liye WhatsApp OTP login ka common code.
export const OTP_TTL_MIN = 5;
export const OTP_MAX_TRIES = 5;
export const OTP_RESEND_SEC = 60;
export const OTP_MAX_PER_HOUR = 5;

const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";

export async function ensureOtpSchema(pool: any) {
  await pool.query("CREATE TABLE IF NOT EXISTS employee_login_otp (user_id bigint PRIMARY KEY, otp_hash text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, last_sent_at timestamptz NOT NULL DEFAULT now(), window_start timestamptz NOT NULL DEFAULT now(), sent_count integer NOT NULL DEFAULT 1)");
}

export const cleanMobile = (v: any) => String(v || "").replace(/\D/g, "").slice(-10);

export const hashOtp = (userId: any, otp: string) =>
  crypto.createHash("sha256").update(secret + ":" + String(userId) + ":" + otp).digest("hex");

// Sirf "employee login": employee se juda, super user/Admin nahi, aur koi module right nahi. Baaki users ko OTP nahi milta.
export async function findEmployeeUser(pool: any, mobile10: string) {
  if (mobile10.length !== 10) return null;
  const r = await pool.query(
    `SELECT u.id,u.username,u.department,u.is_super_user,u.allowed_modules
       FROM "user" u JOIN hr_employee e ON e.user_id=u.id AND e.active=true
      WHERE right(regexp_replace(COALESCE(u.mobile,''),'\\D','','g'),10)=$1 OR u.username=$1
      LIMIT 1`, [mobile10]);
  const u = r.rows[0];
  if (!u) return null;
  const mods = Array.isArray(u.allowed_modules) ? u.allowed_modules : String(u.allowed_modules || "").split(",");
  const hasMods = mods.map((x: any) => String(x).trim()).filter(Boolean).length > 0;
  const isAdmin = u.is_super_user === true || String(u.department || "").trim().toLowerCase() === "admin";
  return hasMods || isAdmin ? null : u;
}

// WhatsApp Cloud API: approved "Authentication" template se OTP bhejna.
export async function sendWhatsAppOtp(mobile10: string, otp: string) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID, template = process.env.WHATSAPP_OTP_TEMPLATE;
  if (!token || !phoneId || !template) throw new Error("WhatsApp OTP abhi configure nahi hai.");
  const res = await fetch("https://graph.facebook.com/v21.0/" + phoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: "91" + mobile10,
      type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_OTP_LANG || "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: otp }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
        ],
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[whatsapp-otp]", res.status, t.slice(0, 300));
    throw new Error("WhatsApp par OTP nahi bhej paye.");
  }
}

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
      WHERE right(regexp_replace(COALESCE(u.mobile,''),'\\D','','g'),10)=$1
         OR right(regexp_replace(COALESCE(e.mobile,''),'\\D','','g'),10)=$1 OR u.username=$1
      ORDER BY (right(regexp_replace(COALESCE(u.mobile,''),'\\D','','g'),10)=$1) DESC
      LIMIT 1`, [mobile10]);
  const u = r.rows[0];
  if (!u) return null;
  const mods = Array.isArray(u.allowed_modules) ? u.allowed_modules : String(u.allowed_modules || "").split(",");
  const hasMods = mods.map((x: any) => String(x).trim()).filter(Boolean).length > 0;
  const isAdmin = u.is_super_user === true || String(u.department || "").trim().toLowerCase() === "admin";
  return hasMods || isAdmin ? null : u;
}

// Fast2SMS (wallet wala, ₹100 se shuru): OTP route par "Your OTP: {#var#}" SMS jata hai.
// FAST2SMS_ROUTE: "otp" (default) ya "q" (Quick SMS, alag rate).
async function sendFast2Sms(mobile10: string, otp: string) {
  const key = process.env.FAST2SMS_API_KEY as string;
  const route = (process.env.FAST2SMS_ROUTE || "otp").trim();
  const body: any = route === "q"
    ? { route: "q", message: "Your GRD Motors login OTP is " + otp + ". Valid for " + OTP_TTL_MIN + " minutes. Do not share it.", numbers: mobile10, language: "english", flash: 0 }
    : { route: "otp", variables_values: otp, numbers: mobile10, flash: 0 };
  const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: { authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.return !== true) {
    console.error("[fast2sms-otp]", res.status, JSON.stringify(data).slice(0, 300));
    // Fast2SMS ka jawab secret nahi hota (jaise "recharge karein"), isliye wahi dikhate hain taaki kaaran pata chale.
    const why = Array.isArray(data?.message) ? data.message.join(" ") : String(data?.message || "");
    throw new Error("OTP SMS nahi bhej paye." + (why ? " Fast2SMS: " + why.slice(0, 200) : ""));
  }
}

// WhatsApp Cloud API (Meta): approved "Authentication" template se OTP.
async function sendMetaWhatsApp(mobile10: string, otp: string) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID, template = process.env.WHATSAPP_OTP_TEMPLATE;
  if (!token || !phoneId || !template) throw new Error("OTP abhi configure nahi hai.");
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
    // Meta ka asli kaaran (token/ID galat, template, payment...) dikhate hain taaki pata chale; isme secret nahi hota.
    let why = "";
    try { const j = JSON.parse(t); why = String(j?.error?.message || "") + (j?.error?.code ? " (code " + j.error.code + ")" : ""); } catch (_e) {}
    throw new Error("WhatsApp par OTP nahi bhej paye." + (why ? " Meta: " + why.slice(0, 200) : ""));
  }
  // Meta ne request accept ki; message ID log me rakhte hain (delivery ka status WhatsApp Manager me dikhta hai).
  const ok: any = await res.json().catch(() => ({}));
  console.log("[whatsapp-otp] accepted, message id:", ok?.messages?.[0]?.id || "-");
}

// Jo provider configure hai wahi use hoga: pehle Fast2SMS, nahi to Meta WhatsApp.
export async function sendOtpMessage(mobile10: string, otp: string) {
  if (process.env.FAST2SMS_API_KEY) return sendFast2Sms(mobile10, otp);
  return sendMetaWhatsApp(mobile10, otp);
}

// Sirf message ke liye: number kyun reject hua (login nahi bana / inactive / module access wala / mobile nahi mila).
export async function whyNoOtp(pool: any, mobile10: string): Promise<string> {
  const r = await pool.query(
    `SELECT e.active,e.user_id,u.is_super_user,u.department,u.allowed_modules
       FROM hr_employee e LEFT JOIN "user" u ON u.id=e.user_id
      WHERE right(regexp_replace(COALESCE(e.mobile,''),'\\D','','g'),10)=$1
         OR right(regexp_replace(COALESCE(u.mobile,''),'\\D','','g'),10)=$1 OR u.username=$1
      LIMIT 1`, [mobile10]);
  const x = r.rows[0];
  if (!x) return "Ye number kisi employee ya user me nahi mila. Employees me Mobile bharein.";
  if (x.active === false) return "Ye employee Disabled hai.";
  if (!x.user_id) return "Is employee ka login nahi bana. Employees me 'Login banayein' dabayein.";
  const mods = Array.isArray(x.allowed_modules) ? x.allowed_modules : String(x.allowed_modules || "").split(",");
  if (mods.map((m: any) => String(m).trim()).filter(Boolean).length > 0 || x.is_super_user === true || String(x.department || "").trim().toLowerCase() === "admin")
    return "Is user ke paas Module Access / Admin hai, isliye OTP login nahi chalega. Password se login karein.";
  return "Ye number registered nahi hai.";
}

// NIC IRP (e-Invoice + e-Way Bill) client. Server-side ONLY.
import crypto from "crypto";

const BASE = process.env.NIC_BASE_URL || "https://einv-apisandbox.nic.in";
const hdr = () => ({
  "Content-Type": "application/json",
  client_id: process.env.NIC_CLIENT_ID || "",
  client_secret: process.env.NIC_CLIENT_SECRET || "",
  gstin: process.env.NIC_GSTIN || "",
});

let cached: { token: string; expiry: number } | null = null;

export async function getAuthToken(): Promise<string> {
  if (cached && cached.expiry > Date.now() + 5 * 60_000) return cached.token;
  const appKey = crypto.randomBytes(32);
  const payload = JSON.stringify({
    UserName: process.env.NIC_USERNAME,
    Password: process.env.NIC_PASSWORD,
    AppKey: appKey.toString("base64"),
    ForceRefreshAccessToken: false,
  });
  const enc = crypto.publicEncrypt(
    { key: (process.env.NIC_PUBLIC_KEY || "").replace(/\\n/g, "\n"), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(payload)
  );
  const res = await fetch(`${BASE}/eivital/v1.04/auth`, { method: "POST", headers: hdr(), body: JSON.stringify({ Data: enc.toString("base64") }) });
  const j = await res.json();
  if (j.Status !== 1) throw new Error("NIC auth failed: " + JSON.stringify(j.ErrorDetails ?? j));
  const exp = String(j.Data.TokenExpiry || "").replace(" ", "T");
  cached = { token: j.Data.AuthToken, expiry: exp ? new Date(exp + "+05:30").getTime() : Date.now() + 5 * 3600_000 };
  return cached.token;
}

export async function nicPost(path: string, body: unknown) {
  const token = await getAuthToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...hdr(), user_name: process.env.NIC_USERNAME || "", AuthToken: token },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const errText = (j: any) =>
  Array.isArray(j?.ErrorDetails) ? j.ErrorDetails.map((e: any) => `${e.ErrorCode}: ${e.ErrorMessage}`).join(" | ") : JSON.stringify(j?.ErrorDetails ?? j);

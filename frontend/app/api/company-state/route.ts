import jwt from "jsonwebtoken";
import { pool } from "../../../lib/server/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";
function auth(req: Request) { const h = req.headers.get("authorization") || "", t = h.startsWith("Bearer ") ? h.slice(7) : ""; if (!t) return null; try { return jwt.verify(t, secret) as any } catch { return null } }

// Seller (company) GST state code only. Any logged-in user may read this, because Intra/Inter on every invoice form needs it,
// while the full /company record is permission-gated (users without Company Master rights got 403 and Intra/Inter never updated).
export async function GET(req: Request) {
  if (!auth(req)) return Response.json({ error: "Authentication required." }, { status: 401 });
  const r = await pool.query("SELECT state_code, to_jsonb(c)->>'gst_no' AS gst_no FROM company c ORDER BY id DESC LIMIT 1").catch(() => ({ rows: [] as any[] }));
  const x = r.rows[0] || {}, sc = String(x.state_code ?? "").trim(), g = String(x.gst_no ?? "").trim().slice(0, 2);
  const code = /^\d{1,2}$/.test(sc) ? sc.padStart(2, "0") : /^\d{2}$/.test(g) ? g : "";
  return Response.json({ state_code: code });
}

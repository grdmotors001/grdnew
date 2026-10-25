import jwt from "jsonwebtoken";
import pins from "../../../../lib/pincode-data.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";
function auth(req: Request) { const h = req.headers.get("authorization") || "", t = h.startsWith("Bearer ") ? h.slice(7) : ""; if (!t) return null; try { return jwt.verify(t, secret) as any } catch { return null } }

// GET /api/pincode/110001  ->  { pin: "110001", state: "DELHI" }   (state is one of lib/states.js names)
export async function GET(req: Request, { params }: { params: Promise<{ pin: string }> }) {
  if (!auth(req)) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { pin } = await params;
  const state = (pins as Record<string, string>)[String(pin || "").trim()] || "";
  return Response.json({ pin, state });
}

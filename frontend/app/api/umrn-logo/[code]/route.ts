import { pool } from "../../../../lib/server/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/umrn-logo/<UMRN code>  -> logo image from the database (404 when none; callers then fall back to /UMRN/ static files).
// Public on purpose: <img> tags cannot send the login token, and a product logo is not sensitive.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const key = decodeURIComponent(String(code || "")).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(key)) return new Response("Not found", { status: 404 });
  const r = await pool.query("SELECT data, content_type FROM umrn_logo WHERE code_key=$1", [key]).catch(() => ({ rows: [] as any[] }));
  if (!r.rows.length) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=30" } });
  return new Response(r.rows[0].data, { headers: { "Content-Type": r.rows[0].content_type || "image/jpeg", "Cache-Control": "public, max-age=60" } });
}

import { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  if (!process.env.DATABASE_URL) {
    return Response.json({ status: "degraded", backend: "node", database: "not_configured", python: false }, { status: 503 });
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("SELECT 1");
    return Response.json({ status: "ok", backend: "node", database: "ok", python: false, latency_ms: Date.now() - started });
  } catch (error: any) {
    return Response.json({ status: "degraded", backend: "node", database: "error", python: false, error: error?.message || "database connection failed" }, { status: 503 });
  } finally {
    await pool.end().catch(() => {});
  }
}

import jwt from "jsonwebtoken";
import { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: { rejectUnauthorized: false } });
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";

function auth(req: Request) {
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  try { return jwt.verify(t, secret) as any } catch { return null }
}

function isAdmin(a: any) {
  return !!a && a.scope === "staff" &&
    (Boolean(a.is_super_user) || String(a.department || "").trim().toLowerCase() === "admin");
}

const EXCLUDE_TABLES = new Set(["_prisma_migrations"]);

async function listTables(): Promise<string[]> {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return r.rows.map((row: any) => row.table_name).filter((n: string) => !EXCLUDE_TABLES.has(n));
}

export async function GET(req: Request) {
  const a = auth(req);
  if (!a) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isAdmin(a)) return Response.json({ error: "Forbidden. Admin only." }, { status: 403 });

  try {
    const tableNames = await listTables();
    const tables: Record<string, any[]> = {};
    for (const name of tableNames) {
      const q = await pool.query(`SELECT * FROM "\${name}"`);
      tables[name] = q.rows;
    }
    const payload = {
      app: "grd-ebill-next",
      version: 1,
      exported_at: new Date().toISOString(),
      table_count: tableNames.length,
      tables,
    };
    const filename = `grd-backup-\${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="\${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("[backup GET]", e);
    return Response.json({ error: e.message || "Backup export failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const a = auth(req);
  if (!a) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isAdmin(a)) return Response.json({ error: "Forbidden. Admin only." }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid backup file: not valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !body.tables || typeof body.tables !== "object") {
    return Response.json({ error: "Invalid backup file: missing 'tables' object." }, { status: 400 });
  }

  const knownTables = new Set(await listTables());
  const results: Record<string, { restored: number; skipped?: string; error?: string }> = {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [name, rows] of Object.entries(body.tables as Record<string, any[]>)) {
      if (EXCLUDE_TABLES.has(name)) continue;
      if (!knownTables.has(name)) {
        results[name] = { restored: 0, skipped: "Table does not exist in this database." };
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        results[name] = { restored: 0 };
        continue;
      }
      try {
        let restored = 0;
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const colList = cols.map((c) => `"\${c}"`).join(",");
          const placeholders = cols.map((_, i) => `$\${i + 1}`).join(",");
          const vals = cols.map((c) => row[c]);
          let sql: string;
          if (cols.includes("id")) {
            const updates = cols.filter((c) => c !== "id").map((c) => `"\${c}"=EXCLUDED."\${c}"`).join(",");
            sql = updates
              ? `INSERT INTO "\${name}" (\${colList}) VALUES (\${placeholders}) ON CONFLICT (id) DO UPDATE SET \${updates}`
              : `INSERT INTO "\${name}" (\${colList}) VALUES (\${placeholders}) ON CONFLICT (id) DO NOTHING`;
          } else {
            sql = `INSERT INTO "\${name}" (\${colList}) VALUES (\${placeholders})`;
          }
          await client.query(sql, vals);
          restored++;
        }
        if (rows[0] && Object.prototype.hasOwnProperty.call(rows[0], "id")) {
          try {
            await client.query(
              `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "\${name}"), 1))`,
              [name]
            );
          } catch {
            // Table has no serial "id" sequence; safe to skip.
          }
        }
        results[name] = { restored };
      } catch (tableErr: any) {
        results[name] = { restored: 0, error: tableErr.message || "Restore failed for this table" };
      }
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error("[backup POST]", e);
    return Response.json({ error: e.message || "Restore failed" }, { status: 500 });
  } finally {
    client.release();
  }

  return Response.json({ success: true, results });
}

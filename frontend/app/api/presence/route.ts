import jwt from "jsonwebtoken";
import { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";
const ONLINE_SECONDS = 120;   // heartbeat 60s; 2 min se zyada silent = offline
const SESSION_GAP_SECONDS = 600; // 10 min se zyada gap ho to naya login maana jata hai

let ready: Promise<any> | null = null;
function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS user_presence (
        user_key text PRIMARY KEY, kind text NOT NULL, user_id text NOT NULL, name text, role text,
        logged_in_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function auth(req: Request): any {
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  try {
    const p: any = jwt.verify(t, secret);
    if (p.pending) return null;
    return p;
  } catch { return null; }
}

async function isAdmin(p: any) {
  if (p.scope !== "staff") return false;
  const q = await pool.query('SELECT is_super_user, department FROM "user" WHERE id=$1 LIMIT 1', [p.sub]);
  const u = q.rows[0];
  if (!u) return false;
  return !!u.is_super_user || String(u.department || "").trim().toLowerCase() === "admin";
}

// Heartbeat: har logged-in staff/dealer ka tab yahan ping karta hai.
export async function POST(req: Request) {
  try {
    const p = auth(req);
    if (!p) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureTable();
    let kind = "", name = "", role = "";
    if (p.scope === "dealer") {
      kind = "dealer";
      const q = await pool.query("SELECT name, code FROM dealer WHERE id=$1 LIMIT 1", [p.sub]);
      name = q.rows[0]?.name || p.username || "Dealer";
      role = "Dealer";
    } else {
      kind = "staff";
      const q = await pool.query('SELECT username, department, is_super_user FROM "user" WHERE id=$1 LIMIT 1', [p.sub]);
      const u = q.rows[0];
      name = u?.username || p.username || "Staff";
      role = u?.is_super_user ? "Super User" : (u?.department || "Staff");
    }
    const key = kind + ":" + p.sub;
    await pool.query(
      `INSERT INTO user_presence (user_key, kind, user_id, name, role, logged_in_at, last_seen)
       VALUES ($1,$2,$3,$4,$5, now(), now())
       ON CONFLICT (user_key) DO UPDATE SET
         name=EXCLUDED.name, role=EXCLUDED.role,
         logged_in_at = CASE WHEN user_presence.last_seen < now() - ($6 || ' seconds')::interval THEN now() ELSE user_presence.logged_in_at END,
         last_seen = now()`,
      [key, kind, String(p.sub), name, role, String(SESSION_GAP_SECONDS)]
    );
    return Response.json({ ok: true });
  } catch (e: any) {
    console.error("[presence-post]", e);
    return Response.json({ error: e.message || "presence failed" }, { status: 500 });
  }
}

// Sirf admin: kaun online hai / kaun kab last dikha.
export async function GET(req: Request) {
  try {
    const p = auth(req);
    if (!p) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(p))) return Response.json({ error: "Admin only" }, { status: 403 });
    await ensureTable();
    const q = await pool.query(
      `SELECT user_key, kind, name, role, logged_in_at, last_seen,
              (last_seen > now() - ($1 || ' seconds')::interval) AS online
       FROM user_presence
       WHERE last_seen > now() - interval '24 hours'
       ORDER BY online DESC, last_seen DESC`,
      [String(ONLINE_SECONDS)]
    );
    return Response.json({ users: q.rows, online_count: q.rows.filter((r: any) => r.online).length });
  } catch (e: any) {
    console.error("[presence-get]", e);
    return Response.json({ error: e.message || "presence failed" }, { status: 500 });
  }
}

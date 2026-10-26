import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";

export const jwtSecret = process.env.JWT_SECRET || "grd-node-change-this-secret";
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

let pinSchemaReady: Promise<void> | null = null;
// Login PIN columns on "user". Runs once per server instance.
export function ensurePinSchema(pool: Pool): Promise<void> {
  if (!pinSchemaReady) {
    pinSchemaReady = (async () => {
      await pool.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS login_pin_hash text');
      await pool.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0');
      await pool.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz');
      // Dealer PIN alag table me (dealer table generic list/edit APIs se nikalti hai, hash wahan se leak na ho).
      await pool.query("CREATE TABLE IF NOT EXISTS dealer_login_pin (dealer_id integer PRIMARY KEY,pin_hash text NOT NULL,failed_attempts integer NOT NULL DEFAULT 0,locked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())");
    })().catch((e) => { pinSchemaReady = null; throw e; });
  }
  return pinSchemaReady;
}

export function isValidPin(pin: string) {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "pbkdf2:sha256:100000$" + salt + "$" + crypto.pbkdf2Sync(pin, salt, 100000, 32, "sha256").toString("hex");
}

export function verifyPinHash(hash: string, pin: string) {
  const m = String(hash || "").match(/^pbkdf2:sha256:(\d+)\$([^$]+)\$([^$]+)$/);
  if (!m) return false;
  const actual = crypto.pbkdf2Sync(pin, m[2], Number(m[1]), 32, "sha256").toString("hex");
  return actual.length === m[3].length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(m[3]));
}

export type PinKind = "staff" | "dealer";

// Short-lived token issued after a correct password. purpose: "pin_verify" (PIN already set) or "pin_setup" (no PIN yet).
// kind "dealer": sub = dealer.id.
export function signPinToken(user: any, purpose: "pin_verify" | "pin_setup", kind: PinKind = "staff") {
  return jwt.sign({ pin_step: purpose, kind, sub: user.id, username: user.username }, jwtSecret, { expiresIn: "10m" });
}

export function readPinToken(token: string, purpose: "pin_verify" | "pin_setup") {
  const p: any = jwt.verify(String(token || ""), jwtSecret);
  if (p.pin_step !== purpose) throw new Error("Session expired. Please login again.");
  p.kind = p.kind === "dealer" ? "dealer" : "staff";
  return p;
}

// Staff PIN "user" table me, Dealer PIN dealer_login_pin me. Dono ke liye ek hi interface.
export function pinStore(pool: Pool, kind: PinKind) {
  if (kind === "dealer") {
    return {
      async get(id: number) {
        const r = await pool.query("SELECT pin_hash AS hash, failed_attempts AS attempts, locked_until AS locked FROM dealer_login_pin WHERE dealer_id=$1::int", [id]);
        return r.rows[0] || { hash: null, attempts: 0, locked: null };
      },
      async set(id: number, hash: string) {
        await pool.query("INSERT INTO dealer_login_pin (dealer_id,pin_hash,failed_attempts,locked_until,updated_at) VALUES ($1::int,$2::text,0,NULL,now()) ON CONFLICT (dealer_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,failed_attempts=0,locked_until=NULL,updated_at=now()", [id, hash]);
      },
      async fail(id: number, attempts: number) { await pool.query("UPDATE dealer_login_pin SET failed_attempts=$1::int WHERE dealer_id=$2::int", [attempts, id]); },
      async lock(id: number) { await pool.query(`UPDATE dealer_login_pin SET failed_attempts=0, locked_until=now()+interval '${PIN_LOCK_MINUTES} minutes' WHERE dealer_id=$1::int`, [id]); },
      async clearFails(id: number) { await pool.query("UPDATE dealer_login_pin SET failed_attempts=0, locked_until=NULL WHERE dealer_id=$1::int", [id]); },
      async reset(id: number) { await pool.query("DELETE FROM dealer_login_pin WHERE dealer_id=$1::int", [id]); },
    };
  }
  return {
    async get(id: number) {
      const r = await pool.query('SELECT login_pin_hash AS hash, pin_failed_attempts AS attempts, pin_locked_until AS locked FROM "user" WHERE id=$1 LIMIT 1', [id]);
      return r.rows[0] || { hash: null, attempts: 0, locked: null, missing: true };
    },
    async set(id: number, hash: string) { await pool.query('UPDATE "user" SET login_pin_hash=$1, pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$2', [hash, id]); },
    async fail(id: number, attempts: number) { await pool.query('UPDATE "user" SET pin_failed_attempts=$1 WHERE id=$2', [attempts, id]); },
    async lock(id: number) { await pool.query(`UPDATE "user" SET pin_failed_attempts=0, pin_locked_until=now()+interval '${PIN_LOCK_MINUTES} minutes' WHERE id=$1`, [id]); },
    async clearFails(id: number) { await pool.query('UPDATE "user" SET pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$1', [id]); },
    async reset(id: number) { await pool.query('UPDATE "user" SET login_pin_hash=NULL,pin_failed_attempts=0,pin_locked_until=NULL WHERE id=$1', [id]); },
  };
}

// Final dealer session (same payload jo login route pehle seedha deta tha).
export async function buildDealerSession(pool: Pool, dealerId: number) {
  const q = await pool.query("SELECT * FROM dealer WHERE id=$1::int LIMIT 1", [dealerId]);
  const dealer = q.rows[0];
  if (!dealer || dealer.blocked) return { status: 403, body: { error: "Dealer login is blocked or not found." } };
  const portalModules = String(dealer.portal_modules || "").replace(/[{}"\[\]]/g, "").split(",").map((x: string) => x.trim()).filter(Boolean);
  const safeDealer = {
    id: dealer.id, code: dealer.code, name: dealer.name, login_id: dealer.login_id,
    dealer_category: dealer.dealer_category || "dealer", registration_type: dealer.registration_type || "registered",
    purchase_access: Boolean(dealer.purchase_access) && String(dealer.registration_type || "registered").toLowerCase() !== "unregistered",
    portal_modules: portalModules,
    state: dealer.state || "", state_code: dealer.state_code || "", bank_name: dealer.bank_name || "", bank_account_no: dealer.bank_account_no || "", bank_ifsc: dealer.bank_ifsc || "",
  };
  const token = jwt.sign({ sub: dealer.id, username: dealer.login_id, dealer_id: dealer.id, scope: "dealer", portal_modules: portalModules, role: "dealer" }, jwtSecret, { expiresIn: "12h" });
  return { status: 200, body: { success: true, token, dealer: safeDealer, user: safeDealer, portal: "dealer", role: "dealer" } };
}

// Final staff session (same payload the old verify-otp route returned).
export async function buildStaffSession(pool: Pool, userId: number) {
  const q = await pool.query('SELECT * FROM "user" WHERE id=$1 LIMIT 1', [userId]);
  const u = q.rows[0];
  if (!u) return { status: 404, body: { error: "User not found." } };
  const { password_hash, login_pin_hash, pin_failed_attempts, pin_locked_until, ...safe } = u;
  const allowedModules = Array.isArray(u.allowed_modules)
    ? u.allowed_modules.map((x: any) => String(x))
    : String(u.allowed_modules || "").split(",").map((x: string) => x.trim()).filter(Boolean);
  const safeOut = { ...safe, has_pin: Boolean(login_pin_hash) };

  if (String(u.department || "").trim().toLowerCase() === "salesman") {
    let assigned: any[] = [];
    try {
      assigned = Array.isArray(u.assigned_dealer_ids)
        ? u.assigned_dealer_ids.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0)
        : JSON.parse(String(u.assigned_dealer_ids || "[]")).map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
    } catch { assigned = []; }
    if (!assigned.length) {
      const dr = await pool.query("SELECT id FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1)) AND COALESCE(blocked,false)=false ORDER BY id", [u.username]);
      assigned = dr.rows.map((x: any) => Number(x.id)).filter(Boolean);
    }
    const token = jwt.sign({ sub: u.id, username: u.username, scope: "staff", role: "salesman", is_super_user: Boolean(u.is_super_user), department: u.department || "Salesman", allowed_modules: allowedModules, assigned_dealer_ids: assigned }, jwtSecret, { expiresIn: "12h" });
    return { status: 200, body: { success: true, token, user: { ...safeOut, assigned_dealer_ids: assigned }, portal: "staff", role: "Salesman", assigned_dealer_ids: assigned } };
  }

  const token = jwt.sign({ sub: u.id, username: u.username, scope: "staff", is_super_user: Boolean(u.is_super_user), department: u.department || "", allowed_modules: allowedModules, assigned_dealer_ids: u.assigned_dealer_ids || [] }, jwtSecret, { expiresIn: "12h" });
  return { status: 200, body: { success: true, token, user: safeOut, portal: "staff", role: u.department || "staff" } };
}

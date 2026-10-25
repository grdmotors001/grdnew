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

// Short-lived token issued after a correct password. purpose: "pin_verify" (PIN already set) or "pin_setup" (no PIN yet).
export function signPinToken(user: any, purpose: "pin_verify" | "pin_setup") {
  return jwt.sign({ pin_step: purpose, sub: user.id, username: user.username }, jwtSecret, { expiresIn: "10m" });
}

export function readPinToken(token: string, purpose: "pin_verify" | "pin_setup") {
  const p: any = jwt.verify(String(token || ""), jwtSecret);
  if (p.pin_step !== purpose) throw new Error("Session expired. Please login again.");
  return p;
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

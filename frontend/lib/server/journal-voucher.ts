// F10 Journal Voucher: 2-3 (ya zyada) party ki Dr / Cr entry, ek date aur ek remark ke saath.
// Total Dr = Total Cr hona zaruri. Ye voucher abhi apni hi table me save hota hai (Cash Book / Day Book me nahi jata).
import { pool, num, idOf, ymd, todayDate } from "./common";
import { audit, actionAllowed } from "./permissions";

export const JV_MODULE = "v-f10"; // menu key (Action Rights / Module Access)
const MAX_LINES = 10;
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

let ready: Promise<void> | null = null;
export function ensureJournalSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS journal_voucher (
        id bigserial PRIMARY KEY, vr_no integer, date date NOT NULL DEFAULT CURRENT_DATE, narration text,
        total numeric NOT NULL DEFAULT 0, created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS journal_voucher_line (
        id bigserial PRIMARY KEY, voucher_id bigint NOT NULL, party_name text NOT NULL, side text NOT NULL,
        amount numeric NOT NULL DEFAULT 0, sort_no integer NOT NULL DEFAULT 0)`);
      await pool.query("CREATE INDEX IF NOT EXISTS journal_voucher_date_idx ON journal_voucher(date DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS journal_voucher_line_v_idx ON journal_voucher_line(voucher_id)");
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const who = (a: any) => String(a?.username || a?.sub || "");
const r2 = (n: number) => Math.round(n * 100) / 100;

// Body check: date, kam se kam 1 Dr + 1 Cr party, amount > 0, Dr total = Cr total.
export function validateJournal(b: any) {
  const date = ymd(b.date) || todayDate();
  const raw = Array.isArray(b.lines) ? b.lines : [];
  if (raw.length < 2) throw fail("Kam se kam 2 party chahiye (ek Dr, ek Cr).");
  if (raw.length > MAX_LINES) throw fail("Ek voucher me max " + MAX_LINES + " party.");
  const lines = raw.map((x: any, i: number) => ({
    party_name: String(x?.party_name || "").trim(),
    side: String(x?.side || "").trim().toUpperCase() === "CR" ? "Cr" : String(x?.side || "").trim().toUpperCase() === "DR" ? "Dr" : "",
    amount: r2(num(x?.amount)), sort_no: i + 1,
  }));
  lines.forEach((l: any, i: number) => {
    if (!l.party_name) throw fail("Line " + (i + 1) + ": party select karo.");
    if (!l.side) throw fail("Line " + (i + 1) + ": Dr ya Cr chuno.");
    if (!(l.amount > 0)) throw fail("Line " + (i + 1) + ": amount 0 se zyada hona chahiye.");
  });
  const seen = new Set<string>();
  for (const l of lines) {
    const k = l.party_name.toLowerCase() + "|" + l.side;
    if (seen.has(k)) throw fail(l.party_name + " ek hi side (" + l.side + ") par do baar hai.");
    seen.add(k);
  }
  const dr = r2(lines.filter((l: any) => l.side === "Dr").reduce((s: number, l: any) => s + l.amount, 0));
  const cr = r2(lines.filter((l: any) => l.side === "Cr").reduce((s: number, l: any) => s + l.amount, 0));
  if (!dr || !cr) throw fail("Ek Dr aur ek Cr party zaruri hai.");
  if (Math.abs(dr - cr) > 0.005) throw fail("Total Dr (" + dr + ") aur total Cr (" + cr + ") barabar nahi hain.");
  return { date, narration: String(b.narration ?? b.remark ?? "").trim(), lines, total: dr };
}

async function withLines(rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const ls = (await pool.query("SELECT * FROM journal_voucher_line WHERE voucher_id=ANY($1::bigint[]) ORDER BY voucher_id,sort_no,id", [ids])).rows;
  const m = new Map<number, any[]>();
  for (const l of ls) { const k = Number(l.voucher_id); (m.get(k) || m.set(k, []).get(k)!).push({ id: Number(l.id), party_name: l.party_name, side: l.side, amount: num(l.amount) }); }
  return rows.map((r) => {
    const lines = m.get(Number(r.id)) || [];
    return { ...r, id: Number(r.id), date: ymd(r.date), total: num(r.total), voucher_no: "JV-" + (r.vr_no ?? r.id), lines,
      dr_parties: lines.filter((l) => l.side === "Dr").map((l) => l.party_name), cr_parties: lines.filter((l) => l.side === "Cr").map((l) => l.party_name) };
  });
}

export async function journalGet(req: Request): Promise<Response> {
  await ensureJournalSchema();
  const u = new URL(req.url), q = (k: string) => String(u.searchParams.get(k) || "").trim();
  const args: any[] = [], w: string[] = [];
  if (q("from")) { args.push(q("from")); w.push("v.date>=$" + args.length); }
  if (q("to")) { args.push(q("to")); w.push("v.date<=$" + args.length); }
  if (q("search")) {
    args.push("%" + q("search") + "%"); const n = args.length;
    w.push(`(COALESCE(v.narration,'') ILIKE $${n} OR ('JV-'||COALESCE(v.vr_no::text,'')) ILIKE $${n} OR EXISTS (SELECT 1 FROM journal_voucher_line l WHERE l.voucher_id=v.id AND l.party_name ILIKE $${n}))`);
  }
  const r = await pool.query("SELECT v.* FROM journal_voucher v" + (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY v.date DESC,v.id DESC LIMIT 1000", args);
  const rows = await withLines(r.rows);
  const next = Number((await pool.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM journal_voucher")).rows[0]?.n || 1);
  // Party dropdown: Party Master + Financer + Dealers.
  const sm = await pool.query("SELECT DISTINCT btrim(name) AS name, lower(kind) AS kind FROM simple_master WHERE lower(kind) IN ('party','financer') AND COALESCE(btrim(name),'')<>'' ORDER BY 1").catch(() => ({ rows: [] as any[] }));
  const dl = await pool.query("SELECT btrim(name) AS name FROM dealer WHERE COALESCE(btrim(name),'')<>'' ORDER BY 1").catch(() => ({ rows: [] as any[] }));
  const seen = new Set<string>(), parties: { name: string; group: string }[] = [];
  const add = (name: string, group: string) => { const k = name.toLowerCase(); if (!seen.has(k)) { seen.add(k); parties.push({ name, group }); } };
  sm.rows.forEach((x: any) => add(String(x.name), x.kind === "financer" ? "Financer" : "Party"));
  dl.rows.forEach((x: any) => add(String(x.name), "Dealer"));
  return Response.json({ rows, count: rows.length, next_vr_no: next, parties });
}

export async function journalSave(b: any, a: any): Promise<Response> {
  await ensureJournalSchema();
  const v = validateJournal(b);
  const id = idOf(b.id);
  if (id && !(await actionAllowed(a, JV_MODULE, "edit"))) return Response.json({ error: "Forbidden." }, { status: 403 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let vid: number, vr: number, old: any = null;
    if (id) {
      const cur = await client.query("SELECT * FROM journal_voucher WHERE id=$1 FOR UPDATE", [id]);
      if (!cur.rowCount) throw fail("Journal voucher nahi mila.", 404);
      old = (await withLines(cur.rows))[0]; vid = id; vr = cur.rows[0].vr_no;
      await client.query("UPDATE journal_voucher SET date=$1,narration=$2,total=$3,updated_by=$4,updated_at=NOW() WHERE id=$5", [v.date, v.narration, v.total, who(a), id]);
      await client.query("DELETE FROM journal_voucher_line WHERE voucher_id=$1", [id]);
    } else {
      await client.query("SELECT pg_advisory_xact_lock(7710001)"); // Vr. No. duplicate na ho
      vr = Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM journal_voucher")).rows[0].n);
      const ins = await client.query("INSERT INTO journal_voucher (vr_no,date,narration,total,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [vr, v.date, v.narration, v.total, who(a)]);
      vid = Number(ins.rows[0].id);
    }
    for (const l of v.lines) await client.query("INSERT INTO journal_voucher_line (voucher_id,party_name,side,amount,sort_no) VALUES ($1,$2,$3,$4,$5)", [vid, l.party_name, l.side, l.amount, l.sort_no]);
    await client.query("COMMIT");
    const saved = (await withLines((await pool.query("SELECT * FROM journal_voucher WHERE id=$1", [vid])).rows))[0];
    await audit(a, JV_MODULE, id ? "edit" : "create", vid, old, saved, null, saved.voucher_no);
    return Response.json({ success: true, voucher: saved }, { status: id ? 200 : 201 });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function journalDelete(id: number, a: any): Promise<Response> {
  await ensureJournalSchema();
  const cur = await pool.query("SELECT * FROM journal_voucher WHERE id=$1", [id]);
  if (!cur.rowCount) return Response.json({ error: "Journal voucher nahi mila." }, { status: 404 });
  const old = (await withLines(cur.rows))[0];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM journal_voucher_line WHERE voucher_id=$1", [id]);
    await c.query("DELETE FROM journal_voucher WHERE id=$1", [id]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  await audit(a, JV_MODULE, "delete", id, old, null, null, old.voucher_no);
  return Response.json({ success: true });
}

// Validation (400/403/404) log nahi hota; sirf asli server error (500) console me aata hai.
export const journalErr = (e: any) => {
  const status = e?.status || 500;
  if (status >= 500) console.error("[journal-voucher]", e);
  return Response.json({ error: e?.message || "Internal server error" }, { status });
};

// RC Fee Voucher (Old Rickshaw) + RC Issued Register.
// Alag file me hai taaki bada route file (app/api/[...path]/route.ts) aur na badhe.
//
// Flow: Old Rickshaw Inventory se sirf jin gaadiyon ko RC fee deni hai unhe tick karo -> ek hi voucher (expense_type='rc_fee')
// banta hai expense_payment_voucher me (lines = gaadiyan). Approval / Mark Paid / Cash Book posting purane
// "Expense Payment Voucher" page se hi hoti hai (wahi code, koi duplicate logic nahi).
// Har gaadi ki ek row rc_issued_register me banti hai; RC aane par "Mark RC Issued" se date + RC no. bharte hain.
import { pool, auth, isStaff, num, idOf, ymd, todayYmd, jerr, tableColumns } from "../../../../lib/server/common";
import { actionAllowed } from "../../../../lib/server/permissions";

// Menu / Action Rights key of this page (lib/menu.js).
const MODULE_KEY = "rc-fee-voucher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let ready: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      // Voucher tables (Expense Payment Voucher ke saath share hoti hain; pehle se ho to kuch nahi badalta).
      await pool.query("CREATE TABLE IF NOT EXISTS expense_payment_voucher (id bigserial PRIMARY KEY,voucher_no text,date date NOT NULL DEFAULT CURRENT_DATE,expense_type text,pay_to_name text,amount numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())");
      const defs: any = {
        expense_type_name: "text", pay_to_type: "text", dealer_id: "integer", staff_name: "text", vehicle_id: "integer", chassis_no: "text",
        customer_name: "text", bill_no: "text", payment_mode: "text DEFAULT 'cash'", remarks: "text", attachment_url: "text",
        work_model_name: "text", work_qty: "numeric", rate_per_unit: "numeric", on_account: "boolean DEFAULT false",
        payment_status: "text DEFAULT 'unpaid'", approved_by: "text", approved_at: "timestamptz", reject_reason: "text",
        paid_at: "timestamptz", paid_by: "text", day_book_id: "bigint", account_head: "text", account_sub_category: "text", created_by: "text"
      };
      for (const c of Object.keys(defs)) await pool.query('ALTER TABLE expense_payment_voucher ADD COLUMN IF NOT EXISTS "' + c + '" ' + defs[c]);
      await pool.query("CREATE TABLE IF NOT EXISTS expense_payment_voucher_line (id bigserial PRIMARY KEY,voucher_id bigint NOT NULL,vehicle_id integer,chassis_no text,customer_name text,bill_no text,model_name text,amount numeric NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS epv_line_voucher_idx ON expense_payment_voucher_line(voucher_id)");
      // RC Issued Register: har gaadi ki RC fee + RC mili ya nahi.
      await pool.query(`CREATE TABLE IF NOT EXISTS rc_issued_register (
        id bigserial PRIMARY KEY,
        inventory_id bigint NOT NULL,
        vehicle_no text,
        model_name text,
        voucher_id bigint NOT NULL,
        fee_amount numeric NOT NULL DEFAULT 0,
        fee_date date,
        rc_issued boolean NOT NULL DEFAULT false,
        rc_issued_date date,
        rc_no text,
        remarks text,
        issued_by text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS rc_issued_register_inv_idx ON rc_issued_register(inventory_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS rc_issued_register_voucher_idx ON rc_issued_register(voucher_id)");
    })().catch((e: any) => { ready = null; throw e; });
  }
  return ready;
}

const LIVE = "lower(COALESCE(v.status,'')) NOT IN ('rejected','cancelled','canceled')";

export async function GET(req: Request) {
  const a = auth(req);
  if (!isStaff(a)) return jerr("Login required.", 401);
  if (!(await actionAllowed(a, MODULE_KEY, "view"))) return jerr("Forbidden.", 403);
  try {
    await ensureSchema();
    const u = new URL(req.url);
    const search = String(u.searchParams.get("search") || "").trim();
    const st = String(u.searchParams.get("status") || "all").toLowerCase();

    // Party Master me Other category (jaise "RC ISSUED") ke naam.
    const parties = await pool.query(
      "SELECT DISTINCT name FROM simple_master WHERE lower(kind)='party' AND lower(COALESCE(sub_category,''))='other' AND COALESCE(btrim(name),'')<>'' ORDER BY name"
    ).then(r => r.rows.map((x: any) => String(x.name))).catch(() => [] as string[]);

    // Old Rickshaw Inventory ki gaadiyan jinka RC fee voucher abhi nahi bana (rejected voucher wali wapas aa jati hain).
    const args: any[] = [];
    let where = "COALESCE(btrim(i.vehicle_no),'')<>''";
    if (search) { args.push("%" + search + "%"); where += " AND (i.vehicle_no ILIKE $1 OR COALESCE(i.model_name,'') ILIKE $1 OR COALESCE(i.dealer_name,'') ILIKE $1)"; }
    const pending = await pool.query(
      `SELECT i.id,i.vehicle_no,i.model_name,i.status,i.repo_date,i.dealer_name FROM old_rickshaw_inventory i
       WHERE ${where} AND NOT EXISTS (SELECT 1 FROM rc_issued_register r JOIN expense_payment_voucher v ON v.id=r.voucher_id WHERE r.inventory_id=i.id AND ${LIVE})
       ORDER BY i.repo_date DESC NULLS LAST,i.id DESC LIMIT 300`, args
    ).then(r => r.rows.map((x: any) => ({ ...x, id: Number(x.id), repo_date: ymd(x.repo_date) }))).catch(() => []);

    const regWhere = st === "pending" ? " AND r.rc_issued=false" : st === "issued" ? " AND r.rc_issued=true" : "";
    const reg = await pool.query(
      `SELECT r.*,v.voucher_no,v.status AS voucher_status,v.payment_status,v.pay_to_name,v.created_by AS voucher_created_by,v.approved_by,v.paid_by FROM rc_issued_register r
       JOIN expense_payment_voucher v ON v.id=r.voucher_id WHERE ${LIVE}${regWhere}
       ORDER BY r.rc_issued ASC,r.fee_date DESC NULLS LAST,r.id DESC LIMIT 1000`
    );
    const register = reg.rows.map((x: any) => ({
      ...x, id: Number(x.id), inventory_id: Number(x.inventory_id), voucher_id: Number(x.voucher_id), fee_amount: num(x.fee_amount),
      fee_date: ymd(x.fee_date), rc_issued_date: ymd(x.rc_issued_date)
    }));
    const sum = await pool.query(
      `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE r.rc_issued=false)::int AS pending,COUNT(*) FILTER(WHERE r.rc_issued=true)::int AS issued,COALESCE(SUM(r.fee_amount),0) AS fee
       FROM rc_issued_register r JOIN expense_payment_voucher v ON v.id=r.voucher_id WHERE ${LIVE}`
    );
    const s = sum.rows[0] || {};
    return Response.json({ parties, pending, register, summary: { total: s.total || 0, pending: s.pending || 0, issued: s.issued || 0, fee: num(s.fee) } });
  } catch (e: any) {
    return jerr(e?.message || "Could not load RC fee data.", 500);
  }
}

export async function POST(req: Request) {
  const a = auth(req);
  if (!isStaff(a)) return jerr("Login required.", 401);
  const b: any = await req.json().catch(() => ({}));
  const action = String(b.action || "create");
  if (!(await actionAllowed(a, MODULE_KEY, action === "create" ? "create" : "edit"))) return jerr("Forbidden.", 403);
  try {
    await ensureSchema();
    if (action === "create") return await createVoucher(b, a);
    if (action === "issue" || action === "unissue") return await setIssued(b, a, action === "issue");
    return jerr("Unknown action.");
  } catch (e: any) {
    return jerr(e?.message || "Could not save.", 500);
  }
}

async function createVoucher(b: any, a: any) {
  const date = ymd(b.date) || todayYmd();
  const payTo = String(b.pay_to_name || "").trim();
  if (!payTo) return jerr("Party select karo (Party Master > Other > RC ISSUED).");
  const items: { inventory_id: number; amount: number }[] = (Array.isArray(b.items) ? b.items : [])
    .map((x: any) => ({ inventory_id: idOf(x?.inventory_id) as number, amount: num(x?.amount) })).filter((x: any) => x.inventory_id);
  if (!items.length) return jerr("Kam se kam ek rickshaw select karo.");
  if (items.length > 100) return jerr("Ek voucher me max 100 rickshaw.");
  if (new Set(items.map(x => x.inventory_id)).size !== items.length) return jerr("Ek rickshaw do baar select hui hai.");
  if (items.some(x => x.amount <= 0)) return jerr("Har rickshaw ki RC fee 0 se zyada honi chahiye.");

  const ids = items.map(x => x.inventory_id);
  const inv = await pool.query("SELECT id,vehicle_no,model_name FROM old_rickshaw_inventory WHERE id=ANY($1::bigint[])", [ids]);
  const imap = new Map<number, any>(inv.rows.map((r: any) => [Number(r.id), r]));
  if (imap.size !== ids.length) return jerr("Selected rickshaw Old Rickshaw Inventory me nahi mili.");

  const dup = await pool.query(
    `SELECT r.vehicle_no,v.voucher_no FROM rc_issued_register r JOIN expense_payment_voucher v ON v.id=r.voucher_id
     WHERE r.inventory_id=ANY($1::bigint[]) AND ${LIVE} LIMIT 5`, [ids]);
  if (dup.rowCount) return jerr("In rickshaw ka RC fee voucher pehle se bana hua hai: " + dup.rows.map((x: any) => (x.vehicle_no || "-") + " (" + (x.voucher_no || "-") + ")").join(", "), 409);

  const total = items.reduce((s, x) => s + x.amount, 0);
  const nos = items.map(x => imap.get(x.inventory_id)?.vehicle_no).filter(Boolean).join(", ");
  const cols = await tableColumns("expense_payment_voucher");
  const who = String(a?.username || a?.sub || "");
  const entry: any = {
    voucher_no: "RCF-" + date.replace(/-/g, "") + "-" + String(Date.now()).slice(-5), date, expense_type: "rc_fee", expense_type_name: "RC Fee",
    pay_to_type: "other", pay_to_name: payTo, chassis_no: nos, payment_mode: "cash", amount: total,
    remarks: ("RC Fee - " + items.length + " rickshaw" + (String(b.remarks || "").trim() ? " | " + String(b.remarks).trim() : "")),
    work_qty: items.length, on_account: false, status: "pending", payment_status: "unpaid", created_by: who
  };
  const keys = Object.keys(entry).filter(k => cols.has(k));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query('INSERT INTO expense_payment_voucher (' + keys.map(k => '"' + k + '"').join(",") + ') VALUES (' + keys.map((_, i) => "$" + (i + 1)).join(",") + ') RETURNING id,voucher_no', keys.map(k => entry[k]));
    const vid = r.rows[0].id;
    for (const it of items) {
      const x = imap.get(it.inventory_id);
      await client.query("INSERT INTO expense_payment_voucher_line (voucher_id,chassis_no,model_name,amount) VALUES ($1,$2,$3,$4)", [vid, x.vehicle_no || null, x.model_name || null, it.amount]);
      await client.query("INSERT INTO rc_issued_register (inventory_id,vehicle_no,model_name,voucher_id,fee_amount,fee_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [it.inventory_id, x.vehicle_no || null, x.model_name || null, vid, it.amount, date, who]);
    }
    await client.query("COMMIT");
    return Response.json({ success: true, voucher_no: r.rows[0].voucher_no, voucher_id: Number(vid), count: items.length, amount: total }, { status: 201 });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function setIssued(b: any, a: any, issued: boolean) {
  const id = idOf(b.id);
  if (!id) return jerr("Register row id required.");
  const date = issued ? (ymd(b.rc_issued_date) || todayYmd()) : null;
  const r = await pool.query(
    "UPDATE rc_issued_register SET rc_issued=$1,rc_issued_date=$2,rc_no=$3,remarks=COALESCE(NULLIF($4,''),remarks),issued_by=$5 WHERE id=$6 RETURNING id",
    [issued, date, issued ? String(b.rc_no || "").trim() || null : null, String(b.remarks || "").trim(), issued ? String(a?.username || a?.sub || "") : null, id]
  );
  if (!r.rowCount) return jerr("Register row nahi mili.", 404);
  return Response.json({ success: true });
}

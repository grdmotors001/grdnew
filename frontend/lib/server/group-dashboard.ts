// Sidebar group dashboard (Masters / Vouchers): har header option ka count aur (vouchers me) total.
// Har item alag try/catch me hai, isliye kisi ek table/column ki dikkat se poora dashboard nahi tootta.
import { pool, columns } from "./common";
import { actionAllowed, isAdmin, isSalesman } from "./permissions";

type Item = {
  key: string;            // menu key (jis page par card click se jaana hai)
  perm?: string;          // permission key (default = key)
  table?: string;
  kinds?: string[];       // simple_master ke liye: kind values
  where?: string;         // extra filter (sirf columns jo table me ho)
  amount?: string[];      // total ke liye column candidates (pehla jo mile)
  amountExpr?: string;    // ya seedha expression
  dateCol?: string;       // "is mahine" ke liye
  notCancelled?: boolean; // cancelled=false filter, agar column ho
  note?: string;          // card ke neeche chhota text
  unit?: string;          // total ki unit (jaise 'rickshaw'); na ho to rupaye
  link?: boolean;         // seedhi table nahi: sirf card se page kholna (count nahi)
  salesmanLink?: boolean; // salesman ko sirf apne dealers dikhte hain, isliye uske liye count nahi, sirf link
};

const MASTERS: Item[] = [
  { key: "dealer", table: "dealer" },
  { key: "party", table: "simple_master", kinds: ["party"] },
  { key: "product", table: "product" },
  { key: "chassis-master", table: "chassis_rule" },
  { key: "production-formula", table: "production_formula" },
  { key: "mechanic", table: "simple_master", kinds: ["mechanic"] },
  { key: "fabricator", table: "simple_master", kinds: ["fabricator"] },
  { key: "salesman", table: "simple_master", kinds: ["salesman"] },
  { key: "bank", table: "simple_master", kinds: ["bank"] },
  { key: "colour", table: "simple_master", kinds: ["colour", "color"] },
];

const VOUCHERS: Item[] = [
  { key: "v-contra", table: "contra_voucher", amount: ["amount"], dateCol: "date" },
  { key: "v-payment", perm: "day-book", table: "day_book", where: "COALESCE(debit_paid,0)>0", amount: ["debit_paid"], dateCol: "date" },
  { key: "v-receipt", perm: "day-book", table: "day_book", where: "COALESCE(credit_received,0)>0", amount: ["credit_received"], dateCol: "date" },
  { key: "v-journal", perm: "journal-stock", table: "journal_stock", dateCol: "date", note: "Stock entries" },
  { key: "v-sales", perm: "tax-invoice", table: "tax_invoice", notCancelled: true, amount: ["total_amount", "invoice_amount", "grand_total", "sale_amount"], dateCol: "date" },
  { key: "v-purchase", perm: "purchase-bills", table: "purchase_bill", notCancelled: true, amount: ["total_amount", "grand_total", "net_amount", "bill_amount", "total"], dateCol: "date" },
  { key: "v-f10", table: "journal_voucher", amount: ["total"], dateCol: "date" },
  { key: "v-credit-note", perm: "credit-note", table: "credit_note", amount: ["total_amount"], dateCol: "date" },
  { key: "v-debit-note", perm: "debit-note", table: "debit_note", amount: ["total_amount"], dateCol: "date" },
  { key: "v-production", perm: "production-voucher", table: "production_voucher", amount: ["quantity"], dateCol: "date", note: "Total = rickshaw quantity" },
];

const FACTORY: Item[] = [
  { key: "debit-note", table: "debit_note", amount: ["total_amount"], dateCol: "date" },
  { key: "repair-service-voucher", table: "repair_service_voucher", amount: ["total_amount"], dateCol: "date" },
  { key: "old-rickshaw-challan", table: "old_rickshaw_challan", dateCol: "date" },
  { key: "journal-stock", table: "journal_stock", dateCol: "date", note: "Stock entries" },
  { key: "production-voucher", table: "production_voucher", amount: ["quantity"], unit: "rickshaw", dateCol: "date" },
  { key: "daily-raw-material-checklist", table: "daily_raw_material_checklist", dateCol: "date" },
  { key: "delivery-challan", table: "delivery_challan", notCancelled: true, dateCol: "date" },
  { key: "challan-shift", table: "delivery_challan_shift", dateCol: "shift_date" },
];

const BATTERY: Item[] = [
  { key: "battery-maker", table: "simple_master", kinds: ["battery-maker"] },
  { key: "battery-register", table: "battery_register_entry", dateCol: "date" },
  { key: "battery-delivery-challan", table: "battery_delivery_challan", dateCol: "date" },
  { key: "battery-withdrawal", table: "battery_stock_movement", where: "movement_type='withdrawal'", dateCol: "date" },
  { key: "battery-swap", table: "battery_swap_voucher", dateCol: "date" },
  { key: "battery-addition", table: "battery_stock_movement", where: "movement_type='addition'", dateCol: "date" },
];

const SALES: Item[] = [
  { key: "loan-application-view", table: "loan_workflow", dateCol: "created_at" },
  { key: "billing-pending-sales", table: "delivery_challan", note: "Bill baaki",
    where: "COALESCE(cancelled,false)=false AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=delivery_challan.id AND COALESCE(ti.cancelled,false)=false)", dateCol: "date" },
  { key: "tax-invoice", table: "tax_invoice", notCancelled: true, amount: ["total_amount", "invoice_amount", "grand_total", "sale_amount"], dateCol: "date" },
  { key: "credit-note", table: "credit_note", amount: ["total_amount"], dateCol: "date" },
  { key: "purchase-bills", table: "purchase_bill", notCancelled: true, amount: ["total_amount", "grand_total", "net_amount", "bill_amount", "total"], dateCol: "date" },
  { key: "old-rickshaw", table: "old_rickshaw", amount: ["sale_amount"], dateCol: "date" },
  { key: "vahan-inventory", table: "vehicle" },
  { key: "rto", table: "simple_master", kinds: ["rto"] },
  { key: "financer", table: "simple_master", kinds: ["financer"] },
];

const EXPENSES: Item[] = [
  { key: "expense-type", table: "simple_master", kinds: ["expense-type"] },
  { key: "expense-head", table: "simple_master", kinds: ["expense-head"] },
  { key: "expense-payment-voucher", table: "expense_payment_voucher", amount: ["amount"], dateCol: "date" },
  { key: "rc-fee-voucher", table: "rc_issued_register", dateCol: "created_at", note: "RC issued" },
  { key: "cash-at-dealer", link: true },
  { key: "showroom-stock", link: true },
  { key: "insurance-rto", table: "insurance_register", amount: ["payable_amount", "total_premium"], dateCol: "date" },
  { key: "rto-expense", table: "rto_expense_register", amount: ["amount"], dateCol: "date" },
];

const EPV_NOT_DONE = "lower(COALESCE(status,'')) NOT IN ('rejected','cancelled')";
const EPV_UNPAID = "lower(COALESCE(payment_status,''))<>'paid'";

const CASHIER: Item[] = [
  { key: "cashier-pending", table: "expense_payment_voucher", where: EPV_NOT_DONE + " AND lower(COALESCE(status,''))<>'approved' AND " + EPV_UNPAID, amount: ["amount"], dateCol: "date", note: "Approval baaki" },
  { key: "cashier-approved", table: "expense_payment_voucher", where: "lower(COALESCE(status,''))='approved' AND " + EPV_UNPAID, amount: ["amount"], dateCol: "date", note: "Paid baaki" },
  { key: "cashier-paid", table: "expense_payment_voucher", where: EPV_NOT_DONE + " AND lower(COALESCE(payment_status,''))='paid'", amount: ["amount"], dateCol: "date" },
  { key: "cashier-handover", table: "dealer_cash_handover", where: "lower(COALESCE(status,'pending'))='pending'", amount: ["amount"], dateCol: "date", note: "Approval baaki" },
  { key: "cashier-all-receipts", link: true },
  { key: "cashier-receipt", link: true },
];

const ACCOUNTS: Item[] = [
  { key: "ledger", link: true },
  { key: "ledger-v", link: true },
  { key: "gst-register", link: true },
  { key: "day-book", table: "day_book", dateCol: "date", note: "Bank & Cash entries" },
  { key: "balance-sheet", link: true },
  { key: "profit-loss", link: true },
  { key: "sale-record", table: "tax_invoice", notCancelled: true, dateCol: "date", note: "Live tax invoices" },
];

const INVENTORY: Item[] = [
  { key: "old-rickshaw-inventory", table: "old_rickshaw_inventory", where: "status IN ('hold','available')", dateCol: "date", note: "Unsold stock" },
  { key: "chfpl-repo-vehicles", link: true },
  { key: "closing-stock-premises", table: "vehicle", where: "lower(COALESCE(to_jsonb(vehicle)->>'stage',''))='manufacturing'", note: "Rickshaw premises me" },
  { key: "closing-stock-dealers", table: "vehicle", where: "stage='Delivery Challan' AND COALESCE(trim(dealer_name),'')<>''", note: "Rickshaw dealers ke paas", salesmanLink: true },
  { key: "closing-stock-battery-dealers", link: true },
  { key: "activity-log", link: true },
  { key: "closing-stock-raw", link: true },
  { key: "stock-ledger-premises", link: true },
  { key: "daily-raw-material-checklist", table: "daily_raw_material_checklist", dateCol: "date" },
  { key: "production-register", table: "production_voucher", amount: ["quantity"], unit: "rickshaw", dateCol: "date" },
];

const REPORTS: Item[] = [
  { key: "purchase-register", table: "purchase_bill", notCancelled: true, amount: ["total_amount", "grand_total", "net_amount", "bill_amount", "total"], dateCol: "date" },
  { key: "delivery-challan-register", table: "delivery_challan", notCancelled: true, dateCol: "date" },
  { key: "sale-register", table: "tax_invoice", notCancelled: true, amount: ["total_amount", "invoice_amount", "grand_total", "sale_amount"], dateCol: "date" },
  { key: "payment-receivable-report", link: true },
  { key: "customer-expense-ledger", link: true },
  { key: "hypothecation-register", table: "tax_invoice", notCancelled: true, where: "COALESCE(hypothecation_amount,0)>0", amount: ["hypothecation_amount"], dateCol: "date", note: "Loan wali bills" },
  { key: "subsidy-report", link: true },
  { key: "audit-report", link: true },
  { key: "incentive-register", link: true },
  { key: "vehicle-no-register", link: true },
];

const q = (s: string) => '"' + s.replace(/"/g, '""') + '"';

async function one(it: Item, withAmount: boolean) {
  const out: any = { key: it.key, link: !!it.link, unit: it.unit || "", count: null, month_count: null, total: null, month_total: null, note: it.note || "" };
  if (it.link || !it.table) return out;
  try {
    const cols = await columns(it.table as string);
    if (!cols.size) return out;
    const w: string[] = [];
    const args: any[] = [];
    if (it.kinds) { args.push(it.kinds); w.push("lower(kind)=ANY($1::text[])"); }
    if (it.where) w.push(it.where);
    if (it.notCancelled && cols.has("cancelled")) w.push("COALESCE(cancelled,false)=false");
    const where = w.length ? " WHERE " + w.join(" AND ") : "";
    const amtCol = withAmount && it.amount ? it.amount.find((c) => cols.has(c)) : undefined;
    const hasDate = !!(it.dateCol && cols.has(it.dateCol));
    const monthCond = hasDate ? "(" + q(it.dateCol as string) + ">=date_trunc('month',CURRENT_DATE))" : "false";
    const sel = [
      "COUNT(*)::int AS n",
      "COUNT(*) FILTER (WHERE " + monthCond + ")::int AS mn",
      amtCol ? "COALESCE(SUM(COALESCE(" + q(amtCol) + ",0)),0)::numeric AS t" : "NULL::numeric AS t",
      amtCol ? "COALESCE(SUM(COALESCE(" + q(amtCol) + ",0)) FILTER (WHERE " + monthCond + "),0)::numeric AS mt" : "NULL::numeric AS mt",
    ].join(",");
    const r = await pool.query("SELECT " + sel + " FROM " + q(it.table as string) + where, args);
    const row = r.rows[0] || {};
    out.count = Number(row.n || 0);
    out.month_count = hasDate ? Number(row.mn || 0) : null;
    out.total = row.t == null ? null : Number(row.t);
    out.month_total = row.mt == null ? null : Number(row.mt);
    // Pichhle 6 mahine ka trend (card ke chhote graph ke liye): har mahine ki entries aur (jahan amount hai) total.
    if (hasDate) {
      const dc = q(it.dateCol as string);
      const tw = (where ? where + " AND " : " WHERE ") + dc + ">=date_trunc('month',CURRENT_DATE)-INTERVAL '5 months'";
      const tsel = "to_char(date_trunc('month'," + dc + "),'YYYY-MM') AS m,COUNT(*)::int AS n" + (amtCol ? ",COALESCE(SUM(COALESCE(" + q(amtCol) + ",0)),0)::numeric AS t" : ",NULL::numeric AS t");
      const tr = await pool.query("SELECT " + tsel + " FROM " + q(it.table as string) + tw + " GROUP BY 1 ORDER BY 1", args);
      out.trend = tr.rows.map((x: any) => ({ m: x.m, n: Number(x.n || 0), t: x.t == null ? null : Number(x.t) }));
    }
  } catch (e: any) {
    console.error("[group-dashboard]", it.key, e?.message);
    out.error = true;
  }
  return out;
}

export async function groupDashboardGet(a: any, group: string) {
  const g = String(group || "").toLowerCase();
  const list = g === "reports" ? REPORTS : g === "cashier" ? CASHIER : g === "accounts" ? ACCOUNTS : g === "inventory" ? INVENTORY : g === "masters" ? MASTERS : g === "vouchers" ? VOUCHERS : g === "factory" ? FACTORY : g === "battery" ? BATTERY : g === "sales" ? SALES : g === "expenses" ? EXPENSES : null;
  if (!list) return Response.json({ error: "Unknown group." }, { status: 400 });
  // Salesman ko voucher ki rakam nahi dikhti (main dashboard me bhi sales amount hide hai).
  const withAmount = (g === "vouchers" || g === "factory" || g === "sales" || g === "expenses" || g === "cashier" || g === "inventory" || g === "reports") && !isSalesman(a);
  const admin = isAdmin(a);
  const allowed: Item[] = [];
  for (const it of list) {
    if (admin || (await actionAllowed(a, it.perm || it.key, "view"))) allowed.push(it);
  }
  const sman = isSalesman(a);
  const items = await Promise.all(allowed.map((it) => (it.salesmanLink && sman ? Promise.resolve({ key: it.key, link: true, unit: "", count: null, month_count: null, total: null, month_total: null, note: "" }) : one(it, withAmount))));
  return Response.json({ group: g, items, show_amount: withAmount, server_time: new Date().toISOString() });
}

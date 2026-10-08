// Registered Dealer ka apna Customer Tax Invoice (dealer portal > Purchases > Create Invoice).
//  - Sirf wahi dealer jiske Dealer Master me "Allow Purchase / Customer Invoice" ON ho (Registered, showroom/branch nahi).
//  - Bill number har dealer ka apna: 0001/26-27 (4 digit serial / financial year Apr-Mar), har FY me 0001 se restart.
//  - Invoice tax_invoice table me jaati hai (issued_by_dealer=true), vehicle stage 'Tax Invoice' ho jata hai,
//    isliye dealer ke "My Stock" (stage='Delivery Challan') se wo gaadi apne aap hat jati hai.
//  - Print me seller = dealer (naam, GSTIN, address, bank), G.R.D. Motors nahi (dealerSellerOverride).
import { pool, num, idOf, columns, json } from "./common";
import { audit } from "./permissions";

let ready: Promise<void> | null = null;
export function ensureDealerInvoiceSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query("ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS issued_by_dealer boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS buyer_gst_no text");
      await pool.query("CREATE TABLE IF NOT EXISTS dealer_invoice_seq (dealer_id integer NOT NULL, fy text NOT NULL, last_no integer NOT NULL DEFAULT 0, PRIMARY KEY (dealer_id, fy))");
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// India date (IST), taki raat 12 ke baad / UTC ke fark se financial year galat na ho.
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// "2026-10-08" -> "26-27"; "2026-02-10" -> "25-26" (FY April se March).
export function financialYearLabel(ymdStr: string): string {
  const y = Number(ymdStr.slice(0, 4)), m = Number(ymdStr.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return String(start % 100).padStart(2, "0") + "-" + String((start + 1) % 100).padStart(2, "0");
}
export const formatDealerBillNo = (n: number, fy: string) => String(n).padStart(4, "0") + "/" + fy;

const err = (error: string, status = 400) => Response.json({ error }, { status });

export async function dealerInvoicePost(req: Request, path: string[], a: any): Promise<Response | null> {
  if (path.join("/") !== "dealer/customer-invoice") return null;
  if (a?.scope !== "dealer") return err("Dealer login required.", 403);
  const b: any = await json(req);
  const dealerId = idOf(a.dealer_id);
  if (!dealerId) return err("Dealer not found.", 403);
  await ensureDealerInvoiceSchema();

  const dr = await pool.query("SELECT * FROM dealer WHERE id=$1", [dealerId]);
  const dealer = dr.rows[0];
  if (!dealer) return err("Dealer not found.", 404);
  const category = String(dealer.dealer_category || "dealer").toLowerCase();
  const registered = String(dealer.registration_type || "registered").toLowerCase() !== "unregistered";
  if (dealer.blocked) return err("Dealer blocked hai.", 403);
  if (!registered || ["showroom", "branch"].includes(category) || dealer.purchase_access !== true)
    return err("Customer Invoice ki permission is dealer ko nahi hai. Dealer Master me 'Allow Purchase / Customer Invoice' ON karwayein.", 403);

  const challanId = idOf(b.challan_id);
  if (!challanId) return err("Challan select karein.");
  const buyerName = String(b.buyer_name || "").trim();
  if (!buyerName) return err("Customer Name zaruri hai.");
  const saleAmount = num(b.sale_amount), discount = num(b.discount), gstRate = num(b.gst_rate), received = num(b.amount_received);
  if (saleAmount <= 0) return err("Sale Amount daalein.");
  if (discount < 0 || discount > saleAmount) return err("Discount sahi nahi hai.");
  if (gstRate < 0 || gstRate > 100) return err("GST Rate sahi nahi hai.");
  if (received < 0) return err("Amount Received sahi nahi hai.");

  const cr = await pool.query("SELECT * FROM delivery_challan WHERE id=$1 AND dealer_id=$2 AND COALESCE(cancelled,false)=false", [challanId, dealerId]);
  const challan = cr.rows[0];
  if (!challan) return err("Delivery Challan nahi mili.", 404);
  const dup = await pool.query("SELECT bill_no FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false LIMIT 1", [challanId]);
  if (dup.rowCount) return err("Is challan ka invoice pehle se ban chuka hai (" + (dup.rows[0].bill_no || "") + ").", 409);

  const vr = challan.vehicle_id ? await pool.query("SELECT * FROM vehicle WHERE id=$1", [challan.vehicle_id]) : { rows: [] as any[] };
  const v = vr.rows[0] || {};

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : istToday();
  const fy = financialYearLabel(date);
  const buyerStateCode = String(b.buyer_state_code || "").trim();
  const dealerStateCode = String(dealer.state_code || "").trim();
  const stateType = buyerStateCode && dealerStateCode && buyerStateCode !== dealerStateCode ? "O" : "I";

  const cols = await columns("tax_invoice");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serial atomically (row lock) -> do dealer ek hi number nahi le sakte.
    const sq = await client.query(
      "INSERT INTO dealer_invoice_seq (dealer_id,fy,last_no) VALUES ($1,$2,1) ON CONFLICT (dealer_id,fy) DO UPDATE SET last_no=dealer_invoice_seq.last_no+1 RETURNING last_no",
      [dealerId, fy]);
    const billNo = formatDealerBillNo(sq.rows[0].last_no, fy);
    const values: any = {
      bill_no: billNo, date, cancelled: false, issued_by_dealer: true,
      delivery_challan_id: challanId, dealer_id: dealerId, vehicle_id: challan.vehicle_id || null, dealer_name: dealer.name || null,
      buyer_name: buyerName, buyer_father_name: b.buyer_father_name || null, buyer_mobile: b.buyer_mobile || null,
      buyer_address: b.buyer_address || null, buyer_gst_no: b.buyer_gst_no || null, buyer_pan: b.buyer_pan || null,
      buyer_state: b.buyer_state || null, buyer_state_code: buyerStateCode || null, state_type: stateType,
      product_name: challan.product_name || v.model_name || null, chassis_no: challan.chassis_no || v.chassis_no || null,
      motor_no: challan.motor_no || v.motor_no || null, colour: challan.colour || v.colour || null,
      // gst_sale_amount = discount se pehle ki taxable value; TI_CALC discount ek hi baar ghatata hai.
      sale_amount: saleAmount, gst_sale_amount: saleAmount, gst_rate: gstRate, discount, amount_received: received,
      bank_name: b.bank_name || dealer.bank_name || null, bank_account_no: b.bank_account_no || dealer.bank_account_no || null,
      bank_ifsc: b.bank_ifsc || dealer.bank_ifsc || null, created_at: new Date(),
    };
    const keys = Object.keys(values).filter((k) => cols.has(k));
    const r = await client.query(
      'INSERT INTO tax_invoice (' + keys.map((k) => '"' + k + '"').join(",") + ') VALUES (' + keys.map((_, i) => "$" + (i + 1)).join(",") + ') RETURNING *',
      keys.map((k) => values[k]));
    if (challan.vehicle_id) {
      const vc = await columns("vehicle");
      if (vc.has("stage")) await client.query("UPDATE vehicle SET stage='Tax Invoice' WHERE id=$1", [challan.vehicle_id]);
    }
    await client.query("COMMIT");
    const row = r.rows[0];
    await audit(a, "dealer/customer-invoice", "create", row.id, null, row, dealerId, billNo).catch(() => {});
    return Response.json({ success: true, id: row.id, bill_no: billNo, chassis_no: row.chassis_no, row }, { status: 201 });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[dealer-customer-invoice]", e);
    return err(e?.message || "Invoice save nahi ho saki.", 500);
  } finally {
    client.release();
  }
}

// Dealer ki banayi invoice print me seller = dealer. Normal GRD invoice par kuch nahi badalta.
export function dealerSellerOverride(invoice: any, dealer: any, company: any, bank: any) {
  if (!invoice?.issued_by_dealer || !dealer) return { company, bank, issuedByDealer: false };
  const d = dealer;
  const addr2 = [d.address2, d.pincode].map((s: any) => String(s || "").trim()).filter(Boolean).join(" - ");
  return {
    issuedByDealer: true,
    company: { ...company, name: d.name || "", gst_no: d.gst_no || "", address1: d.address1 || "", address2: addr2, email: d.email || "", mobile: d.mobile || "", website: "" },
    bank: {
      name: invoice.bank_name || d.bank_name || "",
      account_no: invoice.bank_account_no || d.bank_account_no || "",
      ifsc: invoice.bank_ifsc || d.bank_ifsc || "",
    },
  };
}

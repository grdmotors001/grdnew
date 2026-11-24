// POST /api/einvoice/:id  -> tax_invoice se IRN generate karta hai
import jwt from "jsonwebtoken";
import { pool } from "../../../../lib/server/common";
import { nicPost, errText } from "../../../../lib/server/nic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";
const auth = (req: Request) => { const h = req.headers.get("authorization") || "", t = h.startsWith("Bearer ") ? h.slice(7) : ""; if (!t) return null; try { return jwt.verify(t, secret) as any } catch { return null } };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const first = (...v: any[]) => { for (const x of v) if (x != null && String(x).trim() !== "") return String(x).trim(); return ""; };
const ddmmyyyy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const pinFrom = (...v: any[]) => { for (const s of v) { const m = String(s ?? "").match(/\b[1-9]\d{5}\b/); if (m) return Number(m[0]); } return 0; };

async function buildPayload(id: number) {
  const q = await pool.query(
    `SELECT ti.*, ti.date::text AS date_txt,
            GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0) AS taxable_value,
            COALESCE(ti.gst_sale_amount,ti.sale_amount,0) AS gross_value,
            row_to_json(d) AS dealer_json, row_to_json(v) AS vehicle_json
       FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=$1`, [id]);
  if (!q.rowCount) throw new Error("Tax Invoice not found.");
  const x = q.rows[0], d = x.dealer_json || {}, v = x.vehicle_json || {};
  if (x.cancelled) throw new Error("Cancelled invoice ka IRN generate nahi ho sakta.");

  const c = (await pool.query("SELECT row_to_json(c) AS j FROM company c ORDER BY id DESC LIMIT 1")).rows[0]?.j || {};
  const pname = first(x.product_name, v.model_name);
  const pr = (await pool.query("SELECT NULLIF(btrim(to_jsonb(p)->>'hsn_code'),'') AS hsn FROM product p WHERE lower(btrim(p.name))=lower(btrim($1)) AND COALESCE(btrim(to_jsonb(p)->>'hsn_code'),'')<>'' ORDER BY p.id DESC LIMIT 1", [pname])).rows[0];

  // ---- seller (TODO: company table ke exact column names confirm karo) ----
  const sGst = first(c.gst_no, process.env.NIC_GSTIN);
  const sellerPin = pinFrom(c.pincode, c.pin, c.address, c.address1);
  // ---- buyer ----
  const bGst = first(x.buyer_gst_no, d.gst_no).toUpperCase();
  const bStateCode = first(x.buyer_state_code, bGst.slice(0, 2), d.state_code).padStart(2, "0");
  const sStateCode = first(c.state_code, sGst.slice(0, 2)).padStart(2, "0");
  const buyerAddr = first(x.buyer_address, [d.address1, d.address2].filter(Boolean).join(", "));
  const bPin = pinFrom(x.buyer_pincode, x.buyer_pin, buyerAddr, d.pincode);

  const errs: string[] = [];
  if (!x.bill_no || String(x.bill_no).length > 16) errs.push("Bill No 1-16 chars ka hona chahiye (NIC limit).");
  if (!GSTIN.test(sGst)) errs.push("Seller GSTIN invalid/missing.");
  if (!GSTIN.test(bGst)) errs.push("Buyer GSTIN invalid/missing - e-invoice sirf B2B (GST-registered buyer) ke liye hota hai.");
  if (!pr?.hsn) errs.push(`Product '${pname}' ka HSN code missing.`);
  if (!sellerPin) errs.push("Seller pincode missing."); if (!bPin) errs.push("Buyer pincode missing.");
  if (errs.length) throw new Error(errs.join(" "));

  const intra = bStateCode === sStateCode;
  const rate = Number(x.gst_rate || 0);
  const gross = r2(Number(x.gross_value)), disc = r2(Number(x.discount || 0)), ass = r2(Number(x.taxable_value));
  const half = intra ? r2((ass * rate) / 200) : 0, igst = intra ? 0 : r2((ass * rate) / 100);
  const itemVal = r2(ass + half * 2 + igst);
  const oth = r2(Number(x.insurance_amount || 0) + Number(x.registration_amount || 0)); // GST ke bahar charges
  const raw = r2(itemVal + oth), total = Math.round(raw), rnd = r2(total - raw); // Tally ki tarah whole-rupee round off

  const attrib = [x.chassis_no && { Nm: "Chassis No", Val: String(x.chassis_no) }, x.motor_no && { Nm: "Motor No", Val: String(x.motor_no) }].filter(Boolean);

  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: String(x.bill_no), Dt: ddmmyyyy(x.date_txt) },
    SellerDtls: { Gstin: sGst, LglNm: first(c.legal_name, c.name, c.company_name), Addr1: first(c.address1, c.address, "NA"), Loc: first(c.city, c.location, c.district, "NA"), Pin: sellerPin, Stcd: sStateCode },
    BuyerDtls: { Gstin: bGst, LglNm: first(x.buyer_name, d.name), Pos: bStateCode, Addr1: buyerAddr || "NA", Loc: first(x.buyer_city, x.buyer_district, d.city, x.buyer_state, "NA"), Pin: bPin, Stcd: bStateCode },
    ItemList: [{
      SlNo: "1", PrdDesc: pname, IsServc: "N", HsnCd: String(pr.hsn), Qty: 1, Unit: "NOS",
      UnitPrice: gross, TotAmt: gross, Discount: disc, AssAmt: ass, GstRt: rate,
      IgstAmt: igst, CgstAmt: half, SgstAmt: half, TotItemVal: itemVal,
      ...(attrib.length ? { AttribDtls: attrib } : {}),
    }],
    ValDtls: { AssVal: ass, CgstVal: half, SgstVal: half, IgstVal: igst, OthChrg: oth, RndOffAmt: rnd, TotInvVal: total },
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = auth(req); if (!a) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (a.scope === "dealer") return Response.json({ error: "Not allowed." }, { status: 403 });
  const id = Number((await params).id);
  try {
    const cur = (await pool.query("SELECT irn, ack_no, ack_date, signed_qr_code FROM tax_invoice WHERE id=$1", [id])).rows[0];
    if (cur?.irn) return Response.json({ ok: true, already: true, ...cur });   // idempotent

    const payload = await buildPayload(id);
    const j = await nicPost("/eicore/v1.03/Invoice", payload);

    if (j.Status === 1 && j.Data?.Irn) {
      const { Irn, AckNo, AckDt, SignedQRCode } = j.Data;
      await pool.query("UPDATE tax_invoice SET irn=$1, ack_no=$2, ack_date=$3, signed_qr_code=$4, irn_status='generated', irn_error=NULL WHERE id=$5", [Irn, String(AckNo), AckDt, SignedQRCode, id]);
      return Response.json({ ok: true, irn: Irn, ack_no: AckNo, ack_date: AckDt });
    }
    // 2150 = duplicate IRN: NIC InfoDtls me purana IRN deta hai (ya Get IRN by Doc Details se uthao)
    const dup = (j.ErrorDetails || []).some((e: any) => String(e.ErrorCode) === "2150");
    const msg = errText(j);
    await pool.query("UPDATE tax_invoice SET irn_status='failed', irn_error=$1 WHERE id=$2", [msg.slice(0, 900), id]);
    return Response.json({ ok: false, duplicate: dup, error: msg, info: j.InfoDtls ?? null }, { status: 400 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message || "E-invoice failed." }, { status: 400 });
  }
}

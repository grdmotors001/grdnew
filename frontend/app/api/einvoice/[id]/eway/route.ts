// POST /api/einvoice/:id/eway  body: { distance, vehNo?, transMode?, vehType?, transId?, transName?, transDocNo?, transDocDt? }
import jwt from "jsonwebtoken";
import { pool } from "../../../../../lib/server/common";
import { nicPost, errText } from "../../../../../lib/server/nic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";
const auth = (req: Request) => { const h = req.headers.get("authorization") || "", t = h.startsWith("Bearer ") ? h.slice(7) : ""; if (!t) return null; try { return jwt.verify(t, secret) as any } catch { return null } };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = auth(req); if (!a) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (a.scope === "dealer") return Response.json({ error: "Not allowed." }, { status: 403 });
  const id = Number((await params).id), b = await req.json().catch(() => ({}));
  try {
    const x = (await pool.query("SELECT irn, ewb_no, vehicle_reg_no FROM tax_invoice WHERE id=$1", [id])).rows[0];
    if (!x) throw new Error("Tax Invoice not found.");
    if (!x.irn) throw new Error("Pehle IRN generate karo.");
    if (x.ewb_no) return Response.json({ ok: true, already: true, ewb_no: x.ewb_no });

    const mode = String(b.transMode || "1");
    const veh = String(b.vehNo || x.vehicle_reg_no || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const dist = Number(b.distance ?? 0);               // 0 = NIC pincode se khud calculate karta hai
    if (mode === "1" && !veh && !b.transId) throw new Error("Vehicle No ya Transporter ID chahiye.");

    const body: any = { Irn: x.irn, Distance: dist, TransMode: mode, VehType: b.vehType || "R" };
    if (veh) body.VehNo = veh;
    if (b.transId) body.TransId = b.transId;
    if (b.transName) body.TransName = b.transName;
    if (b.transDocNo) body.TransDocNo = b.transDocNo;
    if (b.transDocDt) body.TransDocDt = b.transDocDt;    // dd/mm/yyyy

    const j = await nicPost("/eiewb/v1.03/ewaybill", body);
    if (j.Status === 1 && j.Data?.EwbNo) {
      await pool.query("UPDATE tax_invoice SET ewb_no=$1, ewb_date=$2, ewb_valid_till=$3, ewb_status='generated', ewb_error=NULL WHERE id=$4", [String(j.Data.EwbNo), j.Data.EwbDt, j.Data.EwbValidTill, id]);
      return Response.json({ ok: true, ewb_no: j.Data.EwbNo, valid_till: j.Data.EwbValidTill });
    }
    const msg = errText(j);
    await pool.query("UPDATE tax_invoice SET ewb_status='failed', ewb_error=$1 WHERE id=$2", [msg.slice(0, 900), id]);
    return Response.json({ ok: false, error: msg }, { status: 400 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message || "E-way bill failed." }, { status: 400 });
  }
}

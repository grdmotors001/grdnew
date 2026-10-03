// Payment Receivable report (alag route). Query/logic lib/server/reports-sales.ts me hai (bade route file se nikala gaya).
// Purana raasta (/api/reports/payment-receivable via bade route file) bhi chalta rahega; dono ek hi code chalate hain.
import { guardRead } from "../../../../../lib/server/guard";
import { paymentReceivableReport } from "../../../../../lib/server/reports-sales";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PATH = ["reports", "payment-receivable"];

export async function GET(req: Request) {
  try {
    const g = await guardRead(req, PATH);
    if (g instanceof Response) return g;
    return await paymentReceivableReport(req);
  } catch (e: any) {
    console.error("[reports/payment-receivable GET]", e);
    return Response.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}

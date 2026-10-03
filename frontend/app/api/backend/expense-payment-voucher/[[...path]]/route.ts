// Expense Payment Voucher API (alag route). Logic lib/server/expense-voucher.ts me hai (bade route file se nikala gaya).
// Purana raasta (/api/expense-payment-voucher via bade route file) bhi chalta rahega; dono ek hi code chalate hain.
import { guardRead, guardWrite } from "../../../../../lib/server/guard";
import { expenseVoucherGet, expenseVoucherPost, expenseVoucherDelete } from "../../../../../lib/server/expense-voucher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path?: string[] }> };
const BASE = "expense-payment-voucher";
const TABLE = "expense_payment_voucher";
const full = async (ctx: Ctx) => [BASE, ...((await ctx.params).path || [])];
const notFound = () => Response.json({ error: "Not found." }, { status: 404 });
const fail = (tag: string, e: any) => { console.error("[" + tag + "]", e); return Response.json({ error: e?.message || "Internal server error" }, { status: 500 }); };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const path = await full(ctx);
    const g = await guardRead(req, path);
    if (g instanceof Response) return g;
    return (await expenseVoucherGet(req, path, g.a)) || notFound();
  } catch (e) { return fail("expense-voucher GET", e); }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const path = await full(ctx);
    const g = await guardWrite(req, path, "POST");
    if (g instanceof Response) return g;
    const b = await req.json().catch(() => ({}));
    return (await expenseVoucherPost(path, b, g.a)) || notFound();
  } catch (e) { return fail("expense-voucher POST", e); }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const path = await full(ctx);
    if (path.length !== 2) return notFound();
    const g = await guardWrite(req, path, "DELETE", TABLE);
    if (g instanceof Response) return g;
    return await expenseVoucherDelete(path, g.a);
  } catch (e) { return fail("expense-voucher DELETE", e); }
}

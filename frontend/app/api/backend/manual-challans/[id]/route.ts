// Manual Challan cancel (toggle) / delete. Module key: old-rickshaw-challan.
import { guardWrite } from "../../../../../lib/server/guard";
import { manualChallanCancel, manualChallanDelete, manualChallanErr, MC_MODULE } from "../../../../../lib/server/manual-challan";
import { idOf } from "../../../../../lib/server/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = idOf((await ctx.params).id);
    if (!id) return Response.json({ error: "Challan id required." }, { status: 400 });
    const g = await guardWrite(req, [MC_MODULE], "PUT");
    if (g instanceof Response) return g;
    return await manualChallanCancel(id, g.a);
  } catch (e) { return manualChallanErr(e); }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = idOf((await ctx.params).id);
    if (!id) return Response.json({ error: "Challan id required." }, { status: 400 });
    const g = await guardWrite(req, [MC_MODULE], "DELETE");
    if (g instanceof Response) return g;
    return await manualChallanDelete(id, g.a);
  } catch (e) { return manualChallanErr(e); }
}

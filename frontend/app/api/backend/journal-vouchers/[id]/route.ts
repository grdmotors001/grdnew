// F10 Journal Voucher delete. Module key: v-f10.
import { guardWrite } from "../../../../../lib/server/guard";
import { journalDelete, journalErr, JV_MODULE } from "../../../../../lib/server/journal-voucher";
import { idOf } from "../../../../../lib/server/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = idOf((await ctx.params).id);
    if (!id) return Response.json({ error: "Voucher id required." }, { status: 400 });
    const g = await guardWrite(req, [JV_MODULE], "DELETE");
    if (g instanceof Response) return g;
    return await journalDelete(id, g.a);
  } catch (e) { return journalErr(e); }
}

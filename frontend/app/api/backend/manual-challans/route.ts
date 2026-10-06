// Manual Challan (factory handover slip) list + create/edit. Logic: lib/server/manual-challan.ts. Module key: old-rickshaw-challan.
import { guardRead, guardWrite } from "../../../../lib/server/guard";
import { manualChallanGet, manualChallanSave, manualChallanErr, MC_MODULE } from "../../../../lib/server/manual-challan";
import { actionAllowed } from "../../../../lib/server/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const g = await guardRead(req, [MC_MODULE]);
    if (g instanceof Response) return g;
    return await manualChallanGet(req);
  } catch (e) { return manualChallanErr(e); }
}

export async function POST(req: Request) {
  try {
    const g = await guardWrite(req, [MC_MODULE], "POST");
    if (g instanceof Response) return g;
    const b = await req.json().catch(() => ({}));
    if (b?.id && !(await actionAllowed(g.a, MC_MODULE, "edit"))) return Response.json({ error: "Forbidden." }, { status: 403 });
    return await manualChallanSave(b, g.a);
  } catch (e) { return manualChallanErr(e); }
}

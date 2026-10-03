// F10 Journal Voucher (list + create/edit). Logic: lib/server/journal-voucher.ts. Module key: v-f10.
import { guardRead, guardWrite } from "../../../../lib/server/guard";
import { journalGet, journalSave, journalErr, JV_MODULE } from "../../../../lib/server/journal-voucher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const g = await guardRead(req, [JV_MODULE]);
    if (g instanceof Response) return g;
    return await journalGet(req);
  } catch (e) { return journalErr(e); }
}

export async function POST(req: Request) {
  try {
    const g = await guardWrite(req, [JV_MODULE], "POST");
    if (g instanceof Response) return g;
    const b = await req.json().catch(() => ({}));
    return await journalSave(b, g.a);
  } catch (e) { return journalErr(e); }
}

import { docFile, docDelete } from "../../../../../lib/server/customer-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
async function safe(fn: () => Promise<Response>) {
  try { return await fn(); }
  catch (e: any) { console.error("[customer-documents/id]", e); return Response.json({ error: e?.message || "Customer documents request failed." }, { status: 500 }); }
}
export const GET = (req: Request, { params }: Ctx) => safe(async () => docFile(req, (await params).id));
export const DELETE = (req: Request, { params }: Ctx) => safe(async () => docDelete(req, (await params).id));

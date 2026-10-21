import { docsList, docsUpload } from "../../../../lib/server/customer-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function safe(fn: () => Promise<Response>) {
  try { return await fn(); }
  catch (e: any) { console.error("[customer-documents]", e); return Response.json({ error: e?.message || "Customer documents request failed." }, { status: 500 }); }
}
export const GET = (req: Request) => safe(() => docsList(req));
export const POST = (req: Request) => safe(() => docsUpload(req));

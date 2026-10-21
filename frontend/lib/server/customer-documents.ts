// Customer documents (Aadhaar, PAN, Photo ... ) - dealer panel + admin Customer Expense Ledger dono yahi use karte hain.
// Files Postgres me (bytea) save hoti hain, isliye Vercel jaise read-only filesystem par bhi chalta hai.
// Dealer: sirf apne customers ke 6 documents (DEALER_DOC_TYPES). Admin/staff: saare 12 types.
import { pool, auth, num, idOf } from "./common";
import { actionAllowed, ensureSecuritySchema, assignedDealerIds, isSalesman } from "./permissions";

export const DEALER_DOC_TYPES = ["aadhar", "pan", "photo", "record", "dl", "pcc"];
export const ADMIN_DOC_TYPES = ["disclaimer", "cash_receipt", "rc", "insurance", "description", "others"];
const MODULE = "reports/customer-expense-ledger";
const MAX_BYTES = 4 * 1024 * 1024; // Vercel request limit ~4.5MB; images client par compress hoti hain.
const jerr = (error: string, status = 400) => Response.json({ error }, { status });

let schemaP: Promise<void> | null = null;
export function ensureCustomerDocSchema() {
  if (!schemaP) {
    schemaP = (async () => {
      await pool.query("CREATE TABLE IF NOT EXISTS customer_document (id bigserial PRIMARY KEY,dealer_id integer,customer_id bigint,invoice_id bigint,doc_type text NOT NULL,file_name text NOT NULL,mime text NOT NULL,size integer NOT NULL DEFAULT 0,data bytea NOT NULL,uploaded_by text,uploaded_scope text,created_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_document_customer_idx ON customer_document(customer_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_document_invoice_idx ON customer_document(invoice_id)");
    })().catch((e) => { schemaP = null; throw e; });
  }
  return schemaP;
}

type Gate = { a?: any; dealer?: boolean; err?: Response };
async function gate(req: Request, action: "view" | "create" | "delete"): Promise<Gate> {
  const a = auth(req);
  if (!a) return { err: jerr("Authentication required.", 401) };
  if (a.scope === "dealer") return { a, dealer: true };
  if (a.scope === "staff") {
    await ensureSecuritySchema();
    if (!(await actionAllowed(a, MODULE, action))) return { err: jerr("You don't have rights for this action. Please contact Admin to get access.", 403) };
    return { a, dealer: false };
  }
  return { err: jerr("Forbidden.", 403) };
}

const allowedTypes = (dealer: boolean) => (dealer ? DEALER_DOC_TYPES : [...DEALER_DOC_TYPES, ...ADMIN_DOC_TYPES]);

// Magic bytes se asli type pata karo (client ke bheje mime par bharosa nahi).
function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length > 4 && b.slice(0, 4).toString("latin1") === "%PDF") return { mime: "application/pdf", ext: "pdf" };
  if (b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

// customer_id (dealer_cash_customer) ya invoice_id (tax_invoice) se customer ko pehchano + ownership check.
async function resolveTarget(a: any, dealer: boolean, customerRaw: any, invoiceRaw: any): Promise<{ t?: { dealer_id: number | null; customer_id: number | null; invoice_id: number | null }; err?: Response }> {
  let customer_id = idOf(customerRaw), invoice_id = idOf(invoiceRaw), dealer_id: number | null = null;
  if (!customer_id && !invoice_id) return { err: jerr("Customer reference required.", 400) };
  const did = dealer ? num(a.dealer_id) : null;

  if (customer_id) {
    const r = await pool.query("SELECT id,dealer_id FROM dealer_cash_customer WHERE id=$1", [customer_id]);
    if (!r.rowCount) return { err: jerr("Customer not found.", 404) };
    if (dealer && num(r.rows[0].dealer_id) !== did) return { err: jerr("Customer not found.", 404) };
    dealer_id = num(r.rows[0].dealer_id) || null;
    if (!invoice_id) {
      try {
        const s = await pool.query("SELECT invoice_id FROM grd_billing_sale WHERE dealer_cash_customer_id=$1 AND invoice_id IS NOT NULL ORDER BY (status='BILLED') DESC,id DESC LIMIT 1", [customer_id]);
        invoice_id = idOf(s.rows[0]?.invoice_id);
      } catch { /* grd_billing_sale na ho to skip */ }
    }
  }
  if (invoice_id) {
    const r = await pool.query("SELECT ti.id,ti.dealer_id,lower(btrim(COALESCE(ti.dealer_name,''))) AS dn FROM tax_invoice ti WHERE ti.id=$1", [invoice_id]);
    if (!r.rowCount) return { err: jerr("Invoice not found.", 404) };
    if (dealer) {
      const own = num(r.rows[0].dealer_id) === did || (!r.rows[0].dealer_id && !!r.rows[0].dn && r.rows[0].dn === String((await pool.query("SELECT lower(btrim(name)) AS n FROM dealer WHERE id=$1", [did])).rows[0]?.n || ""));
      if (!own) return { err: jerr("Customer not found.", 404) };
    }
    dealer_id = dealer_id || num(r.rows[0].dealer_id) || null;
  }
  if (!dealer && isSalesman(a)) {
    const ids = assignedDealerIds(a) || [];
    if (!dealer_id || !ids.includes(dealer_id)) return { err: jerr("This customer is not in your assigned dealers.", 403) };
  }
  return { t: { dealer_id, customer_id, invoice_id } };
}

const META = "id,doc_type,file_name,mime,size,uploaded_by,uploaded_scope,created_at";

export async function docsList(req: Request) {
  const g = await gate(req, "view"); if (g.err) return g.err;
  await ensureCustomerDocSchema();
  const u = new URL(req.url);
  const r = await resolveTarget(g.a, !!g.dealer, u.searchParams.get("customer_id"), u.searchParams.get("invoice_id"));
  if (r.err) return r.err;
  const t = r.t!, args: any[] = [], cond: string[] = [];
  if (t.customer_id) { args.push(t.customer_id); cond.push("customer_id=$" + args.length); }
  if (t.invoice_id) { args.push(t.invoice_id); cond.push("invoice_id=$" + args.length); }
  args.push(allowedTypes(!!g.dealer));
  const q = await pool.query("SELECT " + META + " FROM customer_document WHERE (" + cond.join(" OR ") + ") AND doc_type=ANY($" + args.length + "::text[]) ORDER BY created_at DESC,id DESC", args);
  return Response.json({ documents: q.rows, max_bytes: MAX_BYTES });
}

export async function docsUpload(req: Request) {
  const g = await gate(req, "create"); if (g.err) return g.err;
  await ensureCustomerDocSchema();
  let form: FormData;
  try { form = await req.formData(); } catch { return jerr("Upload data could not be read.", 400); }
  const docType = String(form.get("doc_type") || "").trim();
  if (!allowedTypes(!!g.dealer).includes(docType)) return jerr("Invalid document type.", 400);
  const file: any = form.get("file");
  if (!file || typeof file === "string") return jerr("No file received.", 400);
  if (file.size > MAX_BYTES) return jerr("File is too large (max 4 MB). Please upload a smaller photo/PDF.", 413);
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return jerr("Only JPG, PNG, WEBP images or PDF files are allowed.", 400);
  const r = await resolveTarget(g.a, !!g.dealer, form.get("customer_id"), form.get("invoice_id"));
  if (r.err) return r.err;
  const t = r.t!;
  const base = String(file.name || "document").replace(/[^\w.\- ]+/g, "_").replace(/\.[A-Za-z0-9]+$/, "").slice(0, 80) || "document";
  const who = String(g.a.username || g.a.sub || "");
  const ins = await pool.query(
    "INSERT INTO customer_document (dealer_id,customer_id,invoice_id,doc_type,file_name,mime,size,data,uploaded_by,uploaded_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING " + META,
    [t.dealer_id, t.customer_id, t.invoice_id, docType, base + "." + kind.ext, kind.mime, buf.length, buf, who, g.dealer ? "dealer" : "staff"]
  );
  return Response.json({ success: true, document: ins.rows[0] });
}

async function loadOwned(g: Gate, id: number, withData: boolean) {
  const q = await pool.query("SELECT " + META + ",dealer_id" + (withData ? ",data" : "") + " FROM customer_document WHERE id=$1", [id]);
  const row = q.rows[0];
  if (!row) return { err: jerr("Document not found.", 404) };
  if (g.dealer) {
    if (num(row.dealer_id) !== num(g.a.dealer_id) || !DEALER_DOC_TYPES.includes(row.doc_type)) return { err: jerr("Document not found.", 404) };
  } else if (isSalesman(g.a)) {
    const ids = assignedDealerIds(g.a) || [];
    if (!ids.includes(num(row.dealer_id))) return { err: jerr("This customer is not in your assigned dealers.", 403) };
  }
  return { row };
}

export async function docFile(req: Request, idRaw: string) {
  const g = await gate(req, "view"); if (g.err) return g.err;
  await ensureCustomerDocSchema();
  const id = idOf(idRaw); if (!id) return jerr("Document id required.", 400);
  const o = await loadOwned(g, id, true); if (o.err) return o.err;
  const row = o.row!;
  const dl = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(row.data), {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.data.length),
      "Content-Disposition": (dl ? "attachment" : "inline") + '; filename="' + String(row.file_name).replace(/"/g, "") + '"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function docDelete(req: Request, idRaw: string) {
  const g = await gate(req, "delete"); if (g.err) return g.err;
  await ensureCustomerDocSchema();
  const id = idOf(idRaw); if (!id) return jerr("Document id required.", 400);
  const o = await loadOwned(g, id, false); if (o.err) return o.err;
  // Dealer sirf apne upload kiye document hata sakta hai (admin ka upload nahi).
  if (g.dealer && o.row!.uploaded_scope !== "dealer") return jerr("This document was uploaded by Admin. Only Admin can remove it.", 403);
  await pool.query("DELETE FROM customer_document WHERE id=$1", [id]);
  return Response.json({ success: true });
}

// Admin ledger rows ke liye document count (ek hi query).
export async function docCounts(invoiceIds: number[], customerIds: number[]) {
  const out = { byInvoice: new Map<number, number>(), byCustomer: new Map<number, number>(), pairs: [] as any[] };
  if (!invoiceIds.length && !customerIds.length) return out;
  await ensureCustomerDocSchema();
  const q = await pool.query("SELECT invoice_id,customer_id,count(*)::int AS n FROM customer_document WHERE invoice_id=ANY($1::bigint[]) OR customer_id=ANY($2::bigint[]) GROUP BY invoice_id,customer_id", [invoiceIds, customerIds]);
  out.pairs = q.rows;
  return out;
}

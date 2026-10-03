// Naye split routes ke liye permission guard.
// Bade route file ke GET / POST / mutation() ke generic checks yahan same order me hain:
//   login -> security schema -> canRead/canWrite -> Action Rights (actionAllowed) -> (delete par) dealer scope.
// Koi bhi naya route handler chalane se pehle inme se ek guard zaroor call kare. Ok ho to null milta hai, warna ready Response.
import { auth, idOf } from "./common";
import { actionAllowed, actionFor, canRead, canWrite, enforceDealerScope, ensureSecuritySchema } from "./permissions";

const deny = (error: string, status: number) => Response.json({ error }, { status });

export type Guarded = { a: any; p: string } | Response;

// Module key (Action Rights) = poora path, jaise main file me p = path.join("/").
export async function guardRead(req: Request, path: string[]): Promise<Guarded> {
  const p = path.join("/");
  const a = auth(req);
  if (!a) return deny("Authentication required.", 401);
  await ensureSecuritySchema();
  if (!canRead(a, p)) return deny("Forbidden.", 403);
  if (!(await actionAllowed(a, p, "view"))) return deny("Forbidden.", 403);
  // CSV export / download ke liye alag Download right.
  const u = new URL(req.url);
  if (String(u.searchParams.get("export") || "").toLowerCase() === "csv" || p.endsWith("/export") || p.includes("/download")) {
    if (!(await actionAllowed(a, p, "download"))) return deny("Download permission required.", 403);
  }
  return { a, p };
}

export async function guardWrite(req: Request, path: string[], method: "POST" | "PUT" | "PATCH" | "DELETE", table: string | null = null): Promise<Guarded> {
  const p = path.join("/");
  const a = auth(req);
  if (!a) return deny("Authentication required.", 401);
  await ensureSecuritySchema();
  if (!(await actionAllowed(a, p, actionFor(method)))) return deny("Forbidden.", 403);
  if (!canWrite(a, p)) return deny("Forbidden.", 403);
  if (method === "DELETE" && table) {
    const sg = await enforceDealerScope(a, table, idOf(path[path.length - 1]), {});
    if (sg) return sg;
  }
  return { a, p };
}

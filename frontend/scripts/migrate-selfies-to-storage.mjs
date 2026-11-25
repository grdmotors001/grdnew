// Purani punch selfies (DB me base64) ko Supabase Storage me le jata hai.
// Chalane ka tareeka:
//   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-selfies-to-storage.mjs
// Pehle DRY_RUN=1 se test karein. Dobara chalane par safe hai (sirf selfie_path IS NULL wali rows uthati hai).
import pg from "pg";

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const BUCKET = process.env.HR_SELFIE_BUCKET || "punch-selfies";
const DRY = process.env.DRY_RUN === "1";
const BATCH = 50;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error("DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY chahiye."); process.exit(1); }

const base = SUPABASE_URL.replace(/\/$/, "");
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY };
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Private bucket na ho to bana do.
const b = await fetch(base + "/storage/v1/bucket", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 1048576, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }) });
if (!b.ok && b.status !== 409 && !/already exists|Duplicate/i.test(await b.text())) { console.error("Bucket error"); process.exit(1); }

let done = 0, failed = 0;
for (;;) {
  const { rows } = await pool.query("SELECT id,employee_id,work_date::text AS d,kind,selfie FROM hr_punch_log WHERE selfie IS NOT NULL AND selfie_path IS NULL ORDER BY id LIMIT $1", [BATCH]);
  if (!rows.length) break;
  let progress = 0;
  for (const r of rows) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(r.selfie);
    if (!m) { console.warn("skip id", r.id, "(format galat)"); failed++; continue; }
    const path = `${r.employee_id}/${r.d}/${r.kind}-${r.id}.jpg`;
    if (DRY) { console.log("DRY", r.id, "->", path); done++; progress++; continue; }
    const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { ...headers, "Content-Type": m[1], "x-upsert": "true" }, body: Buffer.from(m[2], "base64") });
    if (!up.ok) { console.warn("upload fail id", r.id, (await up.text()).slice(0, 120)); failed++; continue; }
    // Row tabhi saaf hoti hai jab upload ho chuka ho.
    await pool.query("UPDATE hr_punch_log SET selfie_path=$1, selfie=NULL WHERE id=$2", [path, r.id]);
    done++; progress++;
  }
  console.log("migrated so far:", done, "failed:", failed);
  if (DRY || progress === 0) break;
}
// Thumbnails bhi Storage me.
let tdone = 0;
for (;;) {
  const { rows } = await pool.query("SELECT id,employee_id,work_date::text AS d,kind,thumb FROM hr_punch_log WHERE thumb IS NOT NULL AND thumb_path IS NULL ORDER BY id LIMIT $1", [BATCH]);
  if (!rows.length) break;
  let progress = 0;
  for (const r of rows) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(r.thumb);
    if (!m) { failed++; continue; }
    const path = `${r.employee_id}/${r.d}/${r.kind}-${r.id}-thumb.jpg`;
    if (DRY) { console.log("DRY thumb", r.id, "->", path); tdone++; progress++; continue; }
    const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { ...headers, "Content-Type": m[1], "x-upsert": "true" }, body: Buffer.from(m[2], "base64") });
    if (!up.ok) { console.warn("thumb upload fail id", r.id); failed++; continue; }
    await pool.query("UPDATE hr_punch_log SET thumb_path=$1, thumb=NULL WHERE id=$2", [path, r.id]);
    tdone++; progress++;
  }
  console.log("thumbs migrated so far:", tdone);
  if (DRY || progress === 0) break;
}
console.log(DRY ? "DRY RUN complete." : "Done.", { done, tdone, failed });
console.log("Space wapas lene ke liye Supabase SQL editor me chalayein: VACUUM FULL hr_punch_log;  (kam traffic ke time, table lock hota hai)");
await pool.end();

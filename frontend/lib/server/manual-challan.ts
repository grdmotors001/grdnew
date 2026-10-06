// Manual Challan (Factory handover slip) — Old Rickshaw Challan Voucher page par — factory se nikalne wali gaadi ka haath se bharne wala slip,
// ab system me: S.No, Date, Dealer, Chassis, Vehicle No., Toolkit / Keys / Charger / Colour / Mat / Stepney / Battery,
// extra fitments (jack, side mirror, wheel cover...), mobile aur signature line. Module key: old-rickshaw-challan.
// Ye slip stock / vehicle status ko touch nahi karta — sirf record + print ke liye hai.
import { pool, idOf, ymd, todayDate, addColumns } from "./common";
import { audit } from "./permissions";

export const MC_MODULE = "old-rickshaw-challan"; // isi page (Old Rickshaw Challan Voucher) ke existing permission lagenge
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const who = (a: any) => String(a?.username || a?.sub || "");
const t = (v: any, max = 200) => String(v ?? "").trim().slice(0, max);

let ready: Promise<void> | null = null;
export function ensureManualChallanSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS manual_challan (
        id bigserial PRIMARY KEY, sno text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE,
        dealer_id integer, dealer_name text NOT NULL, chassis_no text, vehicle_no text, model_name text,
        toolkit text, keys text, charger text, colour text, mat text, stepney text, battery text,
        extra_items text, contact_name text, contact_mobile text, remarks text,
        cancelled boolean NOT NULL DEFAULT false,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz)`);
      await pool.query("ALTER TABLE manual_challan ADD COLUMN IF NOT EXISTS old_rickshaw_id bigint");
      await pool.query("ALTER TABLE manual_challan ADD COLUMN IF NOT EXISTS sp_no text");
      await pool.query("CREATE INDEX IF NOT EXISTS manual_challan_date_idx ON manual_challan(date DESC, id DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS manual_challan_chassis_idx ON manual_challan(lower(chassis_no))");
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}


// ---- Dealer ke Old Rickshaw stock se jodna ----
// Manual Challan me dealer + vehicle no. ho to gaadi dealer ke Old Rickshaw stock (old_rickshaw, status available) me aa jaati hai,
// taaki Pending Sale > Old Rickshaw ke dropdown me dikhe. Bik chuki gaadi ko ye kabhi nahi chhedta.
async function ensureOldStockTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS old_rickshaw (
    id bigserial PRIMARY KEY, date date NOT NULL DEFAULT CURRENT_DATE, source text NOT NULL DEFAULT 'manual',
    vehicle_reg_no text NOT NULL, status text NOT NULL DEFAULT 'available',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await addColumns("old_rickshaw", { record_no: "text", vou_no: "text", challan_no: "text", dealer_id: "integer", dealer_name: "text",
    model_name: "text", colour: "text", chassis_no: "text", battery_maker: "text", charger: "text", mat: "text", toolkit: "text",
    stepney: "text", ledger_date: "date", remarks1: "text", sp_no: "text" });
  // Purane desktop table me ye columns integer ho sakte hain; "SP-22/2101" / "MC-2" jaisi values ke liye text chahiye.
  for (const c of ["sp_no", "record_no", "vou_no", "challan_no"]) {
    await pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='old_rickshaw' AND column_name='${c}' AND data_type<>'text') THEN
        ALTER TABLE old_rickshaw ALTER COLUMN "${c}" TYPE text USING "${c}"::text;
      END IF; END $$;`).catch((e) => console.error("[manual-challan] column type", c, e?.message));
  }
}

async function hasActiveSale(oldId: number): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 FROM grd_billing_sale WHERE old_rickshaw_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1", [oldId]);
    return !!r.rowCount;
  } catch { return false; }
}

// row = manual_challan ka saved row. Return: true = dealer stock se juda hai.
async function syncDealerStock(row: any): Promise<boolean> {
  await ensureOldStockTable();
  const linked = idOf(row.old_rickshaw_id);
  const wants = !row.cancelled && !!row.dealer_id && !!row.vehicle_no;
  const cur = linked ? (await pool.query("SELECT * FROM old_rickshaw WHERE id=$1", [linked])).rows[0] : null;
  if (!wants) {
    if (cur) {
      if (String(cur.status || "").toLowerCase() !== "available") throw fail("Is gaadi ki sale ho chuki hai, challan cancel / delete nahi ho sakta.", 409);
      if (await hasActiveSale(linked!)) throw fail("Is gaadi par Pending / Approved sale hai, pehle wo sale hatao.", 409);
      if (String(cur.source || "") === "manual-challan") await pool.query("DELETE FROM old_rickshaw WHERE id=$1", [linked]);
      await pool.query("UPDATE manual_challan SET old_rickshaw_id=NULL WHERE id=$1", [row.id]);
    }
    return false;
  }
  const dup = await pool.query("SELECT id FROM old_rickshaw WHERE upper(btrim(vehicle_reg_no))=upper(btrim($1)) AND lower(COALESCE(status,''))='available' AND ($2::bigint IS NULL OR id<>$2) LIMIT 1", [row.vehicle_no, linked]);
  if (dup.rowCount) throw fail("Vehicle No. " + row.vehicle_no + " pehle se kisi ke Old Rickshaw stock me hai.", 409);
  const f: any = { date: ymd(row.date), source: "manual-challan", record_no: "MC-" + row.sno, vou_no: row.sno, challan_no: row.sno, ledger_date: ymd(row.date),
    dealer_id: row.dealer_id, dealer_name: row.dealer_name, vehicle_reg_no: row.vehicle_no, model_name: row.model_name || "", colour: row.colour || "",
    chassis_no: row.chassis_no || "", battery_maker: row.battery || "", charger: row.charger || "", mat: row.mat || "", toolkit: row.toolkit || "",
    stepney: row.stepney || "", remarks1: row.remarks || "" };
  if (row.sp_no) f.sp_no = row.sp_no;
  const fresh = !cur; if (fresh) f.status = "available";
  if (cur) {
    if (String(cur.status || "").toLowerCase() !== "available") return true; // bik chuki gaadi ko mat chhedo
    const keys = Object.keys(f);
    await pool.query("UPDATE old_rickshaw SET " + keys.map((k, i) => `"${k}"=$${i + 1}`).join(",") + ",updated_at=NOW() WHERE id=$" + (keys.length + 1), [...keys.map((k) => f[k]), linked]);
    return true;
  }
  const keys = Object.keys(f);
  const ins = await pool.query("INSERT INTO old_rickshaw (" + keys.map((k) => `"${k}"`).join(",") + ") VALUES (" + keys.map((_, i) => "$" + (i + 1)).join(",") + ") RETURNING id", keys.map((k) => f[k]));
  await pool.query("UPDATE manual_challan SET old_rickshaw_id=$1 WHERE id=$2", [ins.rows[0].id, row.id]);
  return true;
}

const shape = (r: any) => ({ ...r, id: Number(r.id), date: ymd(r.date) });

// ---- SP No. (Old Rickshaw register) ----
// Format: SP-<register>/<serial>, jaise SP-22/2101. Ek register me 100 page hote hain => register = ceil(serial/100).
// Naya SP No. = ab tak ka sabse bada serial + 1 (sabse pehla: SP-22/2101). Challan form me editable rehta hai.
const SP_START = 2100; // pehla number SP-22/2101 hoga
export const spFormat = (serial: number) => "SP-" + Math.ceil(serial / 100) + "/" + serial;
export async function nextSpNo(): Promise<string> {
  const q = async (sql: string) => { try { return Number((await pool.query(sql)).rows[0]?.n || 0); } catch { return 0; } };
  const re = "'^SP-[0-9]+/[0-9]+$'";
  const a = await q(`SELECT COALESCE(MAX(split_part(sp_no,'/',2)::bigint),0) AS n FROM manual_challan WHERE sp_no ~ ${re}`);
  const b = await q(`SELECT COALESCE(MAX(split_part(sp_no,'/',2)::bigint),0) AS n FROM old_rickshaw WHERE sp_no ~ ${re}`);
  return spFormat(Math.max(SP_START, a, b) + 1);
}

// Dealer ka naam master se milao (case / extra space ignore) — form me dealer_id khaali reh jaye to bhi stock link ho.
async function resolveDealerId(name: string): Promise<number | null> {
  const r = await pool.query("SELECT id FROM dealer WHERE lower(btrim(name))=lower(btrim($1)) ORDER BY id LIMIT 2", [name]).catch(() => ({ rows: [] as any[] }));
  return r.rows.length === 1 ? Number(r.rows[0].id) : null;
}

// Pending Sale ka Old Rickshaw dropdown kholne par: is dealer ke purane challans jo stock se nahi jude, unhe jod do.
export async function healManualChallanStock(dealerId: number): Promise<void> {
  await ensureManualChallanSchema();
  const dn = await pool.query("SELECT btrim(name) AS name FROM dealer WHERE id=$1", [dealerId]).catch(() => ({ rows: [] as any[] }));
  const name = dn.rows[0]?.name || "";
  // Pehle ke bane challan-stock rows jinka status 'available' nahi set hua tha, unhe theek karo (bik chuki / sale wali gaadi ko nahi chhedta).
  await ensureOldStockTable();
  await pool.query(`UPDATE old_rickshaw o SET status='available',updated_at=NOW()
    WHERE o.source='manual-challan' AND o.dealer_id=$1 AND LOWER(COALESCE(btrim(o.status),'')) NOT IN ('available','sold')
      AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.old_rickshaw_id=o.id AND s.status IN ('PENDING','APPROVED','BILLED'))`, [dealerId]).catch((e) => console.error("[manual-challan] status repair", e?.message));
  const r = await pool.query(
    `SELECT * FROM manual_challan WHERE NOT cancelled AND old_rickshaw_id IS NULL AND COALESCE(btrim(vehicle_no),'')<>''
       AND (dealer_id=$1 OR (dealer_id IS NULL AND $2<>'' AND lower(btrim(dealer_name))=lower($2))) ORDER BY id`, [dealerId, name]);
  for (const row of r.rows) {
    try {
      if (!row.dealer_id) { await pool.query("UPDATE manual_challan SET dealer_id=$1 WHERE id=$2", [dealerId, row.id]); row.dealer_id = dealerId; }
      if (!row.sp_no) { row.sp_no = await nextSpNo(); await pool.query("UPDATE manual_challan SET sp_no=$1 WHERE id=$2", [row.sp_no, row.id]); }
      await syncDealerStock(shape(row));
    } catch (e) { console.error("[manual-challan heal]", row.id, (e as any)?.message); }
  }
}


async function nextSno(): Promise<string> {
  const r = await pool.query("SELECT COALESCE(MAX(sno::bigint),0)+1 AS n FROM manual_challan WHERE sno ~ '^[0-9]{1,15}$'");
  return String(r.rows[0]?.n || 1);
}

export async function manualChallanGet(req: Request): Promise<Response> {
  await ensureManualChallanSchema();
  const u = new URL(req.url), q = (k: string) => String(u.searchParams.get(k) || "").trim();
  const args: any[] = [], w: string[] = [];
  if (q("from")) { args.push(q("from")); w.push("date>=$" + args.length); }
  if (q("to")) { args.push(q("to")); w.push("date<=$" + args.length); }
  if (q("search")) {
    args.push("%" + q("search") + "%"); const n = args.length;
    w.push(`(sno ILIKE $${n} OR COALESCE(sp_no,'') ILIKE $${n} OR COALESCE(dealer_name,'') ILIKE $${n} OR COALESCE(chassis_no,'') ILIKE $${n} OR COALESCE(vehicle_no,'') ILIKE $${n} OR COALESCE(colour,'') ILIKE $${n} OR COALESCE(contact_mobile,'') ILIKE $${n})`);
  }
  const r = await pool.query("SELECT * FROM manual_challan" + (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY date DESC,id DESC LIMIT 1000", args);
  const dl = await pool.query("SELECT id, btrim(name) AS name, mobile FROM dealer WHERE COALESCE(btrim(name),'')<>'' ORDER BY 1").catch(() =>
    pool.query("SELECT id, btrim(name) AS name FROM dealer WHERE COALESCE(btrim(name),'')<>'' ORDER BY 1").catch(() => ({ rows: [] as any[] })));
  const co = (await pool.query("SELECT * FROM company ORDER BY id LIMIT 1").catch(() => ({ rows: [] as any[] }))).rows[0] || {};
  return Response.json({
    rows: r.rows.map(shape), count: r.rowCount, next_sno: await nextSno(), next_sp_no: await nextSpNo(),
    dealers: dl.rows.map((d: any) => ({ id: Number(d.id), name: d.name, mobile: d.mobile || "" })),
    company: { name: co.name || "G.R.D. MOTORS", address1: co.address1 || "", address2: co.address2 || "" },
  });
}

export async function manualChallanSave(b: any, a: any): Promise<Response> {
  await ensureManualChallanSchema();
  const id = idOf(b.id);
  const v = {
    sno: t(b.sno, 30), sp_no: t(b.sp_no, 30).toUpperCase(), date: ymd(b.date) || todayDate(), dealer_name: t(b.dealer_name), dealer_id: idOf(b.dealer_id),
    chassis_no: t(b.chassis_no, 60).toUpperCase(), vehicle_no: t(b.vehicle_no, 30).toUpperCase(), model_name: t(b.model_name),
    toolkit: t(b.toolkit, 60), keys: t(b.keys, 60), charger: t(b.charger, 60), colour: t(b.colour, 60), mat: t(b.mat, 60),
    stepney: t(b.stepney, 60), battery: t(b.battery, 120), extra_items: t(b.extra_items, 400),
    contact_name: t(b.contact_name, 100), contact_mobile: t(b.contact_mobile, 30), remarks: t(b.remarks, 400),
  };
  if (!v.dealer_name) throw fail("Dealer Name zaruri hai.");
  if (!v.chassis_no && !v.vehicle_no) throw fail("Chassis No. ya Vehicle No. me se kam se kam ek bharo.");
  if (!v.sno) v.sno = await nextSno();
  if (!v.dealer_id) v.dealer_id = (await resolveDealerId(v.dealer_name)) as any;
  if (!v.sp_no) v.sp_no = await nextSpNo();
  const dsp = await pool.query("SELECT id FROM manual_challan WHERE sp_no=$1 AND NOT cancelled AND ($2::bigint IS NULL OR id<>$2) LIMIT 1", [v.sp_no, id]);
  if (dsp.rowCount) throw fail("SP No. " + v.sp_no + " pehle se use ho chuka hai. Dusra number do.", 409);
  const dup = await pool.query("SELECT id FROM manual_challan WHERE sno=$1 AND NOT cancelled AND ($2::bigint IS NULL OR id<>$2) LIMIT 1", [v.sno, id]);
  if (dup.rowCount) throw fail("S. No. " + v.sno + " pehle se use ho chuka hai. Dusra number do.", 409);
  const cols = ["sno","sp_no","date","dealer_id","dealer_name","chassis_no","vehicle_no","model_name","toolkit","keys","charger","colour","mat","stepney","battery","extra_items","contact_name","contact_mobile","remarks"];
  const vals = cols.map((c) => (v as any)[c] === "" && c !== "sno" ? null : (v as any)[c]);
  let saved: any, old: any = null;
  if (id) {
    const cur = await pool.query("SELECT * FROM manual_challan WHERE id=$1", [id]);
    if (!cur.rowCount) throw fail("Manual Challan nahi mila.", 404);
    old = shape(cur.rows[0]);
    const set = cols.map((c, i) => `${c}=$${i + 1}`).join(",");
    saved = shape((await pool.query(`UPDATE manual_challan SET ${set},updated_by=$${cols.length + 1},updated_at=NOW() WHERE id=$${cols.length + 2} RETURNING *`, [...vals, who(a), id])).rows[0]);
  } else {
    const ph = cols.map((_, i) => "$" + (i + 1)).join(",");
    saved = shape((await pool.query(`INSERT INTO manual_challan (${cols.join(",")},created_by) VALUES (${ph},$${cols.length + 1}) RETURNING *`, [...vals, who(a)])).rows[0]);
  }
  const stock_linked = await syncDealerStock(saved);
  saved = shape((await pool.query("SELECT * FROM manual_challan WHERE id=$1", [saved.id])).rows[0]);
  await audit(a, MC_MODULE, id ? "edit" : "create", saved.id, old, saved, saved.dealer_id, saved.sno);
  return Response.json({ success: true, challan: saved, stock_linked }, { status: id ? 200 : 201 });
}

export async function manualChallanCancel(id: number, a: any): Promise<Response> {
  await ensureManualChallanSchema();
  const cur = await pool.query("SELECT * FROM manual_challan WHERE id=$1", [id]);
  if (!cur.rowCount) return Response.json({ error: "Manual Challan nahi mila." }, { status: 404 });
  const upd = await pool.query("UPDATE manual_challan SET cancelled=NOT cancelled,updated_by=$2,updated_at=NOW() WHERE id=$1 RETURNING *", [id, who(a)]);
  try { await syncDealerStock(upd.rows[0]); } catch (e) { await pool.query("UPDATE manual_challan SET cancelled=$2 WHERE id=$1", [id, cur.rows[0].cancelled]); throw e; }
  await audit(a, MC_MODULE, "edit", id, shape(cur.rows[0]), shape(upd.rows[0]), null, cur.rows[0].sno);
  return Response.json({ success: true, challan: shape(upd.rows[0]) });
}

export async function manualChallanDelete(id: number, a: any): Promise<Response> {
  await ensureManualChallanSchema();
  const cur = await pool.query("SELECT * FROM manual_challan WHERE id=$1", [id]);
  if (!cur.rowCount) return Response.json({ error: "Manual Challan nahi mila." }, { status: 404 });
  await syncDealerStock({ ...cur.rows[0], cancelled: true });
  await pool.query("DELETE FROM manual_challan WHERE id=$1", [id]);
  await audit(a, MC_MODULE, "delete", id, shape(cur.rows[0]), null, null, cur.rows[0].sno);
  return Response.json({ success: true });
}

export function manualChallanErr(e: any): Response {
  const status = Number(e?.status) || 500;
  if (status >= 500) console.error("[manual-challan]", e);
  return Response.json({ error: status >= 500 ? "Server error." : e.message }, { status });
}

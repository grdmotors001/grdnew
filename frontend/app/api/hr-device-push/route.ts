// BioMax N-WL20 bridge se raw punches leta hai aur hr_attendance me daalta hai.
// Auth: header  x-sync-key  == env BIOMAX_SYNC_KEY  (Vercel/Server env me set karein).
// Body: { location: "Showroom1", create_missing: false, punches: [ { code: "12", time: "2026-10-28T09:05:11" }, ... ] }
// "time" machine ka local (IST) time hai.
import { pool } from "@/lib/server/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const key = process.env.BIOMAX_SYNC_KEY || "";
  if (!key || req.headers.get("x-sync-key") !== key) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const b: any = await req.json().catch(() => ({}));
  const loc = String(b.location || "").trim();
  const create = b.create_missing === true;
  const punches: any[] = Array.isArray(b.punches) ? b.punches : [];
  if (!punches.length) return Response.json({ success: true, imported_days: 0, note: "no punches" });

  // employee -> date -> [times]
  const map = new Map<string, Map<string, string[]>>();
  for (const p of punches) {
    const code = String(p.code || "").trim();
    const m = String(p.time || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (!code || !m) continue;
    if (!map.has(code)) map.set(code, new Map());
    const d = map.get(code)!;
    if (!d.has(m[1])) d.set(m[1], []);
    d.get(m[1])!.push(m[2]);
  }

  const emps = (await pool.query("SELECT id,employee_code,machine_user_id,location FROM hr_employee")).rows as any[];
  const used = new Set(emps.map((x) => String(x.employee_code)));
  const ids: number[] = [], dates: string[] = [], ins: string[] = [], outs: string[] = [], hrs: number[] = [], sps: boolean[] = [];
  let matched = 0, created = 0, unknown: string[] = [];

  for (const [code, days] of map) {
    let emp = emps.find((x) => String(x.machine_user_id || "") === code && String(x.location || "") === loc);
    if (!emp && loc) emp = emps.find((x) => String(x.machine_user_id || "") === code && !String(x.location || "").trim());
    if (emp) matched++;
    else if (create) {
      let ec = loc ? loc + "-" + code : code, n = 2;
      while (used.has(ec)) ec = (loc ? loc + "-" + code : code) + "-" + n++;
      used.add(ec);
      const r = await pool.query("INSERT INTO hr_employee (employee_code,name,machine_user_id,location) VALUES ($1,$2,$3,$4) RETURNING id,employee_code,machine_user_id,location", [ec, ec, code, loc || null]);
      emp = r.rows[0]; emps.push(emp); created++;
    } else { unknown.push(code); continue; }

    for (const [date, times] of days) {
      times.sort();
      const first = times[0], last = times[times.length - 1];
      const single = times.length < 2 || first === last;
      const toSec = (t: string) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };
      ids.push(emp.id); dates.push(date);
      ins.push(date + "T" + first + "+05:30");
      outs.push(single ? "" : date + "T" + last + "+05:30");
      hrs.push(single ? 0 : Math.round(((toSec(last) - toSec(first)) / 3600) * 100) / 100);
      sps.push(single);
    }
  }

  if (ids.length) {
    await pool.query(
      `INSERT INTO hr_attendance (employee_id,work_date,first_in,last_out,status,work_hours,overtime_hours,single_punch)
       SELECT a,b,c,NULLIF(d,'')::timestamptz,'Present',e,0,f FROM unnest($1::bigint[],$2::date[],$3::timestamptz[],$4::text[],$5::numeric[],$6::boolean[]) AS t(a,b,c,d,e,f)
       ON CONFLICT (employee_id,work_date) DO UPDATE SET first_in=EXCLUDED.first_in,last_out=EXCLUDED.last_out,status='Present',work_hours=EXCLUDED.work_hours,single_punch=EXCLUDED.single_punch`,
      [ids, dates, ins, outs, hrs, sps]
    );
  }
  return Response.json({ success: true, imported_days: ids.length, matched, created, unknown_machine_ids: unknown });
}

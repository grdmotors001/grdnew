// HR salary calculation (slip ke hisaab se). Process Salary aur Slip "Save" dono yahi use karte hain.
// Per-day = Basic / 30 (aapki Excel slip me 22000 -> 733, mahina 31 din ka ho tab bhi 30).
export const HR_MONTH_DAYS = 30;

const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function hrSalaryFigures(e: any, present: number, ot: number, a: any) {
  const perDay = n(e.basic_salary) / HR_MONTH_DAYS;
  const basicEarned = perDay * present;
  const allowances = n(e.hra) + n(e.other_allowance);
  const otAmount = ot * n(e.overtime_rate);
  const extraAmount = perDay * n(a.extra_days);
  const holidayAmount = perDay * n(a.holiday_days);
  const net = basicEarned + allowances + otAmount + extraAmount - holidayAmount - n(a.advance) - n(a.pl_loan);
  return { perDay: r2(perDay), basicEarned: r2(basicEarned), allowances: r2(allowances), otAmount: r2(otAmount), net: r2(net) };
}

// Ek employee ka mahine ka salary row banata/update karta hai. adj = slip se aaye badlav (optional).
export async function hrSalaryOne(pool: any, e: any, month: string, adj: any | null) {
  const att = await pool.query(
    "SELECT COALESCE(SUM(CASE WHEN status='Present' THEN 1 WHEN status='Half Day' THEN 0.5 ELSE 0 END),0) AS present,COALESCE(SUM(overtime_hours),0) AS ot FROM hr_attendance WHERE employee_id=$1 AND to_char(work_date,'YYYY-MM')=$2",
    [e.id, month]);
  const old = (await pool.query("SELECT * FROM hr_salary WHERE employee_id=$1 AND salary_month=$2", [e.id, month])).rows[0] || {};
  const cur: any = {
    extra_days: n(old.extra_days), holiday_days: n(old.holiday_days), advance: n(old.advance), pl_loan: n(old.pl_loan),
    present_override: old.present_override === null || old.present_override === undefined ? null : n(old.present_override),
    paid_on: old.paid_on || null,
  };
  if (adj) {
    for (const k of ["extra_days", "holiday_days", "advance", "pl_loan"]) if (k in adj) cur[k] = Math.max(0, n(adj[k]));
    if ("present_override" in adj) cur.present_override = adj.present_override === null || adj.present_override === "" ? null : Math.max(0, n(adj.present_override));
    if ("paid_on" in adj) cur.paid_on = /^\d{4}-\d{2}-\d{2}$/.test(String(adj.paid_on || "")) ? String(adj.paid_on) : null;
  }
  const present = cur.present_override !== null ? cur.present_override : n(att.rows[0]?.present);
  const ot = n(att.rows[0]?.ot);
  const f = hrSalaryFigures(e, present, ot, cur);
  await pool.query(
    `INSERT INTO hr_salary (employee_id,salary_month,working_days,present_days,overtime_hours,basic_earned,allowances,overtime_amount,net_salary,status,extra_days,holiday_days,advance,pl_loan,present_override,paid_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROCESSED',$10,$11,$12,$13,$14,$15)
     ON CONFLICT(employee_id,salary_month) DO UPDATE SET working_days=EXCLUDED.working_days,present_days=EXCLUDED.present_days,overtime_hours=EXCLUDED.overtime_hours,basic_earned=EXCLUDED.basic_earned,allowances=EXCLUDED.allowances,overtime_amount=EXCLUDED.overtime_amount,net_salary=EXCLUDED.net_salary,status='PROCESSED',extra_days=EXCLUDED.extra_days,holiday_days=EXCLUDED.holiday_days,advance=EXCLUDED.advance,pl_loan=EXCLUDED.pl_loan,present_override=EXCLUDED.present_override,paid_on=EXCLUDED.paid_on`,
    [e.id, month, HR_MONTH_DAYS, present, ot, f.basicEarned, f.allowances, f.otAmount, f.net, cur.extra_days, cur.holiday_days, cur.advance, cur.pl_loan, cur.present_override, cur.paid_on]);
}

// Salary list / slip ke liye: employee ki detail + late summary ke saath.
const EPV_PAID_SUB = (extra: string) => "FROM expense_payment_voucher v WHERE v.hr_employee_id=s.employee_id AND v.salary_month=s.salary_month AND " + extra;
export const HR_SALARY_SELECT_PLAIN =
  "SELECT s.*,e.employee_code,e.name AS employee_name,e.department,e.designation,e.location,e.basic_salary,e.hra,e.other_allowance,e.overtime_rate," +
  "(SELECT COUNT(*) FROM hr_attendance a WHERE a.employee_id=s.employee_id AND to_char(a.work_date,'YYYY-MM')=s.salary_month AND a.late_minutes>0)::int AS late_days," +
  "(SELECT COALESCE(SUM(a.late_minutes),0) FROM hr_attendance a WHERE a.employee_id=s.employee_id AND to_char(a.work_date,'YYYY-MM')=s.salary_month)::int AS late_total_minutes " +
  "FROM hr_salary s JOIN hr_employee e ON e.id=s.employee_id WHERE ($1='' OR s.salary_month=$1) ORDER BY e.name";
// Salary voucher (Expense Payment Voucher) se Paid / Baaki: paid = payment_status 'paid', in_process = banaya par abhi paid nahi (rejected chhodkar).
export const HR_SALARY_SELECT =
  "SELECT s.*,e.employee_code,e.name AS employee_name,e.department,e.designation,e.location,e.basic_salary,e.hra,e.other_allowance,e.overtime_rate," +
  "(SELECT COUNT(*) FROM hr_attendance a WHERE a.employee_id=s.employee_id AND to_char(a.work_date,'YYYY-MM')=s.salary_month AND a.late_minutes>0)::int AS late_days," +
  "(SELECT COALESCE(SUM(a.late_minutes),0) FROM hr_attendance a WHERE a.employee_id=s.employee_id AND to_char(a.work_date,'YYYY-MM')=s.salary_month)::int AS late_total_minutes," +
  "(SELECT COALESCE(SUM(v.amount),0) " + EPV_PAID_SUB("lower(COALESCE(v.payment_status,''))='paid'") + ")::numeric AS paid_amount," +
  "(SELECT string_agg(DISTINCT lower(COALESCE(NULLIF(v.payment_mode,''),'cash')),', ') " + EPV_PAID_SUB("lower(COALESCE(v.payment_status,''))='paid'") + ") AS paid_modes," +
  "(SELECT MAX(v.paid_at) " + EPV_PAID_SUB("lower(COALESCE(v.payment_status,''))='paid'") + ") AS last_paid_at," +
  "(SELECT COALESCE(SUM(v.amount),0) " + EPV_PAID_SUB("lower(COALESCE(v.payment_status,''))<>'paid' AND lower(COALESCE(v.status,'')) NOT IN ('rejected','cancelled','canceled')") + ")::numeric AS in_process_amount " +
  "FROM hr_salary s JOIN hr_employee e ON e.id=s.employee_id WHERE ($1='' OR s.salary_month=$1) ORDER BY e.name";

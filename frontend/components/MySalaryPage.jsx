'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';

// Apni salary (mobile-friendly cards, slip jaisa table nahi) - sirf dekhne ke liye (koi edit / save nahi). Server token ke user ki hi salary deta hai.
const MONTH_DAYS = 30;
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const money = (v) => num(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthEnd = (m) => { if (!/^\d{4}-\d{2}$/.test(m || '')) return ''; const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo, 0).getDate(); return `${String(d).padStart(2, '0')}-${String(mo).padStart(2, '0')}-${y}`; };
const dmy = (v) => { const t = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('-') : ''; };
const monthName = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }); };

const timeIST = (v) => { if (!v) return '-'; const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }); };
const dateText = (v) => String(v || '').slice(0, 10);
const dow = (d) => { const t = new Date(dateText(d) + 'T00:00:00'); return isNaN(t) ? '' : t.toLocaleDateString('en-IN', { weekday: 'short' }); };
const lateText = (m) => { m = Number(m || 0); return m > 0 ? (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm' : '-'; };

export function MySalaryPage() {
  const [tab, setTab] = useState('salary');
  const [attMonth, setAttMonth] = useState(new Date().toISOString().slice(0, 7));
  const [att, setAtt] = useState(null);
  const [data, setData] = useState(null);
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    get('/hr/my-salary', { noClientCache: true })
      .then((d) => { setData(d); const first = (d.salaries || [])[0]; if (first) setMonth(first.salary_month); })
      .catch((e) => setError(e.message || 'Salary load nahi ho saki.'));
  }, []);

  useEffect(() => {
    if (tab !== 'attendance') return;
    setAtt(null);
    get('/hr/my-attendance?month=' + attMonth, { noClientCache: true })
      .then(setAtt)
      .catch((e) => setError(e.message || 'Attendance load nahi ho saki.'));
  }, [tab, attMonth]);

  const salaries = data?.salaries || [];
  const r = salaries.find((x) => x.salary_month === month);

  const stat = (label, val, color) => <div style={{ flex: '1 1 45%', background: 'var(--card)', border: '1px solid var(--line)', borderTop: '3px solid ' + color, borderRadius: 12, padding: '10px 12px' }}>
    <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
  </div>;
  const line = (label, value, sub, tone) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
    <div><div style={{ fontWeight: 600 }}>{label}</div>{sub ? <div className="muted" style={{ fontSize: 12 }}>{sub}</div> : null}</div>
    <div style={{ fontWeight: 700, color: tone || 'inherit', whiteSpace: 'nowrap' }}>{value}</div>
  </div>;
  const section = (title, children) => <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', marginTop: 12 }}>
    <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: .4, textTransform: 'uppercase', color: 'var(--muted)' }}>{title}</div>
    {children}
  </div>;

  let body = null;
  if (r) {
    const perDay = num(r.basic_salary) / MONTH_DAYS;
    const present = num(r.present_days), extra = num(r.extra_days), hol = num(r.holiday_days);
    const allow = num(r.allowances), ot = num(r.overtime_amount);
    const absent = Math.max(0, MONTH_DAYS - present);
    const paid = !!dmy(r.paid_on);
    body = (
      <div style={{ marginTop: 14 }}>
        <div style={{ borderRadius: 18, padding: '18px 16px', color: '#fff', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 85%, black), var(--accent))', boxShadow: '0 8px 22px color-mix(in srgb, var(--accent) 35%, transparent)' }}>
          <div style={{ opacity: .85, fontSize: 13 }}>{monthName(r.salary_month)}</div>
          <div style={{ opacity: .85, fontSize: 12, marginTop: 2 }}>Aapki net salary</div>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, marginTop: 4 }}>₹ {money(r.net_salary)}</div>
          <div style={{ marginTop: 10, display: 'inline-block', background: paid ? '#ffffff' : '#ffffff33', color: paid ? 'var(--accent)' : '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>{paid ? 'Mil chuki: ' + dmy(r.paid_on) : 'Abhi baaki hai'}</div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {stat('Present din', present, '#1e8e3e')}
          {stat('Absent din', absent, '#c0392b')}
          {stat('Extra din', extra, '#2563eb')}
          {stat('Holiday', hol, '#b7791f')}
        </div>

        {section('Kamai', <>
          {line('Monthly salary', '₹ ' + money(r.basic_salary), '₹ ' + Math.round(perDay) + ' per din')}
          {extra > 0 && line('Extra Sunday / Raat', '₹ ' + money(Math.round(perDay * extra)), extra + ' din')}
          {allow > 0 && line('Allowances (HRA + Other)', '₹ ' + money(allow))}
          {ot > 0 && line('Overtime', '₹ ' + money(ot), num(r.overtime_hours).toFixed(1) + ' ghante')}
        </>)}

        {section('Katauti', <>
          {line('Holiday katauti', '₹ ' + money(Math.round(perDay * hol)), hol + ' din', hol > 0 ? '#c0392b' : undefined)}
          {line('Salary advance', '₹ ' + money(r.advance), null, num(r.advance) > 0 ? '#c0392b' : undefined)}
          {line('PL loan', '₹ ' + money(r.pl_loan), null, num(r.pl_loan) > 0 ? '#c0392b' : undefined)}
        </>)}
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Late: {r.late_days || 0} din</p>
      </div>
    );
  }

  return <div className="page">
    <div className="pageHeader"><div><h2>My Salary</h2><p className="muted">Aapki salary aur attendance (sirf dekhne ke liye).</p></div></div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {!data && !error && <div className="card">Loading…</div>}
    {data && !data.linked && <div className="card">Aapka account abhi kisi employee se jura nahi hai. Kripya HR / Admin se kahein ki Employees me aapko aapke user se link kar dein.</div>}
    {data?.linked && <div className="tabs" style={{ marginBottom: 12 }}>
      <button className={'btn' + (tab === 'salary' ? ' primary' : '')} onClick={() => setTab('salary')}>Salary</button>{' '}
      <button className={'btn' + (tab === 'attendance' ? ' primary' : '')} onClick={() => setTab('attendance')}>Attendance</button>
    </div>}
    {data?.linked && tab === 'attendance' && (() => {
      const rows = att?.attendance || [];
      const days = rows.reduce((a, r) => a + (r.status === 'Present' ? 1 : r.status === 'Half Day' ? 0.5 : 0), 0);
      const lateDays = rows.filter((r) => Number(r.late_minutes) > 0).length;
      return <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div><strong style={{ fontSize: 18 }}>{data.employee.name}</strong><div className="muted">{data.employee.employee_code} · {data.employee.department || '-'}</div></div>
          <div className="field" style={{ minWidth: 200 }}><label>Mahina</label><input type="month" value={attMonth} onChange={(e) => e.target.value && setAttMonth(e.target.value)} /></div>
        </div>
        <div className="muted" style={{ margin: '10px 0' }}>Present: <strong>{days}</strong> din · Late: <strong>{lateDays}</strong> din · Work: <strong>{rows.reduce((a, r) => a + num(r.work_hours), 0).toFixed(2)}</strong> hr · OT: <strong>{rows.reduce((a, r) => a + num(r.overtime_hours), 0).toFixed(2)}</strong> hr</div>
        <div className="tableWrap" style={{ overflow: 'auto' }}><table className="table reportTable"><thead><tr><th>Date</th><th>Din</th><th>Punch In</th><th>Punch Out</th><th>Status</th><th>Late</th><th>Work Hrs</th><th>OT Hrs</th></tr></thead><tbody>
          {rows.map((x) => <tr key={dateText(x.work_date)}><td>{dateText(x.work_date)}</td><td>{dow(x.work_date)}</td><td>{timeIST(x.first_in)}</td><td>{x.single_punch ? <span className="muted">1 punch</span> : timeIST(x.last_out)}</td><td>{x.status}</td><td style={Number(x.late_minutes) > 0 ? { color: '#c0392b', fontWeight: 600 } : undefined}>{lateText(x.late_minutes)}</td><td>{num(x.work_hours).toFixed(2)}</td><td>{num(x.overtime_hours).toFixed(2)}</td></tr>)}
          {!rows.length && <tr><td colSpan="8" className="muted">{att ? 'Is mahine ki attendance nahi mili.' : 'Loading…'}</td></tr>}
        </tbody></table></div>
      </div>;
    })()}
    {data?.linked && tab === 'salary' && <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div><strong style={{ fontSize: 18 }}>{data.employee.name}</strong><div className="muted">{data.employee.employee_code} · {data.employee.department || '-'} · {data.employee.designation || '-'}</div></div>
        {salaries.length > 0 && <div className="field" style={{ minWidth: 220 }}><label>Mahina</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>{salaries.map((x) => <option key={x.salary_month} value={x.salary_month}>{monthName(x.salary_month)}</option>)}</select></div>}
      </div>
      {!salaries.length && <p className="muted" style={{ marginTop: 14 }}>Abhi is mahine ki salary tay nahi hui hai.</p>}
      {body}
      {r && <p className="muted" style={{ marginTop: 8 }}>Late: {r.late_days || 0} din.</p>}
    </div>}
  </div>;
}

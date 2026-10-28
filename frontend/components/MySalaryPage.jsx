'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';

// Apni salary slip - sirf dekhne ke liye (koi edit / save nahi). Server token ke user ki hi salary deta hai.
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

  const cell = { border: '1px solid #333', padding: '10px 12px', textAlign: 'center' };
  const hd = { ...cell, background: '#0b3361', color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: .5 };
  const lab = { ...cell, background: '#e3edf9', fontWeight: 800, fontSize: 13 };
  const val = { ...cell, fontWeight: 700, fontSize: 16 };
  const band = ['#e3edf9', '#ffffff'];
  const row = (i, label, a, b, c) => (
    <tr key={label}>
      <th style={{ ...lab, background: band[i % 2], textAlign: 'left', textTransform: 'uppercase' }}>{label}</th>
      <td style={{ ...val, background: band[i % 2] }}>{a ?? '-'}</td>
      <td style={{ ...val, background: band[i % 2] }}>{b ?? '-'}</td>
      <td style={{ ...val, background: band[i % 2] }}>{c ?? '-'}</td>
    </tr>
  );

  let body = null;
  if (r) {
    const perDay = num(r.basic_salary) / MONTH_DAYS;
    const present = num(r.present_days), extra = num(r.extra_days), hol = num(r.holiday_days);
    const allow = num(r.allowances), ot = num(r.overtime_amount);
    const absent = Math.max(0, MONTH_DAYS - present);
    let i = 0;
    body = (
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 14, border: '2px solid #0b3361', color: '#111' }}>
        <tbody>
          <tr><th style={{ ...hd, fontSize: 22, padding: '12px 8px' }} colSpan="3">CASH SALARIES</th><th style={{ ...hd, fontSize: 18 }}>EXTRA DETAILS</th></tr>
          <tr>
            <th style={lab}>EMPLOYEE NAME</th>
            <td style={{ ...cell, background: '#fff', fontWeight: 700, fontSize: 17 }} colSpan="2">{r.employee_name}</td>
            <td style={{ ...cell, background: '#fff', padding: 0 }}><div style={{ display: 'flex', alignItems: 'stretch' }}><div style={{ ...lab, border: 0, borderRight: '1px solid #333', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>PAY DATE</div><div style={{ flex: 1, fontWeight: 700, fontSize: 16, padding: '10px 6px', textAlign: 'center' }}>{monthEnd(r.salary_month)}</div></div></td>
          </tr>
          <tr><th style={hd}>DESCRIPTION</th><th style={hd}>AMOUNT (₹)</th><th style={hd}>PER DAY (₹)</th><th style={hd}>DAYS / EXTRA</th></tr>
          {row(i++, 'Salary (Monthly)', money(r.basic_salary), Math.round(perDay), MONTH_DAYS)}
          {row(i++, 'Present Days', present, '-', present)}
          {row(i++, 'Present Extra Sundays or Nights', extra, Math.round(perDay * extra), extra)}
          {row(i++, 'Absent Days', absent, '-', absent)}
          {row(i++, 'Holiday Deducted', hol, Math.round(perDay * hol), hol)}
          {allow > 0 && row(i++, 'Allowances (HRA + Other)', money(allow), '-', '-')}
          {ot > 0 && row(i++, 'Overtime (' + num(r.overtime_hours).toFixed(1) + ' hr)', money(ot), '-', '-')}
          {row(i++, 'Salary Loan Advances', money(r.advance), '-', '-')}
          {row(i++, 'PL Loan', money(r.pl_loan), '-', '-')}
          <tr>
            <th style={{ ...lab, background: '#e2f0d9', fontSize: 22, padding: '16px 8px' }}>NET SALARY</th>
            <td style={{ ...cell, background: '#176b1c', color: '#fff', fontWeight: 800, fontSize: 26 }}>{money(r.net_salary)}</td>
            <td style={{ ...val, background: '#e2f0d9' }}>-</td>
            <td style={{ ...cell, background: '#eef6e8', padding: 0 }}><div style={{ display: 'flex', alignItems: 'stretch' }}><div style={{ ...lab, border: 0, borderRight: '1px solid #333', background: '#e2f0d9', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>RELEASE DATE</div><div style={{ flex: 1, fontWeight: 700, fontSize: 16, padding: '10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{dmy(r.paid_on) || 'Abhi baaki'}</div></div></td>
          </tr>
        </tbody>
      </table>
    );
  }

  return <div className="page">
    <div className="pageHeader"><div><h2>My Salary</h2><p className="muted">Aapki apni salary slip aur punch in / out (sirf dekhne ke liye).</p></div></div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {!data && !error && <div className="card">Loading…</div>}
    {data && !data.linked && <div className="card">Aapka account abhi kisi employee se jura nahi hai. Kripya HR / Admin se kahein ki Employees me aapko aapke user se link kar dein.</div>}
    {data?.linked && <div className="tabs" style={{ marginBottom: 12 }}>
      <button className={'btn' + (tab === 'salary' ? ' primary' : '')} onClick={() => setTab('salary')}>Salary Slip</button>{' '}
      <button className={'btn' + (tab === 'attendance' ? ' primary' : '')} onClick={() => setTab('attendance')}>Punch In / Out</button>
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
    {data?.linked && tab === 'salary' && <div className="card">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div><strong style={{ fontSize: 18 }}>{data.employee.name}</strong><div className="muted">{data.employee.employee_code} · {data.employee.department || '-'} · {data.employee.designation || '-'}</div></div>
        {salaries.length > 0 && <div className="field" style={{ minWidth: 220 }}><label>Mahina</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>{salaries.map((x) => <option key={x.salary_month} value={x.salary_month}>{monthName(x.salary_month)}</option>)}</select></div>}
      </div>
      {!salaries.length && <p className="muted" style={{ marginTop: 14 }}>Abhi koi salary slip nahi bani hai.</p>}
      {body}
      {r && <p className="muted" style={{ marginTop: 8 }}>Late: {r.late_days || 0} din.</p>}
    </div>}
  </div>;
}

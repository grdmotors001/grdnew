'use client';
import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const money = (v) => Math.round(num(v)).toLocaleString('en-IN');
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dText = (v) => String(v || '').slice(0, 10);
const MONTH_DAYS = 30;

function Kpi({ label, value, sub, color }) {
  return <div className="card" style={{ borderTop: '4px solid ' + color }}>
    <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    <div style={{ fontSize: 30, fontWeight: 800, margin: '6px 0 2px' }}>{value}</div>
    {sub ? <div className="muted" style={{ fontSize: 12 }}>{sub}</div> : null}
  </div>;
}

// Simple SVG bar chart (koi library nahi chahiye)
function BarChart({ data, color = '#3f7edb', height = 220, fmt = (v) => v, rotate = false }) {
  if (!data.length) return <div className="muted">Data nahi mila.</div>;
  const W = Math.max(520, data.length * 34), H = height, padL = 40, padB = rotate ? 70 : 34, padT = 14;
  const max = Math.max(1, ...data.map(d => d.value));
  const step = (W - padL - 10) / data.length, bw = Math.min(26, step * 0.7);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return <div style={{ overflowX: 'auto' }}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: 'none' }}>
      {ticks.map(t => { const y = padT + (H - padT - padB) * (1 - t); return <g key={t}>
        <line x1={padL} x2={W - 6} y1={y} y2={y} stroke="#8884" strokeDasharray="3 3" />
        <text x={padL - 6} y={y + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity=".7">{fmt(max * t)}</text>
      </g>; })}
      {data.map((d, i) => {
        const h = (H - padT - padB) * (d.value / max), x = padL + i * step + (step - bw) / 2, y = padT + (H - padT - padB) - h;
        return <g key={i}>
          <rect x={x} y={y} width={bw} height={Math.max(h, 0)} rx="3" fill={d.color || color}><title>{d.label}: {fmt(d.value)}</title></rect>
          {d.value > 0 && <text x={x + bw / 2} y={y - 3} fontSize="9" textAnchor="middle" fill="currentColor" opacity=".8">{fmt(d.value)}</text>}
          {rotate
            ? <text transform={`translate(${x + bw / 2},${H - padB + 10}) rotate(40)`} fontSize="10" fill="currentColor" opacity=".8">{d.label}</text>
            : <text x={x + bw / 2} y={H - padB + 14} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".8">{d.label}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

export function HRDashboard() {
  const [day, setDay] = useState(istToday());
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [loc, setLoc] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const month = day.slice(0, 7);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [e, a, s] = await Promise.all([get('/hr/employees'), get('/hr/attendance?month=' + month), get('/hr/salary?month=' + month)]);
        if (off) return;
        setEmployees(e.employees || []); setAttendance(a.attendance || []); setSalaries(s.salaries || []);
      } catch (err) { if (!off) setError(err.message); }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [month]);

  const locations = useMemo(() => [...new Set(employees.map(e => e.location).filter(Boolean))], [employees]);
  const emps = useMemo(() => employees.filter(e => e.active !== false && (!loc || e.location === loc)), [employees, loc]);
  const empIds = useMemo(() => new Set(emps.map(e => String(e.id))), [emps]);
  const att = useMemo(() => attendance.filter(a => empIds.has(String(a.employee_id))), [attendance, empIds]);

  const d = useMemo(() => {
    const todayRows = att.filter(a => dText(a.work_date) === day && (a.status === 'Present' || a.status === 'Half Day'));
    const presentIds = new Set(todayRows.map(a => String(a.employee_id)));
    const absentList = emps.filter(e => !presentIds.has(String(e.id)));
    const late = todayRows.filter(a => num(a.late_minutes) > 0).length;

    // payable: processed salary ho to wahi, warna estimate (basic/30 x present + allowances)
    const sal = salaries.filter(s => empIds.has(String(s.employee_id)));
    let payable = 0, estimated = false;
    const byDept = {};
    if (sal.length) {
      for (const s of sal) { payable += num(s.net_salary); const k = s.department || 'Other'; byDept[k] = (byDept[k] || 0) + num(s.net_salary); }
    } else {
      estimated = true;
      const pd = {};
      for (const a of att) { pd[a.employee_id] = (pd[a.employee_id] || 0) + (a.status === 'Half Day' ? 0.5 : a.status === 'Absent' ? 0 : 1); }
      for (const e of emps) {
        const v = num(e.basic_salary) / MONTH_DAYS * (pd[e.id] || 0) + (pd[e.id] ? num(e.hra) + num(e.other_allowance) : 0);
        payable += v; const k = e.department || 'Other'; byDept[k] = (byDept[k] || 0) + v;
      }
    }
    // roz ka present count (month graph)
    const [y, m] = month.split('-').map(Number), dim = new Date(y, m, 0).getDate();
    const perDay = Array.from({ length: dim }, (_, i) => ({ label: String(i + 1), value: 0 }));
    for (const a of att) {
      if (a.status === 'Absent') continue;
      const dd = Number(dText(a.work_date).slice(8, 10));
      if (dd >= 1 && dd <= dim) perDay[dd - 1].value += 1;
    }
    for (const p of perDay) p.color = month + '-' + String(p.label).padStart(2, '0') === day ? '#d17b08' : '#3f7edb';
    const deptData = Object.entries(byDept).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    // location wise aaj
    const locMap = {};
    for (const e of emps) { const k = e.location || 'No location'; locMap[k] = locMap[k] || { total: 0, present: 0 }; locMap[k].total++; if (presentIds.has(String(e.id))) locMap[k].present++; }
    return { present: presentIds.size, absentList, late, payable, estimated, perDay, deptData, locMap, processed: sal.length };
  }, [att, emps, salaries, empIds, day, month]);

  return <div>
    <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div><label className="muted" style={{ fontSize: 12 }}>Date</label><br /><input type="date" value={day} max={istToday()} onChange={e => e.target.value && setDay(e.target.value)} /></div>
      <div><label className="muted" style={{ fontSize: 12 }}>Location</label><br />
        <select value={loc} onChange={e => setLoc(e.target.value)}><option value="">All</option>{locations.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
      {loading && <span className="muted">Loading…</span>}
    </div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="grid" style={{ marginBottom: 14 }}>
      <Kpi label="Total Employees" value={emps.length} sub={loc || 'All locations'} color="#3f7edb" />
      <Kpi label="Present" value={d.present} sub={day} color="#279d8c" />
      <Kpi label="Absent" value={d.absentList.length} sub={d.late ? d.late + ' late aaye' : day} color="#c0392b" />
      <Kpi label={'Payable (' + month + ')'} value={'₹ ' + money(d.payable)} sub={d.estimated ? 'Estimate - Salary tab me Process Salary baaki hai' : d.processed + ' employees ki salary processed'} color="#8b67c9" />
    </div>

    <div className="card" style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Roz ka Present ({month})</h3>
      <BarChart data={d.perDay} />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, marginBottom: 14 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Department-wise Payable</h3>
        <BarChart data={d.deptData} color="#8b67c9" fmt={(v) => money(v)} rotate />
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Location-wise Present ({day})</h3>
        <table className="table"><thead><tr><th>Location</th><th>Present</th><th>Total</th><th>Absent</th></tr></thead><tbody>
          {Object.entries(d.locMap).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.present}</td><td>{v.total}</td><td style={v.total - v.present ? { color: '#c0392b', fontWeight: 600 } : undefined}>{v.total - v.present}</td></tr>)}
          {!Object.keys(d.locMap).length && <tr><td colSpan="4" className="muted">Koi employee nahi.</td></tr>}
        </tbody></table>
      </div>
    </div>

    <div className="card">
      <h3 style={{ marginTop: 0 }}>Absent ({day}) - {d.absentList.length}</h3>
      <div className="tableWrap" style={{ maxHeight: 320, overflow: 'auto' }}><table className="table"><thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Location</th></tr></thead><tbody>
        {d.absentList.map(e => <tr key={e.id}><td>{e.employee_code}</td><td>{e.name}</td><td>{e.department || '-'}</td><td>{e.location || '-'}</td></tr>)}
        {!d.absentList.length && <tr><td colSpan="4" className="muted">Sab present hain.</td></tr>}
      </tbody></table></div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Absent = jinka us din koi punch nahi. Sunday/holiday par bhi sab absent dikhenge.</p>
    </div>
  </div>;
}

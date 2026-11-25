'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';

const timeIST = (v) => { if (!v) return '-'; const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };
const dayName = (v) => { const d = new Date(String(v).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { weekday: 'short' }); };
const hourIST = () => Number(new Date().toLocaleString('en-IN', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })) % 24;

const inTone=(r)=>(!r.first_in||r.status==='Absent')?undefined:(Number(r.late_minutes)>0?{color:'#c0392b',fontWeight:700}:{color:'#1e8e3e',fontWeight:700});
const rowTint=(r)=>(!r.first_in||r.status==='Absent')?undefined:{background:Number(r.late_minutes)>0?'rgba(192,57,43,.12)':'rgba(30,142,58,.12)'};
// Sirf employee login ka Home: punch reminder, mahine ka Present / Late / Absent, profile reminder.
export function EmployeeHome({ setActive, user }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { get('/hr/employee-home', { noClientCache: true }).then(setD).catch((e) => setError(e.message || 'Load nahi hua.')); }, []);

  if (error) return <div className="page"><div className="error">{error}</div></div>;
  if (!d) return <div className="page"><div className="muted">Loading…</div></div>;
  if (!d.linked) return <div className="page"><div className="card">Aapka login kisi employee se juda nahi hai. Admin se HR &gt; Employees me link karwayein.</div></div>;

  const t = d.today, h = hourIST();
  const punchedIn = !!t?.first_in, punchedOut = !!t?.last_out && !t?.single_punch;
  let rem = null;
  if (!d.outlet) rem = null; // outlet wale hi app se punch karte hain
  else if (!punchedIn) rem = { tone: h >= 11 ? '#c0392b' : '#b7791f', text: h >= 11 ? 'Aapne abhi tak Punch In nahi kiya. Late ho rahe hain, abhi Punch In karein.' : 'Reminder: duty shuru karte hi Punch In karna na bhoolein.', btn: 'Punch In' };
  else if (!punchedOut) rem = { tone: h >= 17 ? '#c0392b' : '#2563eb', text: h >= 17 ? 'Duty khatam ho rahi hai, ghar jaane se pehle Punch Out zaroor karein.' : 'Punch In ho gaya (' + timeIST(t.first_in) + '). Shaam ko Punch Out karna na bhoolein.', btn: 'Punch Out' };
  else rem = { tone: '#1e8e3e', text: 'Aaj ka punch poora ho gaya. In ' + timeIST(t.first_in) + ' • Out ' + timeIST(t.last_out), btn: null };

  const card = (label, val, color) => <div className="card" style={{ flex: '1 1 130px', borderTop: '3px solid ' + color, textAlign: 'center' }}><div className="muted">{label}</div><div style={{ fontSize: 30, fontWeight: 800, color }}>{val}</div></div>;
  const stt = d.stats || {};

  return <div className="page">
    <div className="pageHeader"><div><h2>Namaste, {d.employee.name}</h2><p className="muted">{d.outlet ? d.outlet.name : (d.employee.location || d.employee.department || '')}</p></div></div>

    {rem && <div className="card" style={{ borderLeft: '4px solid ' + rem.tone, marginBottom: 12 }}>
      <div style={{ fontWeight: 600 }}>{rem.text}</div>
      {rem.btn && <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => setActive('punch')}>{rem.btn}</button></div>}
    </div>}

    {d.profile_missing?.length > 0 && <div className="card" style={{ borderLeft: '4px solid #b7791f', marginBottom: 12 }}>
      <div style={{ fontWeight: 600 }}>Aapki profile adhoori hai</div>
      <div className="muted">Bharna baaki: {d.profile_missing.join(', ')}</div>
      <div className="actions" style={{ marginTop: 10 }}><button className="btn" onClick={() => setActive('profile')}>Profile bharein</button></div>
    </div>}

    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      {card('Present', stt.present ?? 0, '#1e8e3e')}
      {card('Late', stt.late ?? 0, '#b7791f')}
      {card('Half Day', stt.half_day ?? 0, '#2563eb')}
      {card('Absent', stt.absent ?? 0, '#c0392b')}
    </div>
    <div className="muted" style={{ marginBottom: 12 }}>Is mahine ({d.month}) ka hisaab. Bina punch wale din (Sunday chhodkar) Absent gine jate hain.</div>

    <div className="card tableWrap">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Meri Attendance</div>
      <table className="table reportTable"><thead><tr><th>Date</th><th>Din</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>
        {(d.recent || []).map((r) => <tr key={String(r.work_date)} style={rowTint(r)}><td>{String(r.work_date).slice(0, 10)}</td><td>{dayName(r.work_date)}</td><td style={inTone(r)}>{timeIST(r.first_in)}</td><td>{r.single_punch ? '1 punch' : timeIST(r.last_out)}</td><td style={inTone(r)}>{r.status}{r.late_minutes > 0 ? ' • Late ' + r.late_minutes + 'm' : ''}</td></tr>)}
        {!(d.recent || []).length && <tr><td colSpan="5" className="muted">Is mahine abhi koi attendance nahi.</td></tr>}
      </tbody></table>
    </div>
  </div>;
}

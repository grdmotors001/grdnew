'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { DAY_NAMES } from '../lib/offDays';

// HR > Off / Holiday: department ka weekly off aur holiday list.
export function HROffHoliday() {
  const [data, setData] = useState({ weekly_off: [], holidays: [] });
  const [depts, setDepts] = useState([]);
  const [locs, setLocs] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hf, setHf] = useState({ holiday_date: '', name: '', location: '' });

  const load = async () => {
    setError('');
    try {
      const s = await get('/hr/off-settings', { noClientCache: true }); setData({ weekly_off: s.weekly_off || [], holidays: s.holidays || [] });
      let emps = []; let tm = []; let ol = [];
      try { emps = (await get('/hr/employees')).employees || []; } catch (_) {}
      try { tm = (await get('/hr/department-timings')).timings || []; } catch (_) {}
      try { ol = (await get('/hr/outlets')).outlets || []; } catch (_) {}
      const uniq = (a) => [...new Set(a.map(v => String(v || '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
      setDepts(uniq([...tm.map(t => t.department), ...emps.map(e => e.department)]));
      setLocs(uniq([...ol.map(o => o.name), ...emps.map(e => e.location)]));
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);

  const daysOf = (dept) => {
    const r = data.weekly_off.find(x => String(x.department).trim().toLowerCase() === dept.toLowerCase());
    return String(r ? r.days : (dept === '*' ? '0' : (data.weekly_off.find(x => x.department === '*')?.days ?? '0'))).split(',').filter(x => x !== '');
  };
  const hasRow = (dept) => data.weekly_off.some(x => String(x.department).trim().toLowerCase() === dept.toLowerCase());
  const toggle = async (dept, dow) => {
    const cur = daysOf(dept); const k = String(dow);
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    setBusy(true); setError(''); setMsg('');
    try { await post('/hr/off-settings/weekly', { department: dept, days: next.join(',') }); await load(); setMsg((dept === '*' ? 'Default' : dept) + ': weekly off save ho gaya.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const addHoliday = async () => {
    setBusy(true); setError(''); setMsg('');
    try { await post('/hr/holidays', hf); setHf({ holiday_date: '', name: '', location: '' }); await load(); setMsg('Holiday jod diya.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const delHoliday = async (h) => {
    if (!window.confirm(h.name + ' (' + h.holiday_date + ') hata dein?')) return;
    setBusy(true); setError('');
    try { await post('/hr/holidays/delete', { id: h.id }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const rows = ['*', ...depts];
  return <div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}

    <div className="card tableWrap">
      <h3 style={{ marginTop: 0 }}>Weekly Off</h3>
      <p className="muted" style={{ marginTop: 0 }}>Jis din ke saamne tick hai wo us department ka off din hai. Off din par punch na ho to Absent nahi ginta. <strong>Default</strong> un employees ke liye hai jinka department set nahi hai ya jis department ki alag setting nahi hai (shuruat me Sunday).</p>
      <table className="table reportTable"><thead><tr><th>Department</th>{DAY_NAMES.map(n => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr></thead><tbody>
        {rows.map(dept => { const cur = daysOf(dept); const own = dept === '*' || hasRow(dept); return <tr key={dept}>
          <td style={{ fontWeight: 600 }}>{dept === '*' ? 'Default (baaki sab)' : dept}{!own && <span className="muted" style={{ fontWeight: 400 }}> · default ke hisaab se</span>}</td>
          {DAY_NAMES.map((n, i) => <td key={n} style={{ textAlign: 'center' }}><input type="checkbox" disabled={busy} checked={cur.includes(String(i))} onChange={() => toggle(dept, i)} style={{ width: 18, height: 18 }} /></td>)}
        </tr>; })}
      </tbody></table>
    </div>

    <div className="card tableWrap" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Holiday</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="field"><label>Date</label><input type="date" value={hf.holiday_date} onChange={e => setHf({ ...hf, holiday_date: e.target.value })} /></div>
        <div className="field"><label>Holiday ka naam</label><input value={hf.name} placeholder="jaise Diwali" onChange={e => setHf({ ...hf, name: e.target.value })} /></div>
        <div className="field"><label>Location</label><select value={hf.location} onChange={e => setHf({ ...hf, location: e.target.value })}><option value="">Sab locations</option>{locs.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
        <button className="btn primary" disabled={busy || !hf.holiday_date || !hf.name.trim()} onClick={addHoliday}>Holiday jodein</button>
      </div>
      <table className="table reportTable"><thead><tr><th>Date</th><th>Holiday</th><th>Location</th><th></th></tr></thead><tbody>
        {data.holidays.map(h => <tr key={h.id}><td>{String(h.holiday_date).slice(0, 10).split('-').reverse().join('-')}</td><td>{h.name}</td><td>{h.location || 'Sab'}</td><td><button className="btn" disabled={busy} onClick={() => delHoliday(h)}>Hatayein</button></td></tr>)}
        {!data.holidays.length && <tr><td colSpan="4" className="muted">Abhi koi holiday nahi.</td></tr>}
      </tbody></table>
    </div>
  </div>;
}

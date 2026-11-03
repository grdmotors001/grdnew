'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';

// Monthly Delivery / Billed / Production - live, scrollable, koi bhi period.
const PER = 78;            // ek mahine ki chaudai (px) - isse zyada mahine ho to left/right scroll
const H = 300, T = 26, B = 40, YW = 46;
const REFRESH_MS = 60000;  // Live mode: har 60 sec me auto refresh

const SERIES = [
  { key: 'delivery_challan', name: 'Delivery Challan', color: 'var(--theme-accent)', dy: -10 },
  { key: 'tax_invoice', name: 'Tax Invoice (Billed)', color: 'var(--success,#16a34a)', dy: 17 },
  { key: 'production', name: 'Production', color: '#f59e0b', dash: '6 4', dy: 29 },
];

const istMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
const monthLabel = (m) => {
  const d = new Date(String(m) + '-01T00:00:00');
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};
const monthLong = (m) => {
  const d = new Date(String(m) + '-01T00:00:00');
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const n0 = (v) => Number(v || 0).toLocaleString('en-IN');

export function MonthlyTrendChart() {
  const cur = istMonth();
  const [from, setFrom] = useState(addMonths(cur, -11));
  const [to, setTo] = useState(cur);
  const [rows, setRows] = useState([]);
  const [minMonth, setMinMonth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState(null);
  const [hidden, setHidden] = useState({});
  const [showVals, setShowVals] = useState(false);
  const [hover, setHover] = useState(null);
  const [cw, setCw] = useState(900);

  const scrollRef = useRef(null);
  const needScroll = useRef(true);
  const drag = useRef(null);

  // ---------- data ----------
  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const r = await get('/dashboard/trend?from=' + from + '&to=' + to);
      setRows(r.rows || []);
      setMinMonth(r.min_month || null);
      setUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e.message || 'Chart load nahi hua');
    }
    if (!silent) setLoading(false);
  }, [from, to]);

  useEffect(() => { needScroll.current = true; load(false); }, [load]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) load(true); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, load]);

  // ---------- width / scroll ----------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const upd = () => setCw(el.clientWidth || 900);
    upd();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(upd); ro.observe(el); }
    else window.addEventListener('resize', upd);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', upd); };
  }, []);

  // Naya period / pehli baar: sabse latest mahina (right end) dikhao
  useEffect(() => {
    if (needScroll.current && rows.length && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
      needScroll.current = false;
    }
  }, [rows]);

  const nudge = (dir) => scrollRef.current && scrollRef.current.scrollBy({ left: dir * cw * 0.7, behavior: 'smooth' });

  const onDown = (e) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    const move = (ev) => {
      if (!drag.current) return;
      const dx = ev.clientX - drag.current.x;
      if (Math.abs(dx) > 3) drag.current.moved = true;
      el.scrollLeft = drag.current.left - dx;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setTimeout(() => { drag.current = null; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ---------- period controls ----------
  const setRange = (f, t) => {
    let a = f, b = t;
    if (a > b) { const x = a; a = b; b = x; }
    if (a < addMonths(b, -119)) a = addMonths(b, -119);   // max 10 saal
    setFrom(a); setTo(b); setHover(null);
  };
  const presets = [['6M', 6], ['12M', 12], ['24M', 24], ['36M', 36]];
  const activePreset = presets.find(([, n]) => from === addMonths(cur, -(n - 1)) && to === cur)?.[0];
  const allFrom = minMonth || addMonths(cur, -35);
  const isAll = !activePreset && from === allFrom && to === cur;

  // ---------- geometry ----------
  const n = rows.length;
  const W = Math.max(cw, n * PER);
  const slot = n ? W / n : W;
  const x = (i) => slot * (i + 0.5);

  const visible = SERIES.filter(s => !hidden[s.key]);
  const { max, ticks } = useMemo(() => {
    const vals = rows.flatMap(r => visible.map(s => Number(r[s.key] || 0)));
    const rawMax = Math.max(1, ...vals);
    const pow = Math.pow(10, Math.floor(Math.log10(rawMax / 4)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(st => rawMax / st <= 6) || 10 * pow;
    const mx = Math.ceil(rawMax / step) * step;
    return { max: mx, ticks: Array.from({ length: Math.round(mx / step) + 1 }, (_, i) => i * step) };
  }, [rows, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = (v) => T + (H - T - B) * (1 - v / max);

  const totals = useMemo(() => Object.fromEntries(SERIES.map(s => [s.key, rows.reduce((a, r) => a + Number(r[s.key] || 0), 0)])), [rows]);

  const pathFor = (key) => rows.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(r[key] || 0)).toFixed(1)).join(' ');

  const onMove = (e) => {
    if (!n || (drag.current && drag.current.moved)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - rect.left) / slot)));
    setHover(i);
  };

  const hr = hover != null ? rows[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) + 14, 4), Math.max(4, W - 210)) : 0;
  const flip = hover != null && x(hover) + 14 > W - 210;

  const btn = (active) => ({
    padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', font: 'inherit',
    border: '1px solid ' + (active ? 'var(--theme-accent)' : 'var(--line)'),
    background: active ? 'var(--theme-accent)' : 'transparent',
    color: active ? '#fff' : 'inherit',
  });

  return <div className="card" style={{ marginTop: 14 }}>
    <div className="pageHeader">
      <div>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Monthly Delivery / Billed / Production
          {live && <span title="Live: har 1 minute me auto refresh" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--success,#16a34a)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success,#16a34a)' }} />LIVE</span>}
        </h3>
        <p className="muted">{monthLong(from)} – {monthLong(to)} · {n} months{updated ? ' · updated ' + updated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : ''}</p>
      </div>
    </div>

    {/* Period controls */}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0 10px' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {presets.map(([l, k]) => <button key={l} style={btn(activePreset === l)} onClick={() => setRange(addMonths(cur, -(k - 1)), cur)}>{l}</button>)}
        <button style={btn(isAll)} onClick={() => setRange(allFrom, cur)} title="Sabse purana data se aaj tak">All</button>
      </div>
      <label className="muted" style={{ fontSize: 12 }}>From <input type="month" value={from} max={to} onChange={e => e.target.value && setRange(e.target.value, to < e.target.value ? e.target.value : to)} /></label>
      <label className="muted" style={{ fontSize: 12 }}>To <input type="month" value={to} min={from} max={cur} onChange={e => e.target.value && setRange(from > e.target.value ? e.target.value : from, e.target.value)} /></label>
      <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={showVals} onChange={e => setShowVals(e.target.checked)} />Values</label>
      <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />Live</label>
      <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => load(false)}>↻</button>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <button style={btn(false)} onClick={() => nudge(-1)} title="Left (purana)">◀</button>
        <button style={btn(false)} onClick={() => nudge(1)} title="Right (naya)">▶</button>
      </div>
    </div>

    {/* Legend (click se line hide/show) */}
    <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 6, flexWrap: 'wrap' }}>
      {SERIES.map(s => <button key={s.key} onClick={() => setHidden(h => ({ ...h, [s.key]: !h[s.key] }))}
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', opacity: hidden[s.key] ? 0.4 : 1, textDecoration: hidden[s.key] ? 'line-through' : 'none' }}
        title="Click: show / hide">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.name} <b>· {n0(totals[s.key])}</b>
      </button>)}
    </div>

    {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
    {loading && !rows.length ? <div className="muted" style={{ padding: 30 }}>Loading…</div> : <div style={{ display: 'flex' }}>
      {/* Fixed Y axis (scroll karne par bhi dikhta rahe) */}
      <svg width={YW} height={H} style={{ flex: '0 0 auto' }}>
        {ticks.map(t => <text key={t} x={YW - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.65">{n0(t)}</text>)}
      </svg>

      <div ref={scrollRef} onMouseDown={onDown}
        style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', cursor: n * PER > cw ? 'grab' : 'default', userSelect: 'none' }}>
        <div style={{ position: 'relative', width: W, height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onMove}>
          <svg width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Monthly delivery challan, tax invoice and production line graph">
            {ticks.map(t => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />)}
            {rows.map((r, i) => <text key={r.month} x={x(i)} y={H - 14} textAnchor="middle" fontSize="11" fill="currentColor" opacity={hover === i ? 1 : 0.65} fontWeight={hover === i ? 700 : 400}>{monthLabel(r.month)}</text>)}
            {hover != null && <rect x={slot * hover} y={T - 6} width={slot} height={H - T - B + 6} fill="currentColor" opacity="0.05" />}
            {visible.map(s => <g key={s.key}>
              <path d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash} />
              {rows.map((r, i) => {
                const v = Number(r[s.key] || 0);
                return <g key={r.month}>
                  <circle cx={x(i)} cy={y(v)} r={hover === i ? 6 : 3.5} fill={s.color} stroke="#fff" strokeWidth="1.5" />
                  {showVals && <text x={x(i)} y={y(v) + s.dy} textAnchor="middle" fontSize="10" fill={s.color} fontWeight="600">{n0(v)}</text>}
                </g>;
              })}
            </g>)}
          </svg>

          {hr && <div style={{
            position: 'absolute', top: 8, left: flip ? undefined : tipLeft, right: flip ? Math.max(4, W - x(hover) + 14) : undefined,
            width: 196, pointerEvents: 'none', zIndex: 5, padding: '8px 10px', borderRadius: 8, fontSize: 12,
            background: 'var(--card, #fff)', color: 'var(--ink, inherit)', border: '1px solid var(--line)', boxShadow: '0 4px 14px rgba(0,0,0,.15)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{monthLong(hr.month)}{hr.month === cur ? ' (chal raha hai)' : ''}</div>
            {SERIES.map(s => <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, opacity: hidden[s.key] ? 0.4 : 1 }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.name}</span>
              <b>{n0(hr[s.key])}</b>
            </div>)}
          </div>}
        </div>
      </div>
    </div>}
    <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>Tip: chart ko mouse se drag karke ya ◀ ▶ se left/right scroll karein. Upar From/To se purana period chunein. Legend par click se line hide/show hoti hai.</p>
  </div>;
}

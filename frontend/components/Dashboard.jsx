'use client';
import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { Pill, EmptyState, Money } from './ui';
import { formatDate } from '../lib/date';
import { NAV_GROUPS } from '../lib/menu';
import { Sliders, Factory, Receipt, CreditCard, Warehouse, Users, BarChart3, Settings2 } from 'lucide-react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (d) => (d || '').slice(0, 7); // 'YYYY-MM'
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};
const firstOfMonth = (key) => `${key}-01`;
const GROUP_ICONS = {
  Masters: Sliders, Factory: Factory, 'Sales & Billing': Receipt,
  Accounts: CreditCard, Inventory: Warehouse, HR: Users,
  Reports: BarChart3, System: Settings2,
};

const lastOfMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${key}-${String(last).padStart(2, '0')}`;
};

// Dashboard chart area: grouped bars + line trend + doughnut summary.
function MonthlyTrendChart({ months, series, selected, onSelect, stageData }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const width = 720;
  const height = 220;
  const padX = 28;
  const padY = 24;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2 - 18;
  const points = series[2]?.values || [];
  const point = (i, value) => {
    const x = months.length <= 1 ? width / 2 : padX + (i / (months.length - 1)) * plotW;
    const y = padY + plotH - (value / max) * plotH;
    return [x, y];
  };
  const linePoints = points.map((v, i) => point(i, v)).map(([x, y]) => `${x},${y}`).join(' ');
  const stageTotals = series.map((s) => ({
    ...s,
    total: Number(stageData?.[s.name] || 0),
  }));
  let offset = 0;

  return (
    <div className="dashboardCharts">
      <div className="trendChart">
        <div className="chartLegend">
          {series.map((s) => (
            <span key={s.name} className="chartLegendItem">
              <span className="chartSwatch" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
        <div className="chartLineWrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly trend line chart">
            <line x1={padX} x2={width - padX} y1={padY + plotH} y2={padY + plotH} stroke="var(--line)" />
            <polyline points={linePoints} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((v, i) => {
              const [x, y] = point(i, v);
              return <circle key={months[i]} cx={x} cy={y} r="5" fill="var(--card)" stroke="var(--accent)" strokeWidth="3" />;
            })}
          </svg>
          <div className="lineLabels">
            {months.map((mk) => (
              <button key={mk} className={mk === selected ? 'lineLabel active' : 'lineLabel'} onClick={() => onSelect(mk)}>
                {monthLabel(mk).split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
        <div className="chartHint">Tax Invoice trend · click a month to filter the dashboard</div>
      </div>

      <div className="stageDonutCard">
        <div className="donut" style={{ background: stageTotals.reduce((sum, s) => sum + s.total, 0) ? `conic-gradient(${stageTotals.map((s) => {
          const from = offset;
          offset += (s.total / stageTotals.reduce((sum, x) => sum + x.total, 0)) * 360;
          return `${s.color} ${from}deg ${offset}deg`;
        }).join(', ')})` : 'var(--line)'}}>
          <div className="donutInner">
            <strong>{stageTotals.reduce((sum, s) => sum + s.total, 0)}</strong>
            <span>Total</span>
          </div>
        </div>
        <div className="donutLegend">
          {stageTotals.map((s) => (
            <div key={s.name}><span className="chartSwatch" style={{ background: s.color }} /> <span>{s.name}</span><b>{s.total}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ setActive, user }) {
  const allowedFor = (items) => user?.is_super_user ? items : items.filter(([key]) => (user?.allowed_modules || []).includes(key));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(null); // 'YYYY-MM' or 'all'

  useEffect(() => {
    get('/dashboard').then(setD).catch((e) => setError(e.message));
  }, []);

  const all = useMemo(() => {
    if (!d) return [];
    return [
      ...d.manufacturing.map((v) => ({ ...v, _stage: 'Manufacturing' })),
      ...d.delivery_challan.map((v) => ({ ...v, _stage: 'Delivery Challan' })),
      ...d.tax_invoice.map((v) => ({ ...v, _stage: 'Tax Invoice' })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [d]);

  // The backend now aggregates the 17k+ vehicle history in SQL. Do not
  // rebuild monthly counts by filtering the preview rows in the browser.
  const months = useMemo(() => {
    const keys = (d?.monthly || []).map((m) => m.month).filter(Boolean);
    if (keys.length === 0) keys.push(monthKey(new Date().toISOString()));
    return keys.slice(-12);
  }, [d]);

  // Default to the most recent month once data has loaded.
  useEffect(() => {
    if (selectedMonth === null && months.length) setSelectedMonth(months[months.length - 1]);
  }, [months, selectedMonth]);

  const series = useMemo(() => {
    const byMonth = Object.fromEntries((d?.monthly || []).map((m) => [m.month, m]));
    return [
      { name: 'Manufacturing', color: 'var(--accent)', values: months.map((mk) => Number(byMonth[mk]?.manufacturing || 0)) },
      { name: 'Delivery Challan', color: 'var(--orange)', values: months.map((mk) => Number(byMonth[mk]?.delivery_challan || 0)) },
      { name: 'Tax Invoice', color: 'var(--green)', values: months.map((mk) => Number(byMonth[mk]?.tax_invoice || 0)) },
    ];
  }, [d, months]);

  const filteredAll = selectedMonth === 'all' ? all : all.filter((v) => monthKey(v.date) === selectedMonth);

  // Billing split is included in the dashboard response, so changing the
  // month no longer triggers a second GST Register API call.
  const billed = useMemo(() => {
    const rows = d?.billed_monthly || [];
    if (!rows.length) return { interstateCount: 0, interstateTaxable: 0, localCount: 0, localTaxable: 0 };
    const selected = selectedMonth === 'all'
      ? rows
      : rows.filter((r) => r.month === selectedMonth);
    return selected.reduce((out, r) => ({
      interstateCount: out.interstateCount + Number(r.interstateCount || 0),
      interstateTaxable: out.interstateTaxable + Number(r.interstateTaxable || 0),
      localCount: out.localCount + Number(r.localCount || 0),
      localTaxable: out.localTaxable + Number(r.localTaxable || 0),
    }), { interstateCount: 0, interstateTaxable: 0, localCount: 0, localTaxable: 0 });
  }, [d, selectedMonth]);

  if (error) return <div className="error">{error}</div>;
  if (!d) return <div className="card">Loading dashboard…</div>;

  return (
    <>
      <div className="adminModuleGrid">
        {Object.entries(NAV_GROUPS).map(([group, items]) => {
          const allowed = allowedFor(items);
          if (!allowed.length) return null;
          const Icon = GROUP_ICONS[group] || Settings2;
          return (
            <button key={group} type="button" className="adminModuleTile" onClick={() => setActive(allowed[0][0])}>
              <div className="adminModuleTileIcon"><Icon size={20} /></div>
              <div className="adminModuleTileBody">
                <strong>{group}</strong>
                <span>{allowed.length} modules</span>
                <small>{allowed.slice(0, 3).map(([, label]) => label).join(' · ')}{allowed.length > 3 ? ' · …' : ''}</small>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid">
        <div className="card">
          <span className="muted">Manufacturing</span>
          <div className="metric">{d.manufacturing.length}</div>
        </div>
        <div className="card">
          <span className="muted">Delivery Challan</span>
          <div className="metric">{d.delivery_challan.length}</div>
        </div>
        <div className="card">
          <span className="muted">Tax Invoice</span>
          <div className="metric">{d.tax_invoice.length}</div>
        </div>
        <div className="card">
          <span className="muted">Total Vehicles</span>
          <div className="metric">{all.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <b>Monthly Trend</b>
          <select className="input" value={selectedMonth || ''} onChange={(e) => setSelectedMonth(e.target.value)} style={{ maxWidth: 200 }}>
            {months.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
            <option value="all">All time</option>
          </select>
        </div>
        <MonthlyTrendChart months={months} series={series} selected={selectedMonth} onSelect={setSelectedMonth} stageData={d.stage_counts} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <b>Billed — Interstate vs Local {selectedMonth && selectedMonth !== 'all' ? `(${monthLabel(selectedMonth)})` : '(All time)'}</b>
        <div className="grid" style={{ marginTop: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className="card" style={{ boxShadow: 'none' }}>
              <span className="muted">Interstate (IGST)</span>
              <div className="metric">{billed.interstateCount}</div>
              <div className="muted"><Money value={billed.interstateTaxable} /> taxable</div>
            </div>
            <div className="card" style={{ boxShadow: 'none' }}>
              <span className="muted">Local (CGST + SGST)</span>
              <div className="metric">{billed.localCount}</div>
              <div className="muted"><Money value={billed.localTaxable} /> taxable</div>
            </div>
          </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <b>Chassis Pipeline {selectedMonth && selectedMonth !== 'all' ? `— ${monthLabel(selectedMonth)}` : ''}</b>
          <button className="btn" onClick={() => setActive('production-voucher')}>+ New Production Voucher</button>
        </div>
        {filteredAll.length === 0 ? <EmptyState text="No vehicles yet — start with a Production Voucher." /> : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Chassis No.</th><th>Model</th><th>Motor No.</th><th>Colour</th><th>Dealer</th><th>Stage</th></tr>
              </thead>
              <tbody>
                {filteredAll.map((v) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.date)}</td>
                    <td><b>{v.chassis_no}</b></td>
                    <td>{v.model_name}</td>
                    <td>{v.motor_no}</td>
                    <td>{v.colour}</td>
                    <td>{v.dealer_name || '—'}</td>
                    <td>
                      <Pill
                        text={v._stage}
                        kind={v._stage === 'Manufacturing' ? 'm' : v._stage === 'Delivery Challan' ? 'd' : 't'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

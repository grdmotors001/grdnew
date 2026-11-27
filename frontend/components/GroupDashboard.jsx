'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { labelFor } from '../lib/menu';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const inr = (v) => '₹ ' + num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const GROUPS = {
  Masters: { api: 'masters', title: 'Masters Dashboard', hint: 'Har master me kitne record hain. Kisi card par dabayein to wo master khulega.' },
  Vouchers: { api: 'vouchers', title: 'Vouchers Dashboard', hint: 'Har voucher ki total entries aur total amount. Kisi card par dabayein to wo voucher khulega.' },
  Factory: { api: 'factory', title: 'Factory Dashboard', hint: 'Factory ke har option ki total entries (jahan amount hai wahan total bhi). Card par dabayein to wo khulega.' },
  'Sales & Billing': { api: 'sales', title: 'Sales & Billing Dashboard', hint: 'Sales ke har option ki total entries aur (jahan amount hai) total. Card par dabayein to wo khulega.' },
  Expenses: { api: 'expenses', title: 'Expenses Dashboard', hint: 'Expenses ke har option ki total entries aur total amount. Card par dabayein to wo khulega.' },
  System: { api: 'system', title: 'System Dashboard', hint: 'Users, audit log, menu, employees aur punch ka hisaab, aur system ke shortcuts. Card par dabayein to wo khulega.' },
  Reports: { api: 'reports', title: 'Reports Dashboard', hint: 'Reports ke registers ki entries aur amount. Card par dabayein to wo report khulegi.' },
  Cashier: { api: 'cashier', title: 'Cashier Dashboard', hint: 'Cashier ke har option ki entries aur amount. Card par dabayein to wo khulega.' },
  Accounts: { api: 'accounts', title: 'Accounts Dashboard', hint: 'Accounts ke har option ki entries. Reports wale card par dabayein to wo khulega.' },
  Inventory: { api: 'inventory', title: 'Inventory Dashboard', hint: 'Inventory ke har option ka stock / entries. Card par dabayein to wo khulega.' },
  Battery: { api: 'battery', title: 'Battery Dashboard', hint: 'Battery ke har option ki total entries. Card par dabayein to wo khulega.' },
};
const COLORS = ['#3f7edb', '#1fa971', '#e8912d', '#8e5bd6', '#d6455d', '#2aa5b8', '#6b7c90', '#c9a227', '#4c9a2a', '#b5547a'];

// Pichhle 6 mahine ka chhota bar graph (card ke andar).
function lastMonths(n) {
  const out = [], d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'), label: x.toLocaleDateString('en-IN', { month: 'short' }) });
  }
  return out;
}
function Spark({ trend, color, useAmount }) {
  if (!Array.isArray(trend) || !trend.some((x) => num(x.n) > 0)) return null;
  const months = lastMonths(6);
  const vals = months.map((m) => { const r = trend.find((x) => x.m === m.key); return r ? num(useAmount && r.t != null ? r.t : r.n) : 0; });
  const max = Math.max(1, ...vals);
  return <div style={{ marginTop: 10 }} title="Pichhle 6 mahine">
    <svg viewBox="0 0 120 34" width="100%" height="34" preserveAspectRatio="none" role="img" aria-label="Pichhle 6 mahine ka graph">
      {vals.map((v, i) => { const h = Math.max(v > 0 ? 3 : 1, (v / max) * 26); return <g key={i}>
        <title>{months[i].label}: {useAmount ? inr(v) : v.toLocaleString('en-IN')}</title>
        <rect x={i * 20 + 3} y={28 - h} width="14" height={h} rx="2" fill={color} opacity={i === vals.length - 1 ? 1 : 0.55} />
      </g>; })}
    </svg>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.6 }}>{months.map((m) => <span key={m.key}>{m.label}</span>)}</div>
  </div>;
}

// Upar ka bada graph: har option ka total (entries ya amount), seedhe dikhta hai kaun sa option kitna bada hai.
function BarList({ title, rows, fmt }) {
  const list = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  if (!list.length) return null;
  const max = Math.max(...list.map((r) => r.value));
  return <div className="card" style={{ minWidth: 0 }}>
    <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
    {list.map((r) => <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,38%) 1fr auto', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
      <div style={{ background: 'rgba(128,128,128,.15)', borderRadius: 6, height: 14 }}><div style={{ width: Math.max(3, (r.value / max) * 100) + '%', height: '100%', background: r.color, borderRadius: 6 }} /></div>
      <strong>{fmt(r.value)}</strong>
    </div>)}
  </div>;
}

function Card({ label, color, onClick, children }) {
  return <div className="card" onClick={onClick} role="button" tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    title="Kholne ke liye dabayein"
    style={{ borderTop: '4px solid ' + color, cursor: 'pointer' }}>
    <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
    {children}
  </div>;
}

export function GroupDashboard({ group = 'Masters', setActive }) {
  const cfg = GROUPS[group] || GROUPS.Masters;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const d = await get('/group-dashboard?group=' + cfg.api, { noClientCache: true });
        if (!off) setData(d);
      } catch (e) { if (!off) setError(e.message || 'Dashboard load nahi hua.'); }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [cfg.api, tick]);

  const items = data?.items || [];
  const showAmount = !!data?.show_amount;
  const totalRecords = items.reduce((s, x) => s + num(x.count), 0);

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{cfg.title}</h2>
        <div className="muted" style={{ fontSize: 13 }}>{cfg.hint}</div>
      </div>
      <button type="button" className="btn" onClick={() => setTick((t) => t + 1)} disabled={loading}>{loading ? 'Load ho raha hai...' : 'Refresh'}</button>
    </div>

    {error ? <div className="error">{error}</div> : null}

    {!error && !loading && !items.length ? <div className="muted">Is tab me aapke liye koi option allow nahi hai.</div> : null}

    {items.length > 0 && group === 'Masters' ? <div className="card" style={{ marginBottom: 12 }}>
      <span className="muted">Total records (sabhi masters)</span>{' '}
      <strong style={{ fontSize: 22 }}>{totalRecords.toLocaleString('en-IN')}</strong>
    </div> : null}

    {items.some((x) => x.count != null) ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginBottom: 12 }}>
      <BarList title="Option-wise total entries" rows={items.map((x, i) => ({ key: x.key, label: x.label || labelFor(x.key), value: num(x.count), color: COLORS[i % COLORS.length] }))} fmt={(v) => v.toLocaleString('en-IN')} />
      <BarList title="Is mahine ki entries" rows={items.map((x, i) => ({ key: x.key, label: x.label || labelFor(x.key), value: num(x.month_count), color: COLORS[i % COLORS.length] }))} fmt={(v) => v.toLocaleString('en-IN')} />
      {showAmount ? <BarList title="Option-wise total amount" rows={items.filter((x) => !x.unit).map((x, i) => ({ key: x.key, label: x.label || labelFor(x.key), value: num(x.total), color: COLORS[i % COLORS.length] }))} fmt={inr} /> : null}
    </div> : null}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
      {items.map((it, i) => {
        const color = COLORS[i % COLORS.length];
        const open = () => setActive && setActive(it.open || it.key);
        const label = it.label || labelFor(it.key);
        if (it.link) {
          return <Card key={it.key} label={label} color={color} onClick={open}>
            <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Details ke liye kholein →</div>
          </Card>;
        }
        if (it.error || it.count == null) {
          return <Card key={it.key} label={label} color={color} onClick={open}>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Data abhi nahi mila</div>
          </Card>;
        }
        return <Card key={it.key} label={label} color={color} onClick={open}>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '6px 0 2px' }}>{it.count.toLocaleString('en-IN')}</div>
          <div className="muted" style={{ fontSize: 12 }}>{group === 'Masters' || ['battery-maker', 'rto', 'financer', 'vahan-inventory', 'expense-type', 'expense-head', 'sys-users', 'sys-users-pin', 'sys-tabs', 'sys-employees', 'sys-employees-login'].includes(it.key) ? 'records' : 'entries'}{it.note ? ' · ' + it.note : ''}</div>
          {showAmount && it.total != null ? <div style={{ marginTop: 6, fontWeight: 700 }}>{it.unit ? num(it.total).toLocaleString('en-IN') + ' ' + it.unit : inr(it.total)}</div> : null}
          {group !== 'Masters' ? <Spark trend={it.trend} color={color} useAmount={showAmount && it.total != null && !it.unit} /> : null}
          {group !== 'Masters' && it.month_count != null ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Is mahine: {it.month_count.toLocaleString('en-IN')}
            {showAmount && it.month_total != null ? ' · ' + (it.unit ? num(it.month_total).toLocaleString('en-IN') + ' ' + it.unit : inr(it.month_total)) : ''}
          </div> : null}
        </Card>;
      })}
    </div>
  </div>;
}

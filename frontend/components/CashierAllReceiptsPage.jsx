'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Money, ErrorBanner } from './ui';

const fmtDate = d => { const x = String(d || '').slice(0, 10).split('-'); return x.length === 3 ? `${x[2]}-${x[1]}-${x[0]}` : (d || '—'); };

// Cashier: sirf Head Office me aaya CASH (Day Book receipts + accept hue handover). Showroom / branch ki apni receipts yahan nahi aati. Read only.
export function CashierAllReceiptsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const r = await get('/cashier/all-receipts', { noClientCache: true }); setRows(r.receipts || r.rows || []); }
    catch (e) { setError(e.message || 'Receipts load nahi hui'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const q = search.trim().toLowerCase();
  const list = rows.filter(r => {
    const d = String(r.date || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return !q || [r.vr_no, r.party, r.narration, r.amount].join(' ').toLowerCase().includes(q);
  });
  const total = list.reduce((t, r) => t + Number(r.amount || 0), 0);

  return (
    <div>
      <div className="pageHeader"><div><h1>All Receipts — Cash</h1><p className="muted">Head Office me aaya cash aur receipts (branch / showroom ki apni receipts shamil nahi)</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
      <ErrorBanner message={error} />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted">Total Cash Receipts ({list.length})</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}><Money value={total} /></div>
      </div>
      <div className="actions" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Search vr no., party, narration…" value={search} onChange={e => setSearch(e.target.value)} />
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} title="From" />
        <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} title="To" />
        <button className="btn" onClick={() => { setSearch(''); setFrom(''); setTo(''); }}>Clear</button>
      </div>
      <div className="tablewrap"><table className="table">
        <thead><tr><th>Date</th><th>Vr. No.</th><th>Received From</th><th>Narration</th><th>Amount</th></tr></thead>
        <tbody>
          {list.map(r => (
            <tr key={r.id}>
              <td>{fmtDate(r.date)}</td><td><b>{r.vr_no ?? '—'}</b></td><td>{r.party || '—'}</td>
              <td>{r.narration || '—'}</td><td><b><Money value={r.amount} /></b></td>
            </tr>
          ))}
          {!loading && !list.length && <tr><td colSpan="5" className="muted">Koi cash receipt nahi mili.</td></tr>}
          {loading && <tr><td colSpan="5" className="muted">Loading…</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

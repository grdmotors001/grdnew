'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner, EmptyState } from './ui';
import { formatDate } from '../lib/date';

// Seized Stock = CHFPL repo vehicles that are still on HOLD.
//   scope="factory" -> vehicles parked at GRD Factory (Inventory > Seized Stock)
//   scope="dealers" -> vehicles parked at showrooms / dealers
// Available for Sale / Sold vehicles never show here; they move to Old Rickshaw stock.
export function SeizedStockPage({ scope = 'factory' }) {
  const [data, setData] = useState({ rows: [], summary: { total: 0, factory: 0, dealers: 0 } });
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const isFactory = scope === 'factory';

  const load = async () => {
    try {
      setError('');
      const r = await get('/inventory/seized-stock?location=' + (isFactory ? 'factory' : 'dealers') + '&search=' + encodeURIComponent(search), { noClientCache: true });
      setData(r);
    } catch (e) {
      setError(e.message || 'Could not load Seized Stock.');
    } finally {
      setLoading(false);
    }
  };

  // CHFPL is the source of truth: pull its latest HOLD / Available for Sale status first.
  useEffect(() => { post('/inventory/old-rickshaw/sync-chfpl', {}).catch(() => {}).finally(load); }, [scope]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const rows = data.rows || [];
  const count = isFactory ? data.summary?.factory : data.summary?.dealers;

  return <div className="page">
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{isFactory ? 'Seized Stock — Factory' : 'Seized Vehicles — Showroom / Dealer'}</h2>
          <div className="muted">
            {isFactory
              ? 'CHFPL se aayi seized (HOLD) gaadiyan jo GRD Factory me park hain. Available for Sale hote hi ye yahan se hat jaati hain.'
              : 'CHFPL ki HOLD gaadiyan jo dealer / showroom par park hain. Available for Sale hote hi ye Old Rickshaw stock me chali jaati hain.'}
          </div>
        </div>
        <div className="actions">
          <input className="input" style={{ maxWidth: 260 }} placeholder="Search vehicle / model / dealer…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn" onClick={load}>↻ Refresh</button>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <span className="pill d">HOLD {count || 0}</span>
      </div>
    </div>
    <ErrorBanner message={error} />
    {loading ? <div className="card">Loading…</div> : !rows.length ? <EmptyState text={isFactory ? 'Factory me koi seized rickshaw nahi hai.' : 'Dealer / showroom par koi seized rickshaw nahi hai.'} /> :
      <div className="card"><div className="tablewrap"><table className="table">
        <thead><tr>
          <th>Status</th><th>Vehicle No.</th><th>Model</th><th>Colour</th><th>Battery Make</th><th>Parked At</th><th>Repo Date</th><th>CHFPL Ref</th>
        </tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><span className="pill d">HOLD</span></td>
          <td><b>{r.vehicle_no || '—'}</b></td>
          <td>{r.model_name || '—'}</td>
          <td>{r.colour || '—'}</td>
          <td>{r.battery_maker || '—'}</td>
          <td>{r.dealer_name || 'GRD Factory'}</td>
          <td>{r.repo_date ? formatDate(r.repo_date) : '—'}</td>
          <td>{r.source_ref || '—'}</td>
        </tr>)}</tbody>
      </table></div></div>}
  </div>;
}

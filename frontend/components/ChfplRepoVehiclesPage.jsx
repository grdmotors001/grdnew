'use client';

import { useEffect, useState } from 'react';
import { get } from '../lib/api';

const STATUS = {
  SEIZED: 'HOLD',
  AVAILABLE_FOR_SALE: 'Available for Sale',
  ALLOCATED_TO_GRD: 'Allocated to GRD',
  SOLD: 'Sold',
};

export function ChfplRepoVehiclesPage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await get('/chfpl/repo-vehicles', { noClientCache: true });
      setRows(data.vehicles || []);
    } catch (e) {
      setError(e.message || 'Could not load CHFPL repo vehicles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => !q || [
    r.vehicle_no, r.model_name, r.colour, r.resale_status, r.current_status,
    r.loan_applications?.application_no, r.loan_applications?.loan_account_no,
    r.loan_applications?.customer_profiles?.full_name, r.loan_applications?.customer_profiles?.phone,
    r.dealer_master?.dealer_name, r.dealer_master?.dealer_code,
  ].join(' ').toLowerCase().includes(q));

  return (
    <div className="loanApplicationViewPage">
      <style>{`
        .chfplRepoHead{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
        .chfplRepoHead h2{margin:2px 0 4px;color:#5d0925;font-size:25px}
        .chfplRepoHead p{margin:0;color:#748297;font-size:12px}
        .chfplRepoCard{background:#fff;border-radius:14px;box-shadow:0 5px 18px rgba(31,55,79,.07);overflow:hidden}
        .chfplRepoToolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #edf1f5}
        .chfplRepoSearch{width:min(360px,100%);min-height:38px;border:1px solid #e7d7d3;border-radius:8px;padding:8px 11px;box-sizing:border-box}
        .chfplRepoTableWrap{overflow-x:auto}
        .chfplRepoTable{min-width:1250px}
        .chfplRepoTable th{background:#fde9df;color:#6c102b;font-size:9px;text-transform:uppercase}
        .chfplRepoTable td{font-size:11px}
        .chfplRepoStatus{display:inline-flex;padding:5px 8px;border-radius:999px;background:#fff3cd;color:#795400;font-size:10px;font-weight:800;white-space:nowrap}
        .chfplRepoStatus.sale{background:#e8f7ef;color:#19733a}
        .chfplRepoEmpty{padding:30px;text-align:center;color:#7b8898;font-size:12px}
        @media(max-width:800px){.chfplRepoHead{display:block}.chfplRepoToolbar{display:block}.chfplRepoSearch{margin-top:10px;width:100%}}
      `}</style>
      <div className="chfplRepoHead">
        <div>
          <div className="loanApplicationViewKicker">CHFPL / CAPITALHIND</div>
          <h2>Repo Vehicles</h2>
          <p>Live read-only vehicle register from CHFPL. Seized vehicles remain marked HOLD (GRD Factory only applies to HOLD vehicles).</p>
        </div>
        <button className="btn" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <div className="error" style={{marginBottom:12}}>{error}</div>}
      <div className="chfplRepoCard">
        <div className="chfplRepoToolbar">
          <div><b>{filtered.length}</b><span className="muted"> repo vehicles from CHFPL</span></div>
          <input className="chfplRepoSearch" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Search vehicle / loan / customer / dealer" />
        </div>
        {loading ? <div className="chfplRepoEmpty">Loading CHFPL repo vehicles…</div> :
          <div className="chfplRepoTableWrap">
            <table className="table chfplRepoTable">
              <thead><tr>
                <th>Vehicle</th><th>Model</th><th>Colour</th><th>Status</th><th>Loan</th><th>Customer</th>
                <th>Parked Dealer</th><th>Battery</th><th>RC</th><th>Charger</th><th>Repo Date</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => {
                  const status = String(r.resale_status || 'SEIZED').toUpperCase();
                  const parkedName = r.dealer_master?.dealer_name || '';
                  const parkedAtFactory = !parkedName || /^grd\s*factory$/i.test(parkedName.trim());
                  return <tr key={r.id}>
                    <td><b>{r.vehicle_no || '—'}</b></td>
                    <td>{r.model_name || r.loan_applications?.grd_model_name || '—'}</td>
                    <td>{r.colour || '—'}</td>
                    <td><span className={'chfplRepoStatus' + (status === 'AVAILABLE_FOR_SALE' ? ' sale' : '')}>{STATUS[status] || status}</span></td>
                    <td><b>{r.loan_applications?.loan_account_no || r.loan_applications?.application_no || '—'}</b></td>
                    <td>{r.loan_applications?.customer_profiles?.full_name || '—'}<br/><span className="muted">{r.loan_applications?.customer_profiles?.phone || ''}</span></td>
                    <td>{status === 'AVAILABLE_FOR_SALE' ? (parkedAtFactory ? '—' : parkedName) : (parkedName || 'GRD Factory')}</td>
                    <td>{r.battery_available ? ('Yes · ' + (r.battery_no || '')) : 'No'}</td>
                    <td>{r.rc_available ? 'Yes' : 'No'}</td>
                    <td>{r.charger_available ? 'Yes' : 'No'}</td>
                    <td>{r.repo_date || '—'}</td>
                  </tr>;
                })}
                {!filtered.length && <tr><td colSpan="11"><div className="chfplRepoEmpty">No CHFPL repo vehicles found.</div></td></tr>}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  );
}

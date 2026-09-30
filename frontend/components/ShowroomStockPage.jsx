'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';

const fmtDate = d => { const x = String(d || '').slice(0, 10).split('-'); return x.length === 3 ? `${x[2]}-${x[1]}-${x[0]}` : (d || '—'); };

// Showroom / Branch ka stock: summary (dealer-wise count) turant aati hai; detail sirf row click par load hoti hai (fast).
export function ShowroomStockPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => { setError(''); setData(null); get('/reports/showroom-stock', { noClientCache: true }).then(setData).catch(e => setError(e.message)); };
  useEffect(() => { load(); }, []);
  const q = search.trim().toLowerCase();
  const rows = (data?.rows || []).filter(r => !q || String(r.dealer_name || '').toLowerCase().includes(q));
  return <div>
    <div className="dealerContentToolbar">
      <div className="dealerPageIntro"><span className="dealerSectionIcon">▣</span><div><strong>Showroom / Branch Stock</strong><small>Naya stock (Delivery Challan) + purana stock (Old Rickshaw available) - dealer par click karke detail dekhein</small></div></div>
      <div className="actions"><button className="btn" onClick={load}>↻ Refresh</button></div>
    </div>
    {error && <div className="error">{error}</div>}
    <div className="card" style={{ marginBottom: 14 }}><div className="muted">Total Stock at Showroom / Branch</div><div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{data ? data.total_stock : '…'}</div></div>
    <input className="input" style={{ width: '100%', maxWidth: 420, margin: '0 0 12px' }} placeholder="Search dealer…" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="tablewrap dealerTable"><table className="table">
      <thead><tr><th>Dealer</th><th>New Stock</th><th>Old Rickshaw Stock</th><th>Total</th></tr></thead>
      <tbody>
        {rows.map(r => <tr key={r.dealer_id} onClick={() => setOpen({ id: r.dealer_id, name: r.dealer_name })} style={{ cursor: 'pointer' }} title="Click: stock detail">
          <td><b>{r.dealer_name}</b></td><td>{r.stock_new}</td><td>{r.stock_old}</td><td><b>{r.stock_total}</b></td>
        </tr>)}
        {data && !rows.length && <tr><td colSpan="4" className="dealerEmpty">No showroom / branch found.</td></tr>}
      </tbody>
    </table></div>
    {!data && !error && <div className="dealerEmpty">Loading…</div>}
    {open && <StockDetailModal dealer={open} onClose={() => setOpen(null)} />}
  </div>;
}

function StockDetailModal({ dealer, onClose }) {
  const [stock, setStock] = useState(null), [error, setError] = useState('');
  useEffect(() => { get('/reports/dealer-stock?dealer_id=' + dealer.id, { noClientCache: true }).then(setStock).catch(e => setError(e.message)); }, []);
  const nv = stock?.new_vehicles || [], ov = stock?.old_rickshaws || [];
  return <div className="modal" onClick={onClose}>
    <div className="modalbox" style={{ width: 'min(1000px,100%)' }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div><h2 style={{ margin: 0 }}>{dealer.name}</h2><div className="subtitle">{stock ? `Naya: ${nv.length} · Purana: ${ov.length} · Total: ${stock.counts.total}` : 'Stock'}</div></div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {error && <div className="error">{error}</div>}
      {!stock && !error && <div className="card">Loading…</div>}
      {stock && <>
        <h3 style={{ margin: '10px 0 6px' }}>Naya Stock (Delivery Challan)</h3>
        {nv.length === 0 ? <div className="dealerEmpty">Koi naya stock nahi.</div> : <div className="tablewrap"><table className="table">
          <thead><tr><th>Challan No.</th><th>Date</th><th>Model</th><th>Chassis No.</th><th>Colour</th><th>Battery Make</th></tr></thead>
          <tbody>{nv.map(v => <tr key={v.id}><td>{v.challan_no || '—'}</td><td>{fmtDate(v.date)}</td><td>{v.model_name || '—'}</td><td><b>{v.chassis_no}</b></td><td>{v.colour || '—'}</td><td>{v.battery_maker || '—'}</td></tr>)}</tbody>
        </table></div>}
        <h3 style={{ margin: '16px 0 6px' }}>Purana Stock (Old Rickshaw - Available)</h3>
        {ov.length === 0 ? <div className="dealerEmpty">Koi purana stock nahi.</div> : <div className="tablewrap"><table className="table">
          <thead><tr><th>Challan No.</th><th>Date</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Battery Make</th></tr></thead>
          <tbody>{ov.map(v => <tr key={v.id}><td>{v.challan_no || '—'}</td><td>{fmtDate(v.date)}</td><td>{v.model_name || '—'}</td><td><b>{v.vehicle_reg_no}</b></td><td>{v.colour || '—'}</td><td>{v.battery_maker || '—'}</td></tr>)}</tbody>
        </table></div>}
      </>}
    </div>
  </div>;
}

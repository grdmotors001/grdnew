'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Money, ErrorBanner } from './ui';

const fmtDate = d => { const x = String(d || '').slice(0, 10).split('-'); return x.length === 3 ? `${x[2]}-${x[1]}-${x[0]}` : (d || '—'); };
const statusText = s => s === 'accepted' ? 'Accepted ✓' : s === 'rejected' ? 'Rejected' : 'Pending';

// Head Office (admin): showroom / branch dealers ke cash handover accept ya reject karta hai.
// Accept hone par dealer ke cashbook me OUT hota hai aur admin Day Book me IN entry ban jati hai.
export function CashHandoverApprovalPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const r = await get('/admin/cash-handovers', { noClientCache: true }); setRows(r.handovers || []); }
    catch (e) { setError(e.message || 'Could not load handovers'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const act = async (h, action) => {
    let body = {};
    if (action === 'reject') {
      const reason = window.prompt('Reject karne ka reason (optional):', '');
      if (reason === null) return;
      body = { reason };
    } else if (!window.confirm(`${h.dealer_name || 'Dealer'} se ₹ ${Number(h.amount || 0).toLocaleString('en-IN')} cash mil gaya? Accept karne par Day Book me IN entry ban jayegi.`)) return;
    setBusy(h.id); setError(''); setMessage('');
    try {
      await post(`/admin/cash-handovers/${h.id}/${action}`, body);
      setMessage(action === 'accept' ? `${h.handover_no} accepted — Day Book me IN ho gaya.` : `${h.handover_no} rejected.`);
      await load();
    } catch (e) { setError(e.message || 'Action failed'); }
    finally { setBusy(null); }
  };

  const pending = rows.filter(r => String(r.status || 'pending').toLowerCase() === 'pending');
  const done = rows.filter(r => String(r.status || 'pending').toLowerCase() !== 'pending').slice(0, 50);
  const pendingTotal = pending.reduce((s, r) => s + Number(r.amount || 0), 0);

  return <div style={{ marginBottom: 18 }}>
    <div className="dealerContentToolbar">
      <div className="dealerPageIntro"><span className="dealerSectionIcon">₹</span><div><strong>Cash Handover Approval</strong><small>Dealer se aaya cash accept karo — dealer me OUT, Day Book me IN</small></div></div>
      <div className="actions"><button className="btn" onClick={load}>↻ Refresh</button></div>
    </div>
    <ErrorBanner message={error} />
    {message && <div className="card" style={{ marginBottom: 12, color: '#176b35' }}>{message}</div>}
    <div className="card" style={{ marginBottom: 14 }}><div className="muted">Pending Acceptance</div><div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}><Money value={pendingTotal} /> <small className="muted" style={{ fontSize: 13, fontWeight: 500 }}>({pending.length} handover)</small></div></div>
    <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Handover No.</th><th>Dealer</th><th>Sent To</th><th>Amount</th><th>Remarks</th><th>Action</th></tr></thead><tbody>
      {pending.map(h => <tr key={h.id}><td>{fmtDate(h.date)}</td><td><b>{h.handover_no}</b></td><td>{h.dealer_name || '—'}</td><td>{h.sent_to || '—'}</td><td><b><Money value={h.amount} /></b></td><td>{h.remarks || '—'}</td>
        <td><div className="actions"><button className="btn primary" disabled={busy === h.id} onClick={() => act(h, 'accept')}>{busy === h.id ? '…' : 'Accept'}</button><button className="btn" disabled={busy === h.id} onClick={() => act(h, 'reject')}>Reject</button></div></td></tr>)}
      {!loading && !pending.length && <tr><td colSpan="7" className="muted">Koi pending handover nahi hai.</td></tr>}
    </tbody></table></div>
    {done.length > 0 && <>
      <h4 style={{ margin: '16px 0 8px' }}>Recent Accepted / Rejected</h4>
      <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Handover No.</th><th>Dealer</th><th>Amount</th><th>Status</th><th>By</th></tr></thead><tbody>
        {done.map(h => <tr key={h.id}><td>{fmtDate(h.date)}</td><td>{h.handover_no}</td><td>{h.dealer_name || '—'}</td><td><Money value={h.amount} /></td><td>{statusText(String(h.status).toLowerCase())}{h.reject_reason ? ' — ' + h.reject_reason : ''}</td><td>{h.accepted_by || '—'}</td></tr>)}
      </tbody></table></div>
    </>}
    {loading && <div className="dealerEmpty">Loading…</div>}
  </div>;
}

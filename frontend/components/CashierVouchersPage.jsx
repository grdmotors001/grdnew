'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const money = v => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const chassisOf = r => {
  const raw = Array.isArray(r.chassis_nos) && r.chassis_nos.length ? r.chassis_nos : (r.chassis_no ? [r.chassis_no] : []);
  return raw.flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);
};
const isPaid = r => String(r.payment_status || '').toLowerCase() === 'paid';
const TABS = [
  ['pending', 'Pending', 'Voucher ban gaya, approval baaki'],
  ['approved', 'Approved', 'Approved, Paid abhi nahi hua'],
  ['paid', 'Paid', 'Cashier ne Paid mark kar diya'],
];

export function CashierVouchersPage({ tab = 'pending' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [view, setView] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await get('/expense-payment-voucher?status=all');
      setRows(Array.isArray(d) ? d : (d.vouchers || d.rows || []));
    } catch (e) { setError(e.message || 'Load nahi hua'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const bucket = r => {
    const st = String(r.status || '').toLowerCase();
    if (st === 'rejected' || st === 'cancelled') return null;
    if (isPaid(r)) return 'paid';
    if (st === 'approved') return 'approved';
    return 'pending';
  };
  const counts = { pending: 0, approved: 0, paid: 0 };
  rows.forEach(r => { const b = bucket(r); if (b) counts[b]++; });
  const list = rows.filter(r => bucket(r) === tab);

  async function markPaid(id) {
    try {
      setError(''); setMsg('');
      const r = await post('/expense-payment-voucher/' + id + '/mark-paid', {});
      setRows(x => x.map(v => v.id === id ? r.voucher : v));
      setMsg('Paid mark ho gaya — Cash Book me entry ban gayi');
      setView(null);
    } catch (e) { setError(e.message || 'Paid mark nahi hua'); }
  }

  const Detail = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 140, color: '#64748b' }}>{label}</div><div style={{ flex: 1 }}>{children}</div>
    </div>
  );

  return (
    <div>
      <div className="pageHeader"><div><h1>Cashier — {TABS.find(t => t[0] === tab)[1]}</h1><p className="muted">Pending ({counts.pending}) · Approved ({counts.approved}) · Paid ({counts.paid}) — upar ke tabs se badlo</p></div></div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="card">
        <div className="actions" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
        <div className="muted" style={{ marginBottom: 8 }}>{TABS.find(t => t[0] === tab)[2]}</div>
        {loading ? <div className="muted">Loading…</div> : (
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Voucher No</th><th>Date</th><th>Exp Type</th><th>Pay To</th><th>View</th><th>Approved By</th>{tab === 'approved' && <th>Action</th>}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.voucher_no || '—'}</b></td><td>{r.date}</td><td>{r.expense_type_name}</td><td>{r.pay_to_name}</td>
                  <td><button className="btn" onClick={() => setView(r)}>View</button></td>
                  <td>{r.approved_by || '—'}</td>
                  {tab === 'approved' && (
                    <td>
                      <button className="btn primary" disabled={!r.can_pay} title={r.can_pay ? 'Paid mark karo' : 'Sirf Cashier Paid mark kar sakta hai'}
                        onClick={() => { if (window.confirm('Voucher ' + (r.voucher_no || '') + ' ko Paid mark karna hai? Cash Book me entry ban jayegi.')) markPaid(r.id); }}>
                        Mark as Paid
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!list.length && <tr><td colSpan={tab === 'approved' ? 7 : 6} className="muted">Is tab me koi voucher nahi hai.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>

      {view && (
        <div onClick={() => setView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div className="actions" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Voucher {view.voucher_no}</h2><button className="btn" onClick={() => setView(null)}>Close</button></div>
            <Detail label="Date">{view.date}</Detail>
            <Detail label="Expense Type">{view.expense_type_name}</Detail>
            <Detail label="Pay To">{view.pay_to_name}</Detail>
            <Detail label="Amount"><b>{money(view.amount)}</b></Detail>
            <Detail label="Payment Mode">{view.payment_mode || '—'}</Detail>
            <Detail label="Account Head">{view.account_head || '—'}</Detail>
            {view.work_model_name ? <Detail label="Model">{view.work_model_name}{view.work_qty ? ' / Qty ' + view.work_qty : ''}</Detail> : null}
            {chassisOf(view).length ? <Detail label="Chassis">{chassisOf(view).join(', ')}</Detail> : null}
            {view.customer_name ? <Detail label="Customer">{view.customer_name}</Detail> : null}
            <Detail label="Bill / Receipt No">{view.bill_no || '—'}</Detail>
            <Detail label="Description / Remarks">{view.remarks || '—'}</Detail>
            <Detail label="Created By">{view.created_by || '—'}</Detail>
            <Detail label="Approved By">{view.approved_by || '—'}</Detail>
            {isPaid(view) ? <Detail label="Paid By">{view.paid_by || '—'}</Detail> : null}
            {bucket(view) === 'approved' && view.can_pay && (
              <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" onClick={() => markPaid(view.id)}>Mark Paid</button></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

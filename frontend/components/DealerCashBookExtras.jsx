'use client';

import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';

const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const field = (label, key, obj, setter, type = 'text') => (
  <input className="input" type={type} placeholder={label} value={obj[key] || ''} onChange={(e) => setter({ ...obj, [key]: e.target.value })} />
);

const categories = [
  ['tea_customer', 'Tea for Customer'], ['tea_staff', 'Tea for Staff'], ['water', 'Water Expense'],
  ['rent', 'Rent Expense'], ['repairing', 'Repairing Expense'], ['makhi_commission', 'Makhi / Commission Expense'], ['other', 'Other Expense'],
];

export function DealerAllReceiptsPage() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = () => get('/dealer/cash-book/all-receipts').then((d) => setRows(d.receipts || [])).catch((e) => setError(e.message || 'Could not load receipts'));
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    try {
      await put('/dealer/cash-book/receipts/' + editing.id, {
        dealer_register_page_no: editing.dealer_register_page_no,
        loan_amount: Number(editing.loan_amount || 0),
      });
      setEditing(null); await load();
    } catch (e) { setError(e.message || 'Could not update receipt'); }
    finally { setSaving(false); }
  };
  return (
    <div className="card">
      <div className="pageHeader"><div><h2>All Receipts</h2><p className="muted">Receipt correction: only Page No. and Loan Amount can be edited.</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
      {error && <div className="error">{error}</div>}
      <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Date</th><th>Receipt No.</th><th>Name</th><th>Amount</th><th>Loan Amount</th><th>Page No.</th><th></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td>{r.date}</td><td><b>{r.receipt_no}</b></td><td>{r.customer_name}<div className="muted">{r.customer_phone || ''}</div></td>
          <td>{money(r.amount)}</td><td>{money(r.loan_amount)}</td><td>{r.dealer_register_page_no || '—'}</td>
          <td><button className="btn" onClick={() => setEditing({...r})}>Edit</button></td>
        </tr>)}{!rows.length && <tr><td colSpan="7" className="muted">No receipts found.</td></tr>}</tbody>
      </table></div>
      {editing && <div className="card" style={{marginTop:12}}>
        <h3>Edit Receipt — {editing.receipt_no}</h3>
        <div className="grid">
          {field('Page No.', 'dealer_register_page_no', editing, setEditing)}
          {field('Loan Amount', 'loan_amount', editing, setEditing, 'number')}
        </div>
        <div className="actions"><button className="btn primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save Changes'}</button><button className="btn" onClick={()=>setEditing(null)}>Cancel</button></div>
      </div>}
    </div>
  );
}

export function DealerAllCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [billedCustomers, setBilledCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 35;
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [cancelForm, setCancelForm] = useState({ reason: '', refund_amount: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = (q = search) => Promise.all([
    get('/dealer/cash-book/customers?q=' + encodeURIComponent(q || '')),
    get('/dealer/cash-book/customers?status=BILLED&q=' + encodeURIComponent(q || '')),
  ])
    .then(([all, billed]) => {
      setCustomers(all.customers || []);
      setBilledCustomers(billed.customers || []);
      setPage(1);
    })
    .catch((e) => setError(e.message || 'Could not load customers'));

  useEffect(() => { load(''); }, []);

  const sourceRows = tab === 'BILLED' ? billedCustomers : customers;
  const filtered = sourceRows.filter((c) => {
    if (tab !== 'ALL' && tab !== 'BILLED' && c.status !== tab) return false;
    const q = search.trim().toLowerCase();
    if (q && ![c.page_no, c.name, c.phone, c.vehicle_no].join(' ').toLowerCase().includes(q)) return false;
    if (fromDate && String(c.date || '') < fromDate) return false;
    if (toDate && String(c.date || '') > toDate) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const counts = {
    ALL: customers.length,
    VEHICLE_PENDING: customers.filter((c) => c.status === 'VEHICLE_PENDING').length,
    BILLED: billedCustomers.length,
    DEALER_CANCEL: customers.filter((c) => c.status === 'DEALER_CANCEL').length,
  };
  const tabs = [
    ['ALL', 'All Customers'],
    ['VEHICLE_PENDING', 'Vehicle Pending'],
    ['BILLED', 'Billed'],
    ['DEALER_CANCEL', 'Dealer Cancel'],
  ];

  const clearDates = () => {
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const openCancel = (c) => {
    setCancelling(c);
    setCancelForm({ reason: '', refund_amount: String(c.paid_amount || 0) });
    setError('');
  };

  const submitCancel = async () => {
    if (!cancelling) return;
    setSaving(true); setError('');
    try {
      await post('/dealer/cash-book/customers/' + cancelling.id + '/cancel', {
        reason: cancelForm.reason,
        refund_amount: Number(cancelForm.refund_amount || 0),
        refund_date: today(),
        refund_mode: 'cash',
      });
      setCancelling(null);
      await load(search);
    } catch (e) {
      setError(e.message || 'Could not cancel booking');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="pageHeader">
        <div><h2>Customer Register</h2><p className="muted">All Customers is the master register. Tax Invoice controls Billed; a refunded booking stays in history as Dealer Cancel.</p></div>
        <button className="btn" onClick={() => load(search)}>↻ Refresh</button>
      </div>
      {error && <div className="error">{error}</div>}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'btn primary' : 'btn'} onClick={() => { setTab(key); setPage(1); }}>
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <input
          className="input"
          style={{ flex:'1 1 280px' }}
          placeholder="Search page no. / name / mobile / vehicle no."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700 }}>
          From
          <input className="input" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700 }}>
          To
          <input className="input" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
        </label>
        {(fromDate || toDate) && <button className="btn" onClick={clearDates}>Clear Date</button>}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10, marginBottom:8 }}>
        <span className="muted">Showing {visibleRows.length} of {filtered.length} records · 35 per page</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>← Prev</button>
          <span className="muted">Page {currentPage} / {totalPages}</span>
          <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next →</button>
        </div>
      </div>

      <div className="tablewrap dealerTable">
        <table className="table">
          <thead><tr><th>Page No.</th><th>Date</th><th>Name</th><th>Phone</th><th>Vehicle No.</th><th>Status</th><th>Sale Amount</th><th>Paid</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            {visibleRows.map((c) => (
              <tr key={c.id}>
                <td>{c.page_no || '—'}</td>
                <td>{c.date || '—'}</td>
                <td><b>{c.name}</b></td>
                <td>{c.phone || '—'}</td>
                <td>{c.vehicle_no || '—'}</td>
                <td><b>{c.status_label || c.status}</b>{c.status === 'DEALER_CANCEL' && <div className="muted">{c.cancel_reason || ''}</div>}</td>
                <td>{money(c.sale_amount)}</td>
                <td>{money(c.paid_amount)}</td>
                <td><b>{money(c.balance)}</b></td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    {c.status !== 'BILLED' && <button className="btn" onClick={() => setEditing({ ...c })}>Edit</button>}
                    {c.status === 'BILLED' && <button className="btn" onClick={() => setEditing({ ...c })}>Edit Page No.</button>}
                    {c.status === 'VEHICLE_PENDING' && <button className="btn" onClick={() => openCancel(c)}>Dealer Cancel</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan="10" className="muted">No customers found.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <div className="card" style={{ marginTop: 12 }}>
        <h2>{editing.status === 'BILLED' ? 'Edit Billed Page No.' : 'Edit Customer'}</h2>
        {editing.status === 'BILLED' ? (
          <>
            <div className="grid">{field('Page No.', 'page_no', editing, setEditing)}</div>
            <div className="actions">
              <button className="btn primary" disabled={saving} onClick={async () => {
                setSaving(true); setError('');
                try {
                  await post('/dealer/tax-invoices/' + editing.invoice_id, { dealer_page_no: editing.page_no });
                  setEditing(null); await load(search);
                } catch (e) { setError(e.message || 'Could not update page number'); }
                finally { setSaving(false); }
              }}>{saving ? 'Saving…' : 'Save Page No.'}</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid">{field('Page No.', 'page_no', editing, setEditing)}</div>
            <div className="actions">
              <button className="btn primary" disabled={saving} onClick={async () => {
                setSaving(true); setError('');
                try { await put('/dealer/cash-book/customers/' + editing.id, { page_no: editing.page_no }); setEditing(null); await load(search); }
                catch (e) { setError(e.message || 'Could not update page number'); }
                finally { setSaving(false); }
              }}>{saving ? 'Saving…' : 'Save Page No.'}</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </>
        )}
      </div>}

      {cancelling && <div className="card" style={{ marginTop: 12, border: '1px solid currentColor' }}>
        <div className="pageHeader">
          <div><h2 style={{ margin:0 }}>Dealer Cancel — {cancelling.name}</h2><p className="muted">This keeps the booking/customer history. The refund is recorded separately from the original receipt.</p></div>
          <button className="btn" onClick={() => setCancelling(null)}>Close</button>
        </div>
        <div className="grid">
          {field('Refund Amount', 'refund_amount', cancelForm, setCancelForm, 'number')}
          {field('Cancellation Reason', 'reason', cancelForm, setCancelForm)}
        </div>
        <div className="muted" style={{ margin:'8px 0 12px' }}>Maximum refund: {money(cancelling.paid_amount)}. Refund mode: Cash.</div>
        <button className="btn primary" disabled={saving || !cancelForm.reason.trim()} onClick={submitCancel}>{saving ? 'Saving…' : 'Confirm Dealer Cancel & Refund'}</button>
      </div>}
    </div>
  );
}

export function DealerExpenseCreatePage() {
  const [expense, setExpense] = useState({ date: today(), category: 'tea_customer', amount: '', paid_to: '', remarks: '' });
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(''); try { const d = await post('/dealer/cash-book/expense', expense); setMessage(`Expense ${d.expense.expense_no} saved`); setExpense({ ...expense, amount: '', paid_to: '', remarks: '' }); setTimeout(() => setMessage(''), 2500); } catch (e2) { setError(e2.message || 'Could not save'); } finally { setSaving(false); } };
  return <form className="card" onSubmit={submit}><h2>Shop Expense</h2>{error && <div className="error">{error}</div>}{message && <div className="card" style={{ marginBottom: 12 }}>{message}</div>}<div className="grid">{field('Date', 'date', expense, setExpense, 'date')}<select className="input" value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}>{categories.map((x) => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>{field('Amount', 'amount', expense, setExpense, 'number')}{field('Paid To', 'paid_to', expense, setExpense)}{field('Remarks', 'remarks', expense, setExpense)}</div><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save Expense'}</button></form>;
}

export function DealerHandoverCreatePage() {
  const [handover, setHandover] = useState({ date: today(), amount: '', sent_to: '', remarks: '' });
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [recent, setRecent] = useState([]);
  const loadRecent = () => { const from = new Date(); from.setDate(from.getDate() - 14); const q = '?from=' + from.toISOString().slice(0, 10) + '&to=' + today(); get('/dealer/cash-book' + q).then((d) => setRecent(d.handovers || [])).catch(() => {}); };
  useEffect(() => { loadRecent(); }, []);
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(''); try { const d = await post('/dealer/cash-book/handover', handover); setMessage(`Handover ${d.handover.handover_no} saved — waiting for Head Office to accept.`); setHandover({ ...handover, amount: '', sent_to: '', remarks: '' }); loadRecent(); setTimeout(() => setMessage(''), 4000); } catch (e2) { setError(e2.message || 'Could not save'); } finally { setSaving(false); } };
  const statusLabel = (s) => s === 'accepted' ? 'Accepted ✓' : s === 'rejected' ? 'Rejected' : 'Pending Acceptance';
  return <div><form className="card" onSubmit={submit}><h2>Cash Handover to Head Office</h2>{error && <div className="error">{error}</div>}{message && <div className="card" style={{ marginBottom: 12 }}>{message}</div>}<div className="grid">{field('Date', 'date', handover, setHandover, 'date')}{field('Amount', 'amount', handover, setHandover, 'number')}{field('Sent To / Received By', 'sent_to', handover, setHandover)}{field('Remarks', 'remarks', handover, setHandover)}</div><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Record HO Handover'}</button></form><div className="card" style={{ marginTop: 12 }}><div className="pageHeader"><h2 style={{ margin: 0 }}>Recent Handovers</h2><button className="btn" onClick={loadRecent}>↻ Refresh</button></div><div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Handover No.</th><th>Amount</th><th>Status</th></tr></thead><tbody>{recent.map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.handover_no}</td><td>{money(h.amount)}</td><td>{statusLabel(h.status)}</td></tr>)}{!recent.length && <tr><td colSpan="4" className="muted">No handovers in the last 14 days.</td></tr>}</tbody></table></div></div></div>;
}

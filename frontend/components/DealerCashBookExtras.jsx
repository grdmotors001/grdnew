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
  const [error, setError] = useState('');
  const load = () => get('/dealer/cash-book/all-receipts').then((d) => setRows(d.receipts || [])).catch((e) => setError(e.message || 'Could not load receipts'));
  useEffect(() => { load(); }, []);
  return (
    <div className="card">
      <div className="pageHeader"><div><h2>All Receipts</h2><p className="muted">Every customer receipt recorded at this showroom.</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
      {error && <div className="error">{error}</div>}
      <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Date</th><th>Receipt No.</th><th>Name</th><th>Amount</th><th>Page No.</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.date}</td><td><b>{r.receipt_no}</b></td><td>{r.customer_name}<div className="muted">{r.customer_phone || ''}</div></td><td>{money(r.amount)}</td><td>{r.dealer_register_page_no || '—'}</td></tr>)}{!rows.length && <tr><td colSpan="5" className="muted">No receipts found.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}

export function DealerAllCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = (q = '') => get('/dealer/cash-book/customers?q=' + encodeURIComponent(q)).then((d) => setCustomers(d.customers || [])).catch((e) => setError(e.message || 'Could not load customers'));
  useEffect(() => { load(); }, []);
  return (
    <div className="card">
      <div className="pageHeader"><div><h2>All Customers</h2><p className="muted">Showroom customer register — includes anyone billed, even before a receipt is recorded.</p></div><button className="btn" onClick={() => load(search)}>↻ Refresh</button></div>
      {error && <div className="error">{error}</div>}
      <input className="input" placeholder="Search page no. / name / mobile / vehicle no." value={search} onChange={(e) => { setSearch(e.target.value); load(e.target.value); }} />
      <div className="tablewrap dealerTable" style={{ marginTop: 12 }}><table className="table">
        <thead><tr><th>Page No.</th><th>Name</th><th>Phone</th><th>Financer</th><th>Vehicle No.</th><th>Sale Amount</th><th>Loan</th><th>Balance</th><th></th></tr></thead>
        <tbody>{customers.map((c) => <tr key={c.id}><td>{c.page_no || '—'}</td><td><b>{c.name}</b></td><td>{c.phone || '—'}</td><td>{c.financer || '—'}</td><td>{c.vehicle_no || '—'}</td><td>{money(c.sale_amount)}</td><td>{money(c.loan_amount)}</td><td><b>{money(c.balance)}</b></td><td><button className="btn" onClick={() => setEditing({ ...c })}>Edit</button></td></tr>)}{!customers.length && <tr><td colSpan="9" className="muted">No customers found.</td></tr>}</tbody>
      </table></div>
      {editing && <div className="card" style={{ marginTop: 12 }}><h2>Edit Customer</h2><div className="grid">{field('Page No.', 'page_no', editing, setEditing)}{field('Name', 'name', editing, setEditing)}{field('Phone No.', 'phone', editing, setEditing)}</div><div className="actions"><button className="btn primary" disabled={saving} onClick={async () => { setSaving(true); try { await put('/dealer/cash-book/customers/' + editing.id, editing); setEditing(null); await load(search); } catch (e) { setError(e.message || 'Could not update customer'); } finally { setSaving(false); } }}>Save Customer</button><button className="btn" onClick={() => setEditing(null)}>Cancel</button></div></div>}
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

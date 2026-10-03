'use client';

import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { printCashReceipt } from '../lib/printReceipt';

const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const field = (label, key, obj, setter, type = 'text') => (
  <input className="input" type={type} placeholder={label} value={obj[key] || ''} onChange={(e) => setter({ ...obj, [key]: e.target.value })} />
);

const categories = [
  ['pcc', 'PCC'], ['ll', 'LL'], ['dl', 'DL'], ['makhi_commission', 'Makkhi / Commission'],
  ['tea_customer', 'Tea for Customer'], ['tea_staff', 'Tea for Staff'], ['water', 'Water Expense'],
  ['rent', 'Rent Expense'], ['repairing', 'Repairing Expense'], ['other', 'Other Expense'],
];
// Ye kharche aksar bill banne se pehle hote hain, isliye inme customer (page no. / naam) select karna hota hai.
const CUSTOMER_CATEGORIES = ['pcc', 'll', 'dl', 'makhi_commission'];

export function DealerAllReceiptsPage({ dealer } = {}) {
  const [rows, setRows] = useState([]);
  const [custs, setCusts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const load = () => { get('/dealer/cash-book/customers').then((d) => setCusts(d.customers || [])).catch(() => {}); return get('/dealer/cash-book/all-receipts').then((d) => setRows(d.receipts || [])).catch((e) => setError(e.message || 'Could not load receipts')); };
  useEffect(() => { load(); }, []);
  const rq = search.trim().toLowerCase();
  const filteredRows = rows.filter((r) => !rq || [r.receipt_no, r.customer_name, r.customer_phone, r.dealer_register_page_no, r.amount, r.loan_amount, r.date].join(' ').toLowerCase().includes(rq));
  // Receipt ke baad customer ka balance = abhi ka balance + is receipt ke baad aayi receipts ka total.
  const printRow = (r) => {
    const c = custs.find((x) => String(x.id) === String(r.customer_id));
    let balanceAfter;
    if (c) balanceAfter = Math.max(0, Number(c.balance || 0) + rows.filter((x) => String(x.customer_id) === String(r.customer_id) && Number(x.id) > Number(r.id)).reduce((t, x) => t + Number(x.amount || 0), 0));
    printCashReceipt({ ...r, sale_amount: r.sale_amount || c?.sale_amount, loan_amount: r.loan_amount || c?.loan_amount, customer_name: r.customer_name || c?.name, customer_phone: r.customer_phone || c?.phone, dealer_register_page_no: r.dealer_register_page_no || c?.page_no, balance_after: balanceAfter }, { dealerName: dealer?.name || dealer?.dealer_name || '' });
  };
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
      <input className="input" style={{width:'100%',maxWidth:420,margin:'0 0 12px'}} placeholder="Search receipt no., name, mobile, page no…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Date</th><th>Receipt No.</th><th>Name</th><th>Amount</th><th>Loan Amount</th><th>Page No.</th><th></th></tr></thead>
        <tbody>{filteredRows.map((r) => <tr key={r.id}>
          <td>{r.date}</td><td><b>{r.receipt_no}</b></td><td>{r.customer_name}<div className="muted">{r.customer_phone || ''}</div></td>
          <td>{money(r.amount)}</td><td>{money(r.loan_amount)}</td><td>{r.dealer_register_page_no || '—'}</td>
          <td><div className="actions"><button className="btn" title="58mm thermal receipt print" onClick={() => printRow(r)}>🖨 Print</button><button className="btn" onClick={() => setEditing({...r})}>Edit</button></div></td>
        </tr>)}{!filteredRows.length && <tr><td colSpan="7" className="muted">No receipts found.</td></tr>}</tbody>
      </table></div>
      {editing && <div className="modal" style={{zIndex:10000}} onMouseDown={(e)=>{if(e.target===e.currentTarget)setEditing(null)}}>
        <div className="modalbox" style={{maxWidth:520}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
            <div><h3 style={{margin:0}}>Edit Receipt</h3><p className="muted" style={{margin:'4px 0 0'}}>{editing.receipt_no}</p></div>
            <button type="button" className="btn" onClick={()=>setEditing(null)}>✕</button>
          </div>
          <div className="grid" style={{marginTop:14}}>
            {field('Page No.', 'dealer_register_page_no', editing, setEditing)}
            {field('Loan Amount', 'loan_amount', editing, setEditing, 'number')}
          </div>
          <div className="actions" style={{marginTop:16}}><button className="btn" onClick={()=>setEditing(null)}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save Changes'}</button></div>
        </div>
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
  const [detailFor, setDetailFor] = useState(null);
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
              <tr key={c.id} onClick={() => setDetailFor(c)} style={{ cursor:'pointer' }} title="Click to view full customer detail">
                <td>{c.page_no || '—'}</td>
                <td>{c.date || '—'}</td>
                <td><b>{c.name}</b></td>
                <td>{c.phone || '—'}</td>
                <td>{c.vehicle_no || '—'}</td>
                <td><b>{c.status_label || c.status}</b>{c.status === 'DEALER_CANCEL' && <div className="muted">{c.cancel_reason || ''}</div>}</td>
                <td>{money(c.sale_amount)}</td>
                <td>{money(c.paid_amount)}</td>
                <td><b>{money(c.balance)}</b></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display:'flex', gap:6 }}>
                    {c.status !== 'BILLED' && <button className="btn" onClick={() => setEditing({ ...c, _saleWasFilled: Number(c.sale_amount || 0) !== 0, _loanWasFilled: Number(c.loan_amount || 0) !== 0 })}>Edit</button>}
                    {c.status === 'BILLED' && <button className="btn" onClick={() => setEditing({ ...c, _saleWasFilled: Number(c.sale_amount || 0) !== 0, _loanWasFilled: Number(c.loan_amount || 0) !== 0 })}>Edit Page No.</button>}
                    {c.status === 'VEHICLE_PENDING' && <button className="btn" onClick={() => openCancel(c)}>Dealer Cancel</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan="10" className="muted">No customers found.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (() => {
        // Lock only if the amount was already filled BEFORE this edit modal opened.
        // Do not lock after the first digit is typed.
        const saleFilled = Boolean(editing._saleWasFilled);
        const loanFilled = Boolean(editing._loanWasFilled);
        const saleEntered = !saleFilled && String(editing.sale_amount ?? '').trim() !== '' && Number(editing.sale_amount) > 0;
        const loanEntered = !loanFilled && String(editing.loan_amount ?? '').trim() !== '' && Number(editing.loan_amount) > 0;
        const hasAmountChanges = saleEntered || loanEntered;
        return <div className="modal" style={{zIndex:10000}} onMouseDown={(e)=>{if(e.target===e.currentTarget)setEditing(null)}}>
          <div className="modalbox" style={{maxWidth:520}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
              <div><h2 style={{margin:0}}>{editing.status === 'BILLED' ? 'Edit Billed Customer' : 'Edit Customer'}</h2><p className="muted" style={{margin:'4px 0 0'}}>{editing.name || editing.customer_name || ''}{editing.phone ? ' · '+editing.phone : ''}</p></div>
              <button type="button" className="btn" onClick={()=>setEditing(null)}>✕</button>
            </div>
            <div className="grid" style={{marginTop:14}}>
              {field('Page No.', 'page_no', editing, setEditing)}
              <div>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="Sale Amount"
                  value={editing.sale_amount || ''}
                  disabled={saleFilled}
                  onChange={(e)=>setEditing({...editing,sale_amount:e.target.value})}
                  title={saleFilled ? 'Sale Amount already filled — cannot be edited.' : 'Sale Amount can be entered only while blank.'}
                />
                {saleFilled && <div className="muted" style={{fontSize:10,marginTop:3}}>Sale Amount already filled — locked</div>}
              </div>
              <div>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="Loan Amount"
                  value={editing.loan_amount || ''}
                  disabled={loanFilled}
                  onChange={(e)=>setEditing({...editing,loan_amount:e.target.value})}
                  title={loanFilled ? 'Loan Amount already filled — cannot be edited.' : 'Loan Amount can be entered only while blank.'}
                />
                {loanFilled && <div className="muted" style={{fontSize:10,marginTop:3}}>Loan Amount already filled — locked</div>}
              </div>
            </div>
            <div className="muted" style={{fontSize:11,marginTop:8}}>Sale Amount aur Loan Amount sirf blank hone par ek baar fill kiye ja sakte hain. Filled amount dobara edit nahi hoga.</div>
            <div className="actions" style={{marginTop:16}}>
              <button className="btn" onClick={()=>setEditing(null)}>Cancel</button>
              {editing.status === 'BILLED' ? (
                <button className="btn primary" disabled={saving} onClick={async () => {
                  setSaving(true); setError('');
                  try {
                    const amountPatch = {};
                    if (saleEntered) amountPatch.sale_amount = Number(editing.sale_amount);
                    if (loanEntered) amountPatch.loan_amount = Number(editing.loan_amount);
                    // Always save Page No. on the customer record; for billed rows also mirror it to the invoice.
                    await put('/dealer/cash-book/customers/' + editing.id, { page_no: editing.page_no, ...amountPatch });
                    if (editing.invoice_id) await put('/dealer/tax-invoices/' + editing.invoice_id, { dealer_page_no: editing.page_no });
                    setEditing(null); await load(search);
                  }
                  catch (e) { setError(e.message || 'Could not update customer'); }
                  finally { setSaving(false); }
                }}>{saving ? 'Saving…' : (hasAmountChanges ? 'Save Changes' : 'Save Page No.')}</button>
              ) : (
                <button className="btn primary" disabled={saving} onClick={async () => {
                  setSaving(true); setError('');
                  try {
                    const amountPatch = {};
                    if (saleEntered) amountPatch.sale_amount = Number(editing.sale_amount);
                    if (loanEntered) amountPatch.loan_amount = Number(editing.loan_amount);
                    await put('/dealer/cash-book/customers/' + editing.id, { page_no: editing.page_no, ...amountPatch });
                    setEditing(null); await load(search);
                  }
                  catch (e) { setError(e.message || 'Could not update customer'); }
                  finally { setSaving(false); }
                }}>{saving ? 'Saving…' : (hasAmountChanges ? 'Save Changes' : 'Save Page No.')}</button>
              )}
            </div>
          </div>
        </div>;
      })()}

      {detailFor && <CustomerDetailModal customer={detailFor} onClose={() => setDetailFor(null)} />}

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

function DetailRow({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'6px 0', borderBottom:'1px dashed rgba(128,128,128,.25)' }}>
      <span className="muted" style={{ fontSize:12 }}>{label}</span>
      <b style={{ fontSize:13, textAlign:'right', wordBreak:'break-word' }}>{value || '—'}</b>
    </div>
  );
}

function DetailBox({ title, children }) {
  return (
    <div style={{ flex:'1 1 260px', minWidth:240, border:'1px solid rgba(128,128,128,.3)', borderRadius:8, padding:'10px 12px' }}>
      <div style={{ fontWeight:800, fontSize:12, textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>{title}</div>
      {children}
    </div>
  );
}

// Customer Register me row click par khulta hai: customer, vehicle, sale/loan aur us customer par hue kharche.
function CustomerDetailModal({ customer, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(''); setData(null);
    get('/dealer/cash-book/customers/' + customer.id + '/detail', { noClientCache: true })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e.message || 'Could not load customer detail'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customer.id]);

  const c = data?.customer || customer;
  const v = data?.vehicle;
  const s = data?.sale;
  const ex = data?.expenses || [];
  const rc = data?.receipts || [];
  const summary = data?.expense_summary;

  return (
    <div className="modal" style={{ zIndex:10000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalbox" style={{ maxWidth:960, width:'96%', maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
          <div>
            <h2 style={{ margin:0 }}>{c.name || customer.name}</h2>
            <p className="muted" style={{ margin:'4px 0 0' }}>
              Page No. {c.page_no || customer.page_no || '—'} · {c.status_label || c.status || customer.status_label || customer.status}
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>✕</button>
        </div>

        {loading && <p className="muted" style={{ marginTop:14 }}>Loading…</p>}
        {err && <div className="error" style={{ marginTop:14 }}>{err}</div>}

        {data && (
          <>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:14 }}>
              <DetailBox title="Customer Detail">
                <DetailRow label="Name" value={c.name} />
                <DetailRow label="Mobile" value={c.phone} />
                <DetailRow label="Page No." value={c.page_no} />
                <DetailRow label="Booking Date" value={c.date} />
                <DetailRow label="Father / Relation" value={c.father_name} />
                <DetailRow label="Address" value={c.address} />
                <DetailRow label="Aadhar" value={c.aadhar} />
                <DetailRow label="PAN" value={c.pan} />
                {c.status === 'DEALER_CANCEL' && <DetailRow label="Cancel Reason" value={c.cancel_reason} />}
              </DetailBox>

              <DetailBox title="Vehicle Detail">
                <DetailRow label="Vehicle No." value={v.vehicle_no} />
                {v.registration_no && v.registration_no !== v.vehicle_no && <DetailRow label="Registration No." value={v.registration_no} />}
                <DetailRow label="Model" value={v.model} />
                <DetailRow label="Chassis No." value={v.chassis_no} />
                <DetailRow label="Motor No." value={v.motor_no} />
                <DetailRow label="Controller No." value={v.controller_no} />
                <DetailRow label="Colour" value={v.colour} />
                <DetailRow label="Battery" value={[v.battery_maker, ...(v.battery_nos || [])].filter(Boolean).join(' · ')} />
                {!v.linked && <p className="muted" style={{ margin:'8px 0 0', fontSize:12 }}>Vehicle abhi deliver / bill nahi hua, isliye chassis detail nahi hai.</p>}
              </DetailBox>

              <DetailBox title="Sale & Loan">
                <DetailRow label="Sale Type" value={s.sale_type} />
                <DetailRow label="Internal Sale Amount" value={money(s.sale_amount)} />
                <DetailRow label="Loan Amount" value={money(s.loan_amount)} />
                <DetailRow label="Financer" value={s.financer} />
                <DetailRow label="Paid by Customer" value={money(s.paid_amount)} />
                <DetailRow label="Balance" value={money(s.balance)} />
                <DetailRow label="Bill No." value={s.bill_no} />
                <DetailRow label="Bill Date" value={s.bill_date} />
                <DetailRow label="D.O. No." value={s.do_no} />
                {(s.internal_sale_details || s.description || s.remarks) && (
                  <div style={{ marginTop:8 }}>
                    <div className="muted" style={{ fontSize:12 }}>Internal Sale Details</div>
                    <div style={{ fontSize:13, fontWeight:700, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{s.internal_sale_details || s.description}</div>
                    {s.remarks && <div className="muted" style={{ fontSize:12, marginTop:4 }}>Remarks: {s.remarks}</div>}
                  </div>
                )}
              </DetailBox>
            </div>

            <div style={{ marginTop:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:8 }}>
                <h3 style={{ margin:'0 0 6px' }}>Expenses on this customer</h3>
                <b>Total: {money(summary?.total)} <span className="muted" style={{ fontWeight:400 }}>({summary?.count || 0} entries)</span></b>
              </div>
              {summary?.by_category?.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', margin:'4px 0 8px' }}>
                  {summary.by_category.map((x) => (
                    <span key={x.category} style={{ border:'1px solid rgba(128,128,128,.35)', borderRadius:999, padding:'2px 10px', fontSize:12 }}>{x.category}: <b>{money(x.amount)}</b></span>
                  ))}
                </div>
              )}
              <div className="tablewrap dealerTable">
                <table className="table">
                  <thead><tr><th>Date</th><th>Expense No.</th><th>Category</th><th>Paid To</th><th>Remarks</th><th style={{ textAlign:'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {ex.map((x) => (
                      <tr key={x.id}>
                        <td>{x.date || '—'}</td>
                        <td>{x.expense_no || '—'}</td>
                        <td>{x.category_label || x.category || '—'}</td>
                        <td>{x.paid_to || '—'}</td>
                        <td>{x.remarks || '—'}</td>
                        <td style={{ textAlign:'right' }}><b>{money(x.amount)}</b></td>
                      </tr>
                    ))}
                    {!ex.length && <tr><td colSpan="6" className="muted">Is customer par abhi koi kharcha nahi hua. (PCC / LL / DL / Makkhi kharche me customer select karne par yahan dikhenge.)</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop:16 }}>
              <h3 style={{ margin:'0 0 6px' }}>Receipts</h3>
              <div className="tablewrap dealerTable">
                <table className="table">
                  <thead><tr><th>Date</th><th>Receipt No.</th><th>Type</th><th>Mode</th><th>Remarks</th><th style={{ textAlign:'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {rc.map((x) => (
                      <tr key={x.id}>
                        <td>{x.date || '—'}</td>
                        <td>{x.receipt_no || '—'}</td>
                        <td>{x.receipt_type || '—'}</td>
                        <td>{x.payment_mode || '—'}</td>
                        <td>{x.remarks || '—'}</td>
                        <td style={{ textAlign:'right' }}><b>{money(x.amount)}</b></td>
                      </tr>
                    ))}
                    {!rc.length && <tr><td colSpan="6" className="muted">No receipts.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="actions" style={{ marginTop:16 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CustomerPicker({ customers, value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = q.trim().toLowerCase();
  const list = customers
    .filter((c) => !term || [c.page_no, c.name, c.phone, c.vehicle_no].join(' ').toLowerCase().includes(term))
    .slice(0, 50);
  if (value) {
    return (
      <div className="input" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span><b>Pg {value.page_no || '—'}</b> · {value.name || 'Customer'}{value.phone ? ' · ' + value.phone : ''}</span>
        <button type="button" className="btn" onClick={() => { onChange(null); setQ(''); }}>✕ Change</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" style={{ width: '100%' }} placeholder="Customer select karein — page no. / naam / mobile / vehicle no." value={q}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, maxHeight: 280, overflowY: 'auto', padding: 4, marginTop: 4 }}>
          {list.map((c) => (
            <div key={c.id} style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(128,128,128,.2)' }}
              onClick={() => { onChange(c); setOpen(false); setQ(''); }}>
              <b>Pg {c.page_no || '—'}</b> · {c.name || 'Customer'}
              <div className="muted" style={{ fontSize: 12 }}>{[c.phone, c.vehicle_no, c.status].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
          {!list.length && <div className="muted" style={{ padding: 10 }}>Koi customer nahi mila.</div>}
        </div>
      )}
    </div>
  );
}

export function DealerExpenseCreatePage() {
  const [expense, setExpense] = useState({ date: today(), category: 'pcc', amount: '', paid_to: '', remarks: '' });
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { get('/dealer/cash-book/customers').then((d) => setCustomers(d.customers || [])).catch(() => {}); }, []);
  const needsCustomer = CUSTOMER_CATEGORIES.includes(expense.category);
  const changeCategory = (category) => { setExpense({ ...expense, category }); setCustomer(null); setNoCustomer(false); };
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (needsCustomer && !customer && !noCustomer) { setError('Is kharche ke liye customer (page no. / naam) select karein.'); return; }
    setSaving(true);
    try {
      const label = (categories.find((x) => x[0] === expense.category) || [])[1] || expense.category;
      const d = await post('/dealer/cash-book/expense', { ...expense, category_label: label, customer_id: needsCustomer && customer ? customer.id : undefined });
      setMessage(`Expense ${d.expense.expense_no} saved`);
      setExpense({ ...expense, amount: '', paid_to: '', remarks: '' }); setCustomer(null); setNoCustomer(false);
      setTimeout(() => setMessage(''), 2500);
    } catch (e2) { setError(e2.message || 'Could not save'); } finally { setSaving(false); }
  };
  return <form className="card" onSubmit={submit}><h2>Shop Expense</h2>{error && <div className="error">{error}</div>}{message && <div className="card" style={{ marginBottom: 12 }}>{message}</div>}
    <div className="grid">{field('Date', 'date', expense, setExpense, 'date')}
      <select className="input" value={expense.category} onChange={(e) => changeCategory(e.target.value)}>{categories.map((x) => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
      {field('Amount', 'amount', expense, setExpense, 'number')}{field('Paid To', 'paid_to', expense, setExpense)}{field('Remarks', 'remarks', expense, setExpense)}</div>
    {needsCustomer && <div style={{ margin: '12px 0' }}>
      <div className="muted" style={{ marginBottom: 6 }}>Customer (Page No. / Name)</div>
      {!noCustomer && <CustomerPicker customers={customers} value={customer} onChange={setCustomer} />}
      {!customer && <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={noCustomer} onChange={(e) => setNoCustomer(e.target.checked)} /> Customer ke bina (general kharcha)</label>}
    </div>}
    <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save Expense'}</button></form>;
}

export function DealerHandoverCreatePage() {
  const [handover, setHandover] = useState({ date: today(), amount: '', sent_to: '', remarks: '' });
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [recent, setRecent] = useState([]); const [cash, setCash] = useState(null);
  const loadRecent = () => { const from = new Date(); from.setDate(from.getDate() - 14); const q = '?from=' + from.toISOString().slice(0, 10) + '&to=' + today(); get('/dealer/cash-book' + q).then((d) => { setRecent([...(d.pending_handovers || []), ...(d.handovers || []), ...(d.rejected_handovers || [])].sort((x, y) => String(y.date).localeCompare(String(x.date)) || y.id - x.id)); setCash({ inHand: Number(d.summary?.closing_balance || 0), pending: Number(d.summary?.pending_handover || 0) }); }).catch(() => {}); };
  useEffect(() => { loadRecent(); }, []);
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(''); try { const d = await post('/dealer/cash-book/handover', handover); setMessage(`Handover ${d.handover.handover_no} saved — waiting for Head Office to accept.`); setHandover({ ...handover, amount: '', sent_to: '', remarks: '' }); loadRecent(); setTimeout(() => setMessage(''), 4000); } catch (e2) { setError(e2.message || 'Could not save'); } finally { setSaving(false); } };
  const statusLabel = (s) => s === 'accepted' ? 'Accepted ✓' : s === 'rejected' ? 'Rejected' : 'Pending Acceptance';
  return <div><form className="card" onSubmit={submit}><h2>Cash Handover to Head Office</h2>{cash && <div className="muted" style={{ marginBottom: 10 }}>Cash in hand: <b>{money(cash.inHand)}</b>{cash.pending > 0 && <> · Pending acceptance: <b>{money(cash.pending)}</b> · Handover ke liye available: <b>{money(cash.inHand - cash.pending)}</b></>}<br />Head Office accept karega tab hi ye cash aapke cashbook se out hoga.</div>}{error && <div className="error">{error}</div>}{message && <div className="card" style={{ marginBottom: 12 }}>{message}</div>}<div className="grid">{field('Date', 'date', handover, setHandover, 'date')}{field('Amount', 'amount', handover, setHandover, 'number')}{field('Sent To / Received By', 'sent_to', handover, setHandover)}{field('Remarks', 'remarks', handover, setHandover)}</div><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Record HO Handover'}</button> <button type="button" className="btn" disabled title="Coming soon" style={{opacity:.6,cursor:'not-allowed',marginLeft:8}}>🏦 Pay to Head Office Bank via Cashfree <span className="muted">(Coming soon)</span></button></form><div className="card" style={{ marginTop: 12 }}><div className="pageHeader"><h2 style={{ margin: 0 }}>Recent Handovers</h2><button className="btn" onClick={loadRecent}>↻ Refresh</button></div><div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Handover No.</th><th>Amount</th><th>Status</th></tr></thead><tbody>{recent.map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.handover_no}</td><td>{money(h.amount)}</td><td>{statusLabel(h.status)}</td></tr>)}{!recent.length && <tr><td colSpan="4" className="muted">No handovers in the last 14 days.</td></tr>}</tbody></table></div></div></div>;
}

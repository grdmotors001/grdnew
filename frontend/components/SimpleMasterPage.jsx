'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { SIMPLE_MASTERS } from '../lib/menu';
import { Field, Card, ErrorBanner, EmptyState, useAsyncAction } from './ui';

export function SimpleMasterPage({ kind, setActive }) {
  const meta = SIMPLE_MASTERS[kind] || { label: kind, fields: [['name', 'Name', 'text']] };
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get(`/masters/${kind}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); setSearch(''); }, [kind]);

  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return meta.fields.some(([f]) => String(r[f] ?? '').toLowerCase().includes(q));
  });

  const isPaymentMaster = kind === 'mechanic' || kind === 'fabricator';
  const paymentExpenseType = kind === 'mechanic' ? 'assembly' : 'fabrication';
  const openPayments = async (r) => {
    setEditingId(r.id); setForm({ ...r }); setPaymentsOpen(true); setPaymentStatus('all');
    try {
      const x = await get('/expense-payment-voucher?expense_type=' + paymentExpenseType + '&status=all');
      setPayments((x.vouchers || []).filter(v => String(v.pay_to_name || '').toLowerCase() === String(r.name || '').toLowerCase()));
    } catch (e) { setError(e.message); }
  };
  const refreshPayments = async (r, st) => {
    try {
      const x = await get('/expense-payment-voucher?expense_type=' + paymentExpenseType + '&status=' + st);
      setPayments((x.vouchers || []).filter(v => String(v.pay_to_name || '').toLowerCase() === String(r.name || '').toLowerCase()));
    } catch (e) { setError(e.message); }
  };
  const openNew = () => { setEditingId(null); setForm({}); setOpen(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ ...r }); setOpen(true); };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (editingId) await put(`/masters/${kind}/${editingId}`, form);
      else await post(`/masters/${kind}`, form);
      setForm({});
      setEditingId(null);
      setOpen(false);
      load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this record?')) return;
    run(async () => {
      await del(`/masters/${kind}/${id}`);
      setOpen(false);
      setEditingId(null);
      load();
    });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ Add {meta.label}</button>
        {rows.length > 0 && <><input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />{search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}</>}
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {rows.length === 0 ? <EmptyState /> : filteredRows.length === 0 ? <EmptyState text="No records match your search." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>{meta.fields.map(([f, l]) => <th key={f}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  {meta.fields.map(([f], i) => (
                    <td key={f}>
                      {i === 0 ? (
                        <a onClick={() => isPaymentMaster ? openPayments(r) : openEdit(r)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                          {String(r[f] ?? '')}
                        </a>
                      ) : f === 'is_default' ? (r[f] ? 'Yes' : '') : f === 'is_double_tone' ? (r[f] ? 'Yes' : 'No') : f === 'color_hex' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
                          <span style={{width:24,height:16,borderRadius:4,border:'1px solid var(--border)',background:r.color_hex||'transparent',display:'inline-block'}} />
                          {r.color_hex||'—'}
                        </span>
                      ) : f === 'color_hex2' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
                          <span style={{width:24,height:16,borderRadius:4,border:'1px solid var(--border)',background:r.is_double_tone&&r.color_hex2?r.color_hex2:'transparent',display:'inline-block'}} />
                          {r.is_double_tone?(r.color_hex2||'—'):'—'}
                        </span>
                      ) : String(r[f] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paymentsOpen && (
        <div className="modal">
          <div className="modalbox">
            <h2>{meta.label}: {form.name}</h2>
            <p className="muted">{kind === 'mechanic' ? 'Assembly payment account' : 'Fabrication payment account'}</p>
            <div className="actions" style={{marginBottom:12}}>
              <button className={'btn '+(paymentStatus==='all'?'primary':'')} onClick={()=>{setPaymentStatus('all');refreshPayments(form,'all')}}>All</button>
              <button className={'btn '+(paymentStatus==='paid'?'primary':'')} onClick={()=>{setPaymentStatus('paid');refreshPayments(form,'paid')}}>Paid</button>
              <button className={'btn '+(paymentStatus==='unpaid'?'primary':'')} onClick={()=>{setPaymentStatus('unpaid');refreshPayments(form,'unpaid')}}>Unpaid</button>
              <span style={{flex:1}} />
              <button className="btn primary" onClick={()=>{setPaymentsOpen(false);setActive?.('expense-payment-voucher')}}>+ New Payment Voucher</button>
            </div>
            <div className="tablewrap">
              <table className="table"><thead><tr>
                <th>Payment Voucher No.</th><th>Date</th><th>Rickshaw / Chassis</th>
                <th>Model / Qty</th><th>Per Rickshaw / Rate</th><th>Status</th>
              </tr></thead><tbody>
                {payments.map(v=><tr key={v.id}>
                  <td><b>{v.voucher_no}</b></td><td>{v.date}</td><td>{v.chassis_no||'—'}</td>
                  <td>{v.work_model_name||'—'}{v.work_qty ? ' / ' + v.work_qty : ''}</td>
                  <td>₹{Number(v.rate_per_unit||v.amount||0).toLocaleString('en-IN')}</td>
                  <td>{v.paid_at?'Paid':'Unpaid'}</td>
                </tr>)}
                {!payments.length&&<tr><td colSpan="6" className="muted">No payment vouchers found.</td></tr>}
              </tbody></table>
            </div>
            <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}>
              <button className="btn" onClick={()=>setPaymentsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>{editingId ? `Edit ${meta.label}` : `Add ${meta.label}`}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              {meta.fields.map(([f, l, type]) => (
                <Field key={f} label={l} type={type} value={form[f]} onChange={(v) => setForm({ ...form, [f]: v })} required={f === 'name'} />
              
              ))}
            </div>
            {kind === 'colour' && <div className="card" style={{gridColumn:'1 / -1',padding:12}}>
                <b>Colour Preview</b>
                <div style={{display:'flex',alignItems:'center',gap:12,marginTop:10}}>
                  <div style={{width:110,height:42,borderRadius:8,border:'1px solid var(--border)',
                    background:form.is_double_tone&&form.color_hex2
                      ? `linear-gradient(90deg,${form.color_hex||'#fff'} 0 50%,${form.color_hex2} 50% 100%)`
                      : (form.color_hex||'transparent')}} />
                  <span className="muted">{form.is_double_tone?'Double Tone':'Single Tone'}</span>
                </div>
              </div>}
            <div className="actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              {editingId ? (
                <button type="button" className="btn danger" disabled={busy} onClick={() => remove(editingId)}>Delete</button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => { setOpen(false); setEditingId(null); }}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

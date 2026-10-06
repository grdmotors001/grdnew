'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { SIMPLE_MASTERS } from '../lib/menu';
import { Field, Card, ErrorBanner, EmptyState, useAsyncAction } from './ui';

export function SimpleMasterPage({ kind, setActive, setOptionUserId }) {
  const isSalesman = kind === 'salesman';
  // Account Head Master / Party Master me "Expense Type" dropdown Expense Type Master se aata hai.
  const [etOpts, setEtOpts] = useState(null);
  useEffect(() => {
    if (kind !== 'expense-head' && kind !== 'party') return;
    get('/expense-payment-voucher/masters').then((m) => setEtOpts((m.expense_types || []).map((t) => ({ value: t.id, label: t.name })))).catch(() => {});
  }, [kind]);
  const rawMeta = SIMPLE_MASTERS[kind] || { label: kind, fields: [['name', 'Name', 'text']] };
  const baseMeta = etOpts ? { ...rawMeta, fields: rawMeta.fields.map((fd) => fd[0] === 'expense_type' ? [fd[0], fd[1], fd[2], etOpts] : fd) } : rawMeta;
  // Party Master: Party Type me "Vendor / Supplier" option jodo; khali type bhi Vendor / Supplier maana jayega.
  const VENDOR = { value: 'vendor', label: 'Vendor / Supplier' };
  const typeKey = kind === 'party' ? (baseMeta.fields.find(([f, l]) => /party\s*type/i.test(l) || f === 'sub_category') || [])[0] : null;
  const meta = typeKey ? { ...baseMeta, fields: baseMeta.fields.map((fd) => fd[0] === typeKey
    ? [fd[0], fd[1], 'select', [VENDOR, ...(fd[3] || []).filter((o) => String(o.value ?? o).toLowerCase() !== 'vendor')]] : fd) } : baseMeta;
  const typeOptions = typeKey ? meta.fields.find((fd) => fd[0] === typeKey)[3] : [];
  const typeLabel = (v) => { const x = String(v ?? '').trim(); if (!x) return VENDOR.label; const o = typeOptions.find((o) => String(o.value ?? o).toLowerCase() === x.toLowerCase()); return o ? (o.label ?? o) : x; };
  const typeVal = (v) => String(v ?? '').trim().toLowerCase() || 'vendor';
  const [typeFilter, setTypeFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => (kind === 'expense-type' ? get('/expense-payment-voucher/masters').catch(() => null) : Promise.resolve()).then(() => get(`/masters/${kind}`)).then((d) => setRows(Array.isArray(d) ? d : (d.masters || d.rows || d.data || []))).catch((e) => setError(e.message));
  useEffect(() => { load(); setSearch(''); }, [kind]);

  const filteredRows = rows.filter((r) => {
    if (typeKey && typeFilter !== 'all' && typeVal(r[typeKey]) !== typeFilter) return false;
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
      const payload = typeKey ? { ...form, [typeKey]: String(form[typeKey] || '').trim() || 'vendor' } : form;
      if (editingId) await put(`/masters/${kind}/${editingId}`, payload);
      else await post(`/masters/${kind}`, payload);
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
      {typeKey && rows.length > 0 && <div className="actions" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {[{ value: 'all', label: 'All' }, ...typeOptions.map((o) => ({ value: String(o.value ?? o).toLowerCase(), label: o.label ?? o }))].map((t) => {
          const n = t.value === 'all' ? rows.length : rows.filter((r) => typeVal(r[typeKey]) === t.value).length;
          return <button key={t.value} className={'btn ' + (typeFilter === t.value ? 'primary' : '')} onClick={() => setTypeFilter(t.value)}>{t.label} ({n})</button>;
        })}
      </div>}
      <ErrorBanner message={!open ? error : ''} />
      {rows.length === 0 ? <EmptyState /> : filteredRows.length === 0 ? <EmptyState text="No records match your search." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>{meta.fields.map(([f, l]) => <th key={f}>{l}</th>)}{isSalesman && <><th>Login ID</th><th>Modules</th><th></th></>}</tr>
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
                      ) : f === 'is_default' ? (r[f] ? 'Yes' : '') : f === 'inactive' ? (r[f] ? 'Band' : 'Chalu') : f === 'expense_type' ? ((etOpts || []).find((o) => o.value === r[f])?.label || String(r[f] ?? '')) : f === 'is_double_tone' ? (r[f] ? 'Yes' : 'No') : f === 'color_hex' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
                          <span style={{width:24,height:16,borderRadius:4,border:'1px solid var(--border)',background:r.color_hex||'transparent',display:'inline-block'}} />
                          {r.color_hex||'—'}
                        </span>
                      ) : f === 'color_hex2' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
                          <span style={{width:24,height:16,borderRadius:4,border:'1px solid var(--border)',background:r.is_double_tone&&r.color_hex2?r.color_hex2:'transparent',display:'inline-block'}} />
                          {r.is_double_tone?(r.color_hex2||'—'):'—'}
                        </span>
                      ) : f === typeKey ? typeLabel(r[f]) : String(r[f] ?? '')}
                    </td>
                  ))}
                  {isSalesman && <>
                    <td>{r.login_id || <span className="muted">No login</span>}</td>
                    <td>{r.has_login ? `${r.modules_count} modules` : '—'}</td>
                    <td>{r.user_id && setOptionUserId ? <button className="btn" onClick={() => { setOptionUserId(r.user_id); setActive?.('option-setting'); }}>Permissions</button> : null}</td>
                  </>}
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
              {meta.fields.map(([f, l, type, options]) => (
                <Field key={f} label={l} type={type} options={options} value={form[f]} onChange={(v) => setForm({ ...form, [f]: v })} required={f === 'name'} />
              
              ))}
              {isSalesman && <>
                <Field label="Login ID (blank = salesman name)" value={form.login_id} onChange={(v) => setForm({ ...form, login_id: v })} />
                <Field label={form.has_login ? 'Password (blank = keep current)' : 'Password'} type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
                <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
                  Login yahin se banta hai (User Master me bhi dikhega). Module / action permissions ke liye save ke baad list me "Permissions" dabayen. Dealer access Dealer Master → Salesman se automatic judta hai.
                </div>
              </>}
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

'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { ErrorBanner, Field } from './ui';
import { formatDate } from '../lib/date';

// Contra voucher (F4): paisa apne hi Cash / Bank accounts ke beech move hota hai.
//   CB = Cash  -> Bank  (cash deposit)
//   BC = Bank  -> Cash  (cash withdrawal)
//   BB = Bank  -> Bank  (transfer)
const KINDS = [
  { value: 'BB', label: 'Bank → Bank', from: 'BANK', to: 'BANK' },
  { value: 'CB', label: 'Cash → Bank (Cash Deposit)', from: 'CASH', to: 'BANK' },
  { value: 'BC', label: 'Bank → Cash (Cash Withdrawal)', from: 'BANK', to: 'CASH' },
];
const kindOf = (r) => (r.from_type === 'CASH' ? 'CB' : r.to_type === 'CASH' ? 'BC' : 'BB');
const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toList = (d) => (Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.items || []));
const today = () => new Date().toISOString().slice(0, 10);
const side = (type, bank) => (type === 'CASH' ? 'Cash' : bank || 'Bank');

export function ContraVoucherPage() {
  const [data, setData] = useState(null);
  const [banks, setBanks] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    get('/contra-vouchers?' + q).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [from, to, search]);
  useEffect(() => { get('/masters/bank').then((d) => setBanks(toList(d))).catch(() => {}); }, []);

  const bankOpts = banks.map((b) => ({ value: b.id, label: `${b.name}${b.account_no ? ` — ${b.account_no}` : ''}` }));
  const rows = data?.rows || [];
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const openNew = () => {
    setError('');
    setForm({ date: today(), kind: 'BB', vr_no: data?.next_vr_no, from_bank_id: '', to_bank_id: '', amount: '', ref_no: '', narration: '' });
    setOpen(true);
  };
  const openEdit = (r) => {
    setError('');
    setForm({ ...r, kind: kindOf(r), from_bank_id: r.from_bank_id || '', to_bank_id: r.to_bank_id || '' });
    setOpen(true);
  };
  const setKind = (k) => setForm((f) => ({ ...f, kind: k, from_bank_id: KINDS.find((x) => x.value === k).from === 'BANK' ? f.from_bank_id : '', to_bank_id: KINDS.find((x) => x.value === k).to === 'BANK' ? f.to_bank_id : '' }));

  const save = async (e) => {
    e.preventDefault();
    const k = KINDS.find((x) => x.value === form.kind);
    setBusy(true); setError('');
    try {
      await post('/contra-vouchers', {
        id: form.id, vr_no: form.id ? undefined : form.vr_no, date: form.date,
        from_type: k.from, from_bank_id: k.from === 'BANK' ? form.from_bank_id : null,
        to_type: k.to, to_bank_id: k.to === 'BANK' ? form.to_bank_id : null,
        amount: form.amount, ref_no: form.ref_no, narration: form.narration,
      });
      setOpen(false); load();
    } catch (err) { setError(err.message || 'Save failed'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!form.id || !window.confirm('Delete this contra voucher?')) return;
    try { await del('/contra-vouchers/' + form.id); setOpen(false); load(); } catch (err) { setError(err.message); }
  };

  const k = KINDS.find((x) => x.value === form.kind) || KINDS[0];
  const kpi = { flex: '1 1 200px' };

  if (!data) return <div className="card">{error ? <><b>Contra Voucher load failed</b><div style={{ marginTop: 8, color: 'var(--red)' }}>{error}</div><button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button></> : 'Loading…'}</div>;

  return <div>
    <div className="pageHeader">
      <div><h1>Contra Voucher</h1><p className="muted">G.R.D. Motors · Bank → Bank, Cash → Bank, Bank → Cash ki entry</p></div>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={openNew}>+ Contra</button>
      </div>
    </div>
    <ErrorBanner message={!open ? error : ''} />
    <div className="toolbar">
      <Field label="From" type="date" value={from} onChange={setFrom} />
      <Field label="To" type="date" value={to} onChange={setTo} />
      <Field label="Search" value={search} onChange={setSearch} />
      <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setFrom(''); setTo(''); setSearch(''); }}>Clear</button>
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
      <div className="card" style={kpi}><div className="muted">Total Transferred</div><div className="metric" style={{ fontSize: 22 }}>₹{inr(total)}</div></div>
      <div className="card" style={kpi}><div className="muted">Entries</div><div className="metric" style={{ fontSize: 22 }}>{rows.length}</div></div>
    </div>
    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Date</th><th>Vr. No.</th><th>Type</th><th>From</th><th>To</th><th>Cheque / UTR</th><th>Narration</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.id} onClick={() => openEdit(r)} style={{ cursor: 'pointer' }} title="Click to edit">
            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
            <td>{r.vr_no ?? '—'}</td>
            <td>{KINDS.find((x) => x.value === kindOf(r))?.label.split(' (')[0]}</td>
            <td><b>{side(r.from_type, r.from_bank_name)}</b></td>
            <td><b>{side(r.to_type, r.to_bank_name)}</b></td>
            <td>{r.ref_no || '—'}</td>
            <td>{r.narration || '—'}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(r.amount)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>No contra entries found.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr><td colSpan={7} style={{ fontWeight: 800 }}>Total ({rows.length} entries)</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(total)}</td></tr></tfoot>}
      </table>
    </div>

    {open && <div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{form.id ? 'Edit' : 'New'} Contra Voucher</h2>
      <ErrorBanner message={error} />
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} required />
        <Field label="Vr. No." value={form.vr_no ?? ''} readOnly />
        <Field label="Contra Type" type="select" value={form.kind} options={KINDS.map((x) => ({ value: x.value, label: x.label }))} onChange={setKind} required />
        {k.from === 'BANK'
          ? <Field label="From Bank" type="select" value={form.from_bank_id} options={bankOpts} onChange={(v) => setForm({ ...form, from_bank_id: v })} required />
          : <Field label="From" value="Cash" readOnly />}
        {k.to === 'BANK'
          ? <Field label="To Bank" type="select" value={form.to_bank_id} options={bankOpts} onChange={(v) => setForm({ ...form, to_bank_id: v })} required />
          : <Field label="To" value="Cash" readOnly />}
        <Field label="Amount" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
        <Field label="Cheque No / UTR (optional)" value={form.ref_no} onChange={(v) => setForm({ ...form, ref_no: v })} />
        <Field label="Narration" value={form.narration} onChange={(v) => setForm({ ...form, narration: v })} />
      </div>
      <div className="actions" style={{ marginTop: 18, justifyContent: form.id ? 'space-between' : 'flex-end', display: 'flex' }}>
        {form.id ? <button type="button" className="btn danger" onClick={remove}>Delete</button> : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form></div>}
  </div>;
}

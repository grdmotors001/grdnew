'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { ErrorBanner, Field } from './ui';
import { formatDate } from '../lib/date';

// F10 Journal Voucher: 2-3 party ki Dr / Cr entry (amount + date + remark). Total Dr = Total Cr hona zaruri.
const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const blank = (side) => ({ party_name: '', side, amount: '' });
const SIDES = [{ value: 'Dr', label: 'Dr (Debit)' }, { value: 'Cr', label: 'Cr (Credit)' }];
const MAX_LINES = 6;

export function JournalVoucherPage() {
  const [data, setData] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    get('/journal-vouchers?' + q).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [from, to, search]);

  const rows = data?.rows || [];
  const partyOpts = (data?.parties || []).map((p) => ({ value: p.name, label: `${p.name} · ${p.group}` }));

  const openNew = () => {
    setError('');
    setForm({ date: today(), vr_no: data?.next_vr_no, narration: '', lines: [blank('Dr'), blank('Cr')] });
    setOpen(true);
  };
  const openEdit = (r) => {
    setError('');
    setForm({ id: r.id, date: r.date, vr_no: r.vr_no, narration: r.narration || '', created_by: r.created_by,
      lines: r.lines.map((l) => ({ party_name: l.party_name, side: l.side, amount: l.amount })) });
    setOpen(true);
  };
  const setLine = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLine = () => setForm((f) => (f.lines.length >= MAX_LINES ? f : { ...f, lines: [...f.lines, blank('Dr')] }));
  const removeLine = (i) => setForm((f) => (f.lines.length <= 2 ? f : { ...f, lines: f.lines.filter((_, j) => j !== i) }));

  const sum = (side) => (form.lines || []).filter((l) => l.side === side).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const dr = sum('Dr'), cr = sum('Cr'), diff = Math.round((dr - cr) * 100) / 100;
  const balanced = dr > 0 && cr > 0 && Math.abs(diff) < 0.005;

  const save = async (e) => {
    e.preventDefault();
    if (!balanced) { setError('Total Dr aur Total Cr barabar hone chahiye.'); return; }
    setBusy(true); setError('');
    try {
      await post('/journal-vouchers', { id: form.id, date: form.date, narration: form.narration,
        lines: form.lines.map((l) => ({ party_name: l.party_name, side: l.side, amount: l.amount })) });
      setOpen(false); load();
    } catch (err) { setError(err.message || 'Save failed'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!form.id || !window.confirm('Delete this journal voucher?')) return;
    try { await del('/journal-vouchers/' + form.id); setOpen(false); load(); } catch (err) { setError(err.message); }
  };

  if (!data) return <div className="card">{error ? <><b>Journal Voucher load failed</b><div style={{ marginTop: 8, color: 'var(--red)' }}>{error}</div><button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button></> : 'Loading…'}</div>;

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  return <div>
    <div className="pageHeader">
      <div><h1>Journal Voucher (F10)</h1><p className="muted">G.R.D. Motors · 2-3 party ki Dr / Cr entry. Total Dr = Total Cr.</p></div>
      <div className="actions"><button className="btn primary" onClick={openNew}>+ Journal</button></div>
    </div>
    <ErrorBanner message={!open ? error : ''} />
    <div className="toolbar">
      <Field label="From" type="date" value={from} onChange={setFrom} />
      <Field label="To" type="date" value={to} onChange={setTo} />
      <Field label="Search (party / remark / JV no.)" value={search} onChange={setSearch} />
      <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setFrom(''); setTo(''); setSearch(''); }}>Clear</button>
    </div>
    <div className="tablewrap" style={{ marginTop: 12 }}>
      <table className="table">
        <thead><tr><th>Date</th><th>Vr. No.</th><th>Dr (Party)</th><th>Cr (Party)</th><th>Remark</th><th>Created By</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.id} onClick={() => openEdit(r)} style={{ cursor: 'pointer' }} title="Click to view / edit">
            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
            <td><b>{r.voucher_no}</b></td>
            <td>{r.lines.filter((l) => l.side === 'Dr').map((l) => `${l.party_name} (${inr(l.amount)})`).join(', ')}</td>
            <td>{r.lines.filter((l) => l.side === 'Cr').map((l) => `${l.party_name} (${inr(l.amount)})`).join(', ')}</td>
            <td>{r.narration || '—'}</td>
            <td>{r.created_by || '—'}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(r.total)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>No journal vouchers found.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr><td colSpan={6} style={{ fontWeight: 800 }}>Total ({rows.length} vouchers)</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(total)}</td></tr></tfoot>}
      </table>
    </div>

    {open && <div className="modal"><form className="modalbox" onSubmit={save} style={{ maxWidth: 720 }}>
      <h2>{form.id ? 'Edit' : 'New'} Journal Voucher</h2>
      <ErrorBanner message={error} />
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} required />
        <Field label="Vr. No." value={form.vr_no ? 'JV-' + form.vr_no : ''} readOnly />
        <Field label="Remark" value={form.narration} onChange={(v) => setForm({ ...form, narration: v })} />
      </div>
      <div style={{ marginTop: 14, fontWeight: 700 }}>Party entries</div>
      {form.lines.map((l, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) 110px minmax(0,1.3fr) 34px', gap: 8, alignItems: 'end', marginTop: 8 }}>
        <Field label={i === 0 ? 'Party' : ''} type="select" value={l.party_name} options={partyOpts} onChange={(v) => setLine(i, 'party_name', v)} required />
        <Field label={i === 0 ? 'Dr / Cr' : ''} type="select" value={l.side} options={SIDES} onChange={(v) => setLine(i, 'side', v)} required />
        <Field label={i === 0 ? 'Amount' : ''} type="number" value={l.amount} onChange={(v) => setLine(i, 'amount', v)} required />
        <button type="button" className="btn" disabled={form.lines.length <= 2} onClick={() => removeLine(i)} title="Remove line">✕</button>
      </div>)}
      <div style={{ marginTop: 10 }}><button type="button" className="btn" disabled={form.lines.length >= MAX_LINES} onClick={addLine}>+ Add party</button></div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14, fontWeight: 700 }}>
        <span>Total Dr: ₹{inr(dr)}</span><span>Total Cr: ₹{inr(cr)}</span>
        <span style={{ color: balanced ? 'var(--green, #15803d)' : 'var(--red, #b91c1c)' }}>{balanced ? 'Balanced ✓' : `Difference: ₹${inr(Math.abs(diff))} ${diff > 0 ? '(Dr zyada)' : diff < 0 ? '(Cr zyada)' : ''}`}</span>
      </div>
      {form.id && form.created_by ? <div className="muted" style={{ marginTop: 8 }}>Created by: {form.created_by}</div> : null}
      <div className="actions" style={{ marginTop: 18, justifyContent: form.id ? 'space-between' : 'flex-end', display: 'flex' }}>
        {form.id ? <button type="button" className="btn danger" onClick={remove}>Delete</button> : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={busy || !balanced}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form></div>}
  </div>;
}

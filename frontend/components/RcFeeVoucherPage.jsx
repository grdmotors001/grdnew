'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { formatDate } from '../lib/date';

// RC Fee Voucher (Old Rickshaw) + niche RC Issued Register.
// Sirf jin gaadiyon ko RC fee deni hai unhe tick karo -> ek voucher. Approval / Paid: "Expense Payment Voucher" page se.
const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export function RcFeeVoucherPage() {
  const [data, setData] = useState({ parties: [], pending: [], register: [], summary: { total: 0, pending: 0, issued: 0, fee: 0 } });
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  const [form, setForm] = useState({ date: today(), pay_to_name: '', fee: '', remarks: '' });
  const [sel, setSel] = useState({}), [amts, setAmts] = useState({});
  const [issue, setIssue] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [msg, setMsg] = useState('');

  const load = async () => {
    try {
      setError('');
      const q = new URLSearchParams({ search, status });
      setData(await get('/rc-fee?' + q.toString()));
    } catch (e) { setError(e.message || 'Could not load RC fee data.'); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search, status]);
  // Party Master me sirf ek "Other" party ho (RC ISSUED) to apne aap select ho jaye.
  useEffect(() => {
    if (form.pay_to_name || !data.parties.length) return;
    const p = data.parties.find(x => /rc\s*issued/i.test(x)) || (data.parties.length === 1 ? data.parties[0] : '');
    if (p) setForm(f => ({ ...f, pay_to_name: p }));
  }, [data.parties]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const amountOf = id => (amts[id] !== undefined && amts[id] !== '' ? Number(amts[id]) : Number(form.fee || 0));
  const chosen = data.pending.filter(r => sel[r.id]);
  const total = chosen.reduce((s, r) => s + amountOf(r.id), 0);
  const toggle = id => setSel(s => ({ ...s, [id]: !s[id] }));

  const save = async e => {
    e.preventDefault(); setError(''); setMsg('');
    if (!chosen.length) return setError('Kam se kam ek rickshaw tick karo.');
    if (chosen.some(r => amountOf(r.id) <= 0)) return setError('RC fee daalo (upar "RC Fee per Rickshaw" ya row me).');
    setBusy(true);
    try {
      const r = await post('/rc-fee', { action: 'create', date: form.date, pay_to_name: form.pay_to_name, remarks: form.remarks, items: chosen.map(x => ({ inventory_id: x.id, amount: amountOf(x.id) })) });
      setMsg('Voucher ' + r.voucher_no + ' ban gaya: ' + r.count + ' rickshaw, ' + money(r.amount) + '. Approval ke liye gaya. Approve aur Cashier ka Paid Expense Payment Voucher page se hoga.');
      setSel({}); setAmts({}); setF('remarks', '');
      await load();
    } catch (err) { setError(err.message || 'Could not save voucher.'); }
    finally { setBusy(false); }
  };

  const saveIssued = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await post('/rc-fee', { action: 'issue', id: issue.row.id, rc_issued_date: issue.date, rc_no: issue.rc_no, remarks: issue.remarks });
      setIssue(null); await load();
    } catch (err) { setError(err.message || 'Could not update.'); }
    finally { setBusy(false); }
  };
  const undo = async row => {
    if (!confirm(row.vehicle_no + ' ko wapas "RC Pending" karna hai?')) return;
    try { await post('/rc-fee', { action: 'unissue', id: row.id }); await load(); }
    catch (err) { setError(err.message || 'Could not update.'); }
  };
  const vStatus = r => r.voucher_status === 'approved' ? (r.payment_status === 'paid' ? 'Approved · Paid' : 'Approved · Unpaid') : 'Pending Approval';
  const s = data.summary || {};

  return <div className="page">
    <div className="pageHeader"><div><h1>RC Fee Voucher</h1><p className="muted">Old Rickshaw ki RC fee (cash). Sirf jin gaadiyon ko chahiye unhe tick karo.</p></div></div>
    {error && <div className="error">{error}</div>}
    {msg && <div className="card" style={{ marginBottom: 12, color: '#15803d', fontWeight: 700 }}>{msg}</div>}

    <form className="card" onSubmit={save}>
      <h2>New RC Fee Voucher</h2>
      <div className="grid">
        <input className="input" type="date" value={form.date} onChange={e => setF('date', e.target.value)} required />
        <select className="input" value={form.pay_to_name} onChange={e => setF('pay_to_name', e.target.value)} required>
          <option value="">Select Party (Other · RC ISSUED)</option>
          {data.parties.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="input" type="number" min="0" step="0.01" placeholder="RC Fee per Rickshaw" value={form.fee} onChange={e => setF('fee', e.target.value)} />
        <input className="input" placeholder="Remarks (optional)" value={form.remarks} onChange={e => setF('remarks', e.target.value)} />
      </div>
      {!data.parties.length && <div className="muted" style={{ marginTop: 8 }}>Party Master me category "Other" me party <b>RC ISSUED</b> bana lo, phir yahan dikhegi.</div>}

      <div className="actions" style={{ justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap' }}>
        <b>Old Rickshaw (RC fee voucher baki): {data.pending.length}</b>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search vehicle no / model / dealer" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="tablewrap"><table className="table">
        <thead><tr><th></th><th>Vehicle No.</th><th>Model</th><th>Dealer</th><th>Repo Date</th><th>Status</th><th>RC Fee</th></tr></thead>
        <tbody>
          {data.pending.map(r => <tr key={r.id} onClick={() => toggle(r.id)}>
            <td><input type="checkbox" checked={!!sel[r.id]} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} /></td>
            <td><b>{r.vehicle_no}</b></td><td>{r.model_name || '—'}</td><td>{r.dealer_name || '—'}</td>
            <td>{r.repo_date ? formatDate(r.repo_date) : '—'}</td><td>{r.status}</td>
            <td onClick={e => e.stopPropagation()}>{sel[r.id] && <input className="input" style={{ width: 100 }} type="number" min="0" step="0.01" placeholder={form.fee || 'Fee'} value={amts[r.id] ?? ''} onChange={e => setAmts(m => ({ ...m, [r.id]: e.target.value }))} />}</td>
          </tr>)}
          {!data.pending.length && <tr><td colSpan="7" className="muted">Koi rickshaw nahi mili.</td></tr>}
        </tbody>
      </table></div>
      <div className="actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span>Selected: <b>{chosen.length}</b> · Total: <b>{money(total)}</b></span>
        <button className="btn primary" disabled={busy || !chosen.length || !form.pay_to_name}>{busy ? 'Saving…' : 'Save RC Fee Voucher'}</button>
      </div>
    </form>

    <div className="card" style={{ marginTop: 16 }}>
      <div className="actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>RC Issued Register</h2>
          <div className="muted">Total {s.total} · RC Pending <b>{s.pending}</b> · RC Issued <b>{s.issued}</b> · Fee {money(s.fee)}</div></div>
        <select className="input" style={{ maxWidth: 180 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All</option><option value="pending">RC Pending</option><option value="issued">RC Issued</option>
        </select>
      </div>
      <div className="tablewrap"><table className="table">
        <thead><tr><th>Fee Date</th><th>Vehicle No.</th><th>Model</th><th>Voucher</th><th>Fee</th><th>Created By</th><th>Approved By</th><th>Paid By</th><th>Voucher Status</th><th>RC Status</th><th>RC Date</th><th>RC No.</th><th></th></tr></thead>
        <tbody>
          {data.register.map(r => <tr key={r.id}>
            <td>{r.fee_date ? formatDate(r.fee_date) : '—'}</td><td><b>{r.vehicle_no}</b></td><td>{r.model_name || '—'}</td>
            <td>{r.voucher_no}</td><td>{money(r.fee_amount)}</td><td>{r.voucher_created_by||'—'}</td><td>{r.approved_by||'—'}</td><td>{r.paid_by||'—'}</td><td>{vStatus(r)}</td>
            <td style={{ fontWeight: 700, color: r.rc_issued ? '#15803d' : '#b45309' }}>{r.rc_issued ? 'RC Issued' : 'RC Pending'}</td>
            <td>{r.rc_issued_date ? formatDate(r.rc_issued_date) : '—'}</td><td>{r.rc_no || '—'}</td>
            <td>{r.rc_issued
              ? <button type="button" className="btn" onClick={() => undo(r)}>Undo</button>
              : <button type="button" className="btn" onClick={() => setIssue({ row: r, date: today(), rc_no: '', remarks: '' })}>Mark RC Issued</button>}</td>
          </tr>)}
          {!data.register.length && <tr><td colSpan="13" className="muted">Abhi koi RC fee entry nahi.</td></tr>}
        </tbody>
      </table></div>
    </div>

    {issue && <div className="modal"><form className="modalbox" onSubmit={saveIssued}>
      <h2>RC Issued — {issue.row.vehicle_no}</h2>
      <div className="grid">
        <input className="input" type="date" value={issue.date} onChange={e => setIssue(i => ({ ...i, date: e.target.value }))} required />
        <input className="input" placeholder="RC No. (optional)" value={issue.rc_no} onChange={e => setIssue(i => ({ ...i, rc_no: e.target.value }))} />
        <input className="input" placeholder="Remarks (optional)" value={issue.remarks} onChange={e => setIssue(i => ({ ...i, remarks: e.target.value }))} />
      </div>
      <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => setIssue(null)}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form></div>}
  </div>;
}

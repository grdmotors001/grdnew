'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner } from './ui';
import { printCashReceipt } from '../lib/printReceipt';

const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => `₹ ${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const outstandingOf = (v) => Math.max(0, Math.round((Number(v?.total_amount || 0) - Number(v?.paid_amount || 0)) * 100) / 100);
const blank = () => ({ date: today(), voucher_id: '', amount: '', payment_mode: 'cash', reference_no: '', remarks: '' });

// Factory ke Repair / Service Voucher ki payment receipt.
// Ye page sirf us ek Dealer/Showroom ko dikhta hai jise Admin ne "Repair Payment Receipt" right diya hai.
// Cash is dealer ke cashbook me aata hai aur wahi se Head Office ko handover hota hai.
export function DealerRepairReceiptPage({ dealer } = {}) {
  const [vouchers, setVouchers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [form, setForm] = useState(blank());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [denied, setDenied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await get('/dealer/repair-receipts', { noClientCache: true });
      setVouchers(r.vouchers || []);
      setReceipts(r.receipts || []);
      setDenied(false);
    } catch (e) {
      if (/right|forbidden|403/i.test(e.message || '')) setDenied(true);
      else setError(e.message || 'Could not load repair vouchers');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const selected = useMemo(() => vouchers.find((v) => String(v.id) === String(form.voucher_id)), [vouchers, form.voucher_id]);
  const balance = outstandingOf(selected);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError(''); setSaved(null);
    const amount = Number(form.amount);
    if (!selected) { setError('Repair / Service Voucher select karein.'); return; }
    if (!(amount > 0)) { setError('Receipt amount enter karein.'); return; }
    if (amount > balance + 0.005) { setError(`Receipt amount outstanding balance (${money(balance)}) se zyada nahi ho sakta.`); return; }
    setSaving(true);
    try {
      const r = await post('/dealer/repair-receipts', { ...form, voucher_id: Number(form.voucher_id), amount });
      setSaved({ ...r.receipt, customer_name: selected.customer_name, balance_after: Math.max(0, balance - amount) });
      setForm(blank());
      await load();
    } catch (err) {
      setError(err.message || 'Could not create receipt');
      await load(); // balance change hua ho to fresh dikhe
    } finally { setSaving(false); }
  };

  if (denied) {
    return <div className="dealerPanel" style={{ maxWidth: 980 }}>
      <div className="dealerEmpty">Repair Payment Receipt ka right aapke paas nahi hai. Admin se contact karein.</div>
    </div>;
  }

  return <div className="dealerLoanPage">
    <div className="dealerPanel" style={{ maxWidth: 980 }}>
      <div className="dealerPanelHead">
        <div><h3>Repair Payment Receipt</h3><p>Factory Repair / Service Voucher ki payment yahin se receive hogi. Cash aapke cashbook me aayega aur Cash Handover se Head Office ko jayega.</p></div>
        <button type="button" className="btn" onClick={load}>↻ Refresh</button>
      </div>
      <ErrorBanner message={error} />
      {saved && <div className="card" style={{ padding: 12, marginBottom: 14, border: '1px solid #b7e4c7', background: '#f1fff5', color: '#176b35' }}>
        <b>✓ Receipt {saved.receipt_no} saved</b>
        <div className="muted" style={{ marginTop: 5 }}>{saved.customer_name} · {money(saved.amount)} · {saved.date}</div>
        <button type="button" className="btn primary" style={{ marginTop: 9 }} onClick={() => printCashReceipt(saved, { dealerName: dealer?.name || dealer?.dealer_name || '' })}>🖨 Print Receipt (58mm)</button>
      </div>}

      <form onSubmit={submit}>
        <div className="grid">
          <Field label="Repair / Service Voucher" type="select" value={form.voucher_id}
            options={[{ value: '', label: 'Select Repair / Service Voucher' }, ...vouchers.map((v) => ({ value: v.id, label: `${v.voucher_no} — ${v.customer_name || '—'} — ${v.vehicle_no || '—'} — Balance ${money(outstandingOf(v))}` }))]}
            onChange={(v) => setForm((x) => ({ ...x, voucher_id: v, amount: '' }))} required />
          <Field label="Date" type="date" value={form.date} onChange={(v) => set('date', v)} required />
          <div className="card" style={{ padding: 10 }}><small className="muted">Voucher Total</small><b>{money(selected?.total_amount)}</b></div>
          <div className="card" style={{ padding: 10 }}><small className="muted">Already Paid</small><b>{money(selected?.paid_amount)}</b></div>
          <div className="card" style={{ padding: 10 }}><small className="muted">Outstanding Balance</small><b>{money(balance)}</b></div>
          <Field label="Receipt Amount" type="number" value={form.amount} onChange={(v) => set('amount', v)} required />
          <Field label="Payment Mode" type="select" value={form.payment_mode}
            options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }, { value: 'cheque', label: 'Cheque' }]}
            onChange={(v) => set('payment_mode', v)} />
          <Field label="Reference / Cheque No." value={form.reference_no} onChange={(v) => set('reference_no', v)} />
          <Field label="Remarks" value={form.remarks} onChange={(v) => set('remarks', v)} />
        </div>
        {selected && selected.dealer_name && <div className="muted" style={{ margin: '8px 0' }}>Voucher showroom / branch: {selected.dealer_name}</div>}
        <button className="btn primary" disabled={saving || !selected} style={{ marginTop: 12 }}>{saving ? 'Saving…' : 'Create Payment Receipt'}</button>
      </form>
    </div>

    <div className="dealerPanel" style={{ maxWidth: 980, marginTop: 14 }}>
      <div className="dealerPanelHead"><div><h3>Payment Receipt Register</h3><p>Aapke banaye hue Repair receipts.</p></div></div>
      {loading ? <div className="dealerEmpty">Loading…</div> : <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Receipt No.</th><th>Date</th><th>Repair Voucher</th><th>Customer</th><th>Vehicle No.</th><th>Amount</th><th>Mode</th><th>Reference</th></tr></thead>
        <tbody>
          {receipts.map((r) => <tr key={r.id}><td><b>{r.receipt_no}</b></td><td>{String(r.date || '').slice(0, 10)}</td><td>{r.voucher_no || '—'}</td><td>{r.customer_name}</td><td>{r.vehicle_no || '—'}</td><td><b>{money(r.amount)}</b></td><td>{r.payment_mode}</td><td>{r.reference_no || '—'}</td></tr>)}
          {!receipts.length && <tr><td colSpan="8" className="muted">No receipts found.</td></tr>}
        </tbody>
      </table></div>}
    </div>
  </div>;
}

'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Money, Field, ErrorBanner } from './ui';

export function DealerCashReceiptPage() {
  const [data, setData] = useState({ pending_handovers: [], dealers: [] });
  const [form, setForm] = useState({ dealer_id: '', handover_id: '', date: new Date().toISOString().slice(0,10), amount: '', received_by: '', remarks: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const load = () => {
    setLoading(true);
    get('/cashier/dealer-cash-receipts')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const acceptHandover = (h) => {
    setForm({
      dealer_id: String(h.dealer_id),
      handover_id: String(h.id),
      date: h.date || new Date().toISOString().slice(0,10),
      amount: h.amount,
      received_by: '',
      remarks: h.remarks || ''
    });
    setReceipt(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setReceipt(null);
    try {
      const r = await post('/cashier/dealer-cash-receipts', {
        ...form,
        dealer_id: Number(form.dealer_id),
        handover_id: form.handover_id ? Number(form.handover_id) : null,
        amount: Number(form.amount)
      });
      setReceipt(r);
      setForm({ dealer_id: '', handover_id: '', date: new Date().toISOString().slice(0,10), amount: '', received_by: '', remarks: '' });
      load();
    } catch (e) {
      setError(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2>Dealer Cash Receipt</h2>
          <p className="muted">Cashier accepts cash received from a dealer. The receipt is posted to that dealer's ledger / Day Book.</p>
        </div>
        <button className="btn" onClick={load}>↻ Refresh</button>
      </div>

      <ErrorBanner message={error} />

      {receipt && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>Receipt Created</h3>
          <div><b>{receipt.receipt_no}</b> &nbsp; | &nbsp; {receipt.dealer_name} &nbsp; | &nbsp; <Money value={receipt.amount} /></div>
          <div className="muted" style={{ marginTop: 6 }}>{receipt.date} · Received by {receipt.received_by}</div>
          <button className="btn primary" style={{ marginTop: 10 }} onClick={() => window.print()}>Print Receipt</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Direct Cash Received at Head Office</h3>
        <form onSubmit={submit}>
          <div className="formgrid">
            <Field label="Dealer" type="select" value={form.dealer_id} options={[
              { value: '', label: 'Select Dealer' },
              ...data.dealers.map(d => ({ value: d.id, label: `${d.code ? d.code + ' — ' : ''}${d.name}` }))
            ]} onChange={v => setForm({ ...form, dealer_id: v, handover_id: '' })} required />
            <Field label="Date" type="date" value={form.date} onChange={v => setForm({ ...form, date: v })} required />
            <Field label="Amount" type="number" value={form.amount} onChange={v => setForm({ ...form, amount: v })} required />
            <Field label="Received By (Cashier)" value={form.received_by} onChange={v => setForm({ ...form, received_by: v })} required />
            <Field label="Remarks" value={form.remarks} onChange={v => setForm({ ...form, remarks: v })} />
          </div>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Receive Cash & Create Receipt'}</button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Dealer Cash Sent to Head Office — Pending Acceptance</h3>
        {loading ? <div className="muted">Loading…</div> : data.pending_handovers.length === 0 ? (
          <div className="muted">No pending cash handovers.</div>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Handover No.</th><th>Dealer</th><th>Amount</th><th>Sent To</th><th></th></tr></thead>
              <tbody>
                {data.pending_handovers.map(h => (
                  <tr key={h.id}>
                    <td>{h.date}</td><td>{h.handover_no}</td><td>{h.dealer_name}</td>
                    <td><Money value={h.amount} /></td><td>{h.sent_to || 'Head Office'}</td>
                    <td><button className="btn primary" onClick={() => acceptHandover(h)}>Accept & Receipt</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

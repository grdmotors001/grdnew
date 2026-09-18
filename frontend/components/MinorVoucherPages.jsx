'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);

export function OldRickshawPage() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today() });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/old-rickshaws').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm({ date: today(), vou_no: data?.suggested_vou_no || '' }); setOpen(true); };
  const save = (e) => { e.preventDefault(); run(async () => { await post('/old-rickshaws', form); setOpen(false); load(); }); };
  const remove = (id) => { if (!confirm('Delete this record?')) return; run(async () => { await del(`/old-rickshaws/${id}`); load(); }); };

  if (!data) return <div className="card">Loading…</div>;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Old Rickshaw Entry</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {data.records.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Vehicle Reg. No.</th><th>Owner</th><th>Sold Amt</th><th>Loan Amt</th><th>Received</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.vehicle_reg_no}</td><td>{r.owner_name}</td>
                  <td><Money value={r.sold_amount} /></td><td><Money value={r.loan_amount} /></td>
                  <td><Money value={r.receipt_amount} /></td><td><Money value={r.balance_amount} /></td>
                  <td><button className="btn danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>New Old Rickshaw Entry</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Vou. No." value={form.vou_no} onChange={(v) => setForm({ ...form, vou_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Party/Buyer Name" value={form.party_name} onChange={(v) => setForm({ ...form, party_name: v })} />
              <Field label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={(v) => setForm({ ...form, vehicle_reg_no: v })} required />
              <Field label="Model Name" value={form.model_name} onChange={(v) => setForm({ ...form, model_name: v })} />
              <Field label="Owner Name" value={form.owner_name} onChange={(v) => setForm({ ...form, owner_name: v })} />
              <Field label="Salesman" value={form.salesman} onChange={(v) => setForm({ ...form, salesman: v })} />
              <Field label="Sold Amount" type="number" value={form.sold_amount} onChange={(v) => setForm({ ...form, sold_amount: v })} />
              <Field label="Loan Amount" type="number" value={form.loan_amount} onChange={(v) => setForm({ ...form, loan_amount: v })} />
              <Field label="Receipt Amount" type="number" value={form.receipt_amount} onChange={(v) => setForm({ ...form, receipt_amount: v })} />
              <Field label="Receipt No." value={form.receipt_no} onChange={(v) => setForm({ ...form, receipt_no: v })} />
              <Field label="Ledger" value={form.ledger} onChange={(v) => setForm({ ...form, ledger: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function BatteryDeliveryChallanPage() {
  const [data, setData] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today(), qty: 1 });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/battery-delivery-challans').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); get('/dealers').then((d) => setDealers(d.dealers)); }, []);

  const openNew = () => { setForm({ date: today(), qty: 1, challan_no: data?.suggested_challan_no || '' }); setOpen(true); };
  const save = (e) => { e.preventDefault(); run(async () => { await post('/battery-delivery-challans', form); setOpen(false); load(); }); };
  const remove = (id) => { if (!confirm('Delete this record?')) return; run(async () => { await del(`/battery-delivery-challans/${id}`); load(); }); };

  if (!data) return <div className="card">Loading…</div>;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Battery Delivery Challan</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {data.records.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Qty</th><th></th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.challan_no}</td><td>{r.dealer_name}</td>
                  <td>{r.battery_maker}</td><td>{r.battery_no}</td><td>{r.qty}</td>
                  <td><button className="btn danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>New Battery Delivery Challan</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Challan No." value={form.challan_no} onChange={(v) => setForm({ ...form, challan_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Dealer" type="select" value={form.dealer_id}
                     options={dealers.map((d) => ({ value: d.id, label: d.name }))}
                     onChange={(v) => setForm({ ...form, dealer_id: Number(v) })} required />
              <Field label="Battery Maker" value={form.battery_maker} onChange={(v) => setForm({ ...form, battery_maker: v })} />
              <Field label="Battery No." value={form.battery_no} onChange={(v) => setForm({ ...form, battery_no: v })} />
              <Field label="Qty" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} />
              <Field label="Remarks" value={form.remarks} onChange={(v) => setForm({ ...form, remarks: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function JournalStockPage() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today(), item_type: 'R' });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/journal-stock').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm({ date: today(), item_type: 'R', vou_no: data?.suggested_vou_no || '' }); setOpen(true); };
  const save = (e) => { e.preventDefault(); run(async () => { await post('/journal-stock', form); setOpen(false); load(); }); };
  const remove = (id) => { if (!confirm('Delete this record?')) return; run(async () => { await del(`/journal-stock/${id}`); load(); }); };

  if (!data) return <div className="card">Loading…</div>;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Stock Correction</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {data.records.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Item</th><th>Type</th><th>Qty (+/-)</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.item_name}</td>
                  <td>{r.item_type === 'R' ? 'Raw Material' : 'Finished'}</td><td>{r.qty}</td><td>{r.reason}</td>
                  <td><button className="btn danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>New Stock Correction</h2>
            <ErrorBanner message={error} />
            <p className="muted" style={{ fontSize: 12 }}>Use a positive Qty to add stock, negative to remove it — for anything not covered by Purchase / Production / Delivery.</p>
            <div className="formgrid">
              <Field label="Vou. No." value={form.vou_no} onChange={(v) => setForm({ ...form, vou_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Item Name" value={form.item_name} onChange={(v) => setForm({ ...form, item_name: v })} required />
              <Field label="Item Type" type="select" value={form.item_type}
                     options={[{ value: 'R', label: 'Raw Material' }, { value: 'F', label: 'Finished' }]}
                     onChange={(v) => setForm({ ...form, item_type: v })} />
              <Field label="Qty (+/-)" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} required />
              <Field label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

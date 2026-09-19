'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Pill, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { DeliveryChallanPrintView } from './PrintDocs';

const today = () => new Date().toISOString().slice(0, 10);

export function DeliveryChallanPage() {
  const [data, setData] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [batteryMakers, setBatteryMakers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today() });
  const [printId, setPrintId] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { busy, error, setError, run } = useAsyncAction();

  // 17,000+ delivery challans exist in production -- fetch one page at a
  // time (the backend now paginates) instead of the whole table at once,
  // which used to time out / 500 the request.
  const load = (p = page, s = search) => {
    const params = new URLSearchParams({ page: p, per_page: 50 });
    if (s) params.set('search', s);
    get(`/delivery-challans?${params}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load(1, search);
    get('/dealers').then((d) => setDealers(d.dealers || []));
    get('/masters/battery-maker').then((rows) => setBatteryMakers(rows || [])).catch(() => {});
  }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const openNew = () => {
    setForm({ date: today(), challan_no: data?.suggested_challan_no || '' });
    setOpen(true);
  };

  const selectVehicle = (value) => {
    const vehicle = (data?.available_vehicles || []).find((v) => String(v.id) === String(value));
    setForm({ ...form, vehicle_id: Number(value), battery_maker: vehicle?.battery_maker || '', battery_no1: vehicle?.battery_no1 || '', battery_no2: vehicle?.battery_no2 || '', battery_no3: vehicle?.battery_no3 || '', battery_no4: vehicle?.battery_no4 || '' });
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => { await post('/delivery-challans', form); setOpen(false); load(); });
  };

  const cancelChallan = (id) => {
    if (!confirm('Toggle cancel on this Delivery Challan? Cancelling sends the chassis back to Manufacturing.')) return;
    run(async () => { await post(`/delivery-challans/${id}/cancel`); load(); });
  };

  const remove = (id) => {
    if (!confirm('Delete this Delivery Challan permanently?')) return;
    run(async () => { await del(`/delivery-challans/${id}`); load(); });
  };

  if (!data) return <div className="card">Loading…</div>;

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew} disabled={data.available_vehicles.length === 0}>
          + New Delivery Challan
        </button>
        {data.available_vehicles.length === 0 && (
          <span className="muted" style={{ alignSelf: 'center' }}>No chassis currently in Manufacturing.</span>
        )}
      </div>
      <ErrorBanner message={!open ? error : ''} />

      <form onSubmit={runSearch} className="actions" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="Search challan no. or chassis no."
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn" type="submit">Search</button>
        {search && (
          <button type="button" className="btn" onClick={() => { setSearch(''); setPage(1); load(1, ''); }}>
            Clear
          </button>
        )}
      </form>

      {data.challans.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Product</th><th>Chassis No.</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.challans.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.date)}</td><td>{c.challan_no}</td><td>{c.dealer_name}</td>
                  <td>{c.product_name}</td><td><b>{c.chassis_no}</b></td>
                  <td>
                    {c.cancelled ? <Pill text="Cancelled" /> : c.invoiced ? <Pill text={`Invoiced (${c.bill_no})`} kind="t" /> : <Pill text="Open" kind="d" />}
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => setPrintId(c.id)}>Print</button>
                    <button className="btn" onClick={() => cancelChallan(c.id)}>{c.cancelled ? 'Un-cancel' : 'Cancel'}</button>
                    <button className="btn danger" onClick={() => remove(c.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total_pages > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="btn" disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            Page {data.page} of {data.total_pages} ({data.total.toLocaleString()} total)
          </span>
          <button className="btn" disabled={page >= data.total_pages} onClick={() => goToPage(page + 1)}>Next →</button>
        </div>
      )}

      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save} style={{ maxWidth: 720 }}>
            <h2>New Delivery Challan</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Challan No." value={form.challan_no} onChange={(v) => setForm({ ...form, challan_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Dealer" type="select" value={form.dealer_id}
                     options={dealers.map((d) => ({ value: d.id, label: d.name }))}
                     onChange={(v) => setForm({ ...form, dealer_id: Number(v) })} required />
              <Field label="Chassis to Dispatch" type="select" value={form.vehicle_id}
                     options={data.available_vehicles.map((v) => ({ value: v.id, label: `${v.chassis_no} — ${v.model_name}` }))}
                     onChange={selectVehicle} required />
              <Field label="Destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} />
              <Field label="Salesman" value={form.salesman} onChange={(v) => setForm({ ...form, salesman: v })} />
              <Field label="Dealer Page No." value={form.dealer_page_no} onChange={(v) => setForm({ ...form, dealer_page_no: v })} />
              <Field label="Sale Value" type="number" value={form.sale_value} onChange={(v) => setForm({ ...form, sale_value: v })} />
              <Field label="Battery Maker" type="select" value={form.battery_maker}
                     options={[{ value: '', label: 'Select Battery Maker' }, ...batteryMakers.map((b) => ({ value: b.name, label: b.name }))]}
                     onChange={(v) => setForm({ ...form, battery_maker: v })} />
              <Field label="Battery No. 1" value={form.battery_no1} onChange={(v) => setForm({ ...form, battery_no1: v })} />
              <Field label="Battery No. 2" value={form.battery_no2} onChange={(v) => setForm({ ...form, battery_no2: v })} />
              <Field label="Battery No. 3" value={form.battery_no3} onChange={(v) => setForm({ ...form, battery_no3: v })} />
              <Field label="Battery No. 4" value={form.battery_no4} onChange={(v) => setForm({ ...form, battery_no4: v })} />
              <Field label="Remarks" value={form.remarks1} onChange={(v) => setForm({ ...form, remarks1: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
      {printId && <DeliveryChallanPrintView challanId={printId} onClose={() => setPrintId(null)} />}
    </>
  );
}

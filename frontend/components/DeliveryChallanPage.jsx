'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Pill, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { DeliveryChallanPrintView } from './PrintDocs';

const today = () => new Date().toISOString().slice(0, 10);

const ACCESSORIES = [
  ['toolkit', 'Toolkit'],
  ['jack', 'Jack'],
  ['charger', 'Charger'],
  ['center_lock', 'Center Lock'],
  ['mat', 'Mat'],
  ['stapney', 'Stapney'],
  ['front_glass', 'Front Glass'],
  ['h_lock', 'H Lock'],
];

const blankAccessories = () => ({
  toolkit: true, jack: true, charger: true, center_lock: false,
  mat: true, stapney: false, front_glass: false, h_lock: false,
});

function VehicleDetails({ vehicle }) {
  if (!vehicle) return null;
  return (
    <div className="card" style={{ margin: '0 0 12px', padding: 12, background: '#f8fafc' }}>
      <b style={{ display: 'block', marginBottom: 8 }}>Selected Vehicle Details</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
        {[
          ['Model Name', vehicle.model_name],
          ['Colour', vehicle.colour],
          ['Formula Name', vehicle.formula_name],
          ['Motor No.', vehicle.motor_no],
          ['Chassis No.', vehicle.chassis_no],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="muted" style={{ fontSize: 11 }}>{label}</div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>{value || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessoriesFields({ value, onChange }) {
  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 2 }}>
      <b style={{ display: 'block', marginBottom: 8 }}>Accessories / Fitments</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {ACCESSORIES.map(([key, label]) => (
          <Field key={key} label={label} type="checkbox" value={!!value[key]}
                 onChange={(v) => onChange({ ...value, [key]: v })} />
        ))}
      </div>
    </div>
  );
}

export function DeliveryChallanPage() {
  const [data, setData] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [batteryMakers, setBatteryMakers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState({ date: today(), ...blankAccessories() });
  const [printId, setPrintId] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { busy, error, setError, run } = useAsyncAction();

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

  const dealerById = (id) => dealers.find((d) => String(d.id) === String(id));

  const applyDealer = (value, baseForm = form) => {
    const dealer = dealerById(value);
    const destination = [dealer?.address1, dealer?.address2].filter(Boolean).join(', ');
    return {
      ...baseForm,
      dealer_id: Number(value),
      destination,
      salesman: dealer?.salesman || '',
    };
  };

  const openNew = () => {
    setEditRow(null);
    setForm({ date: today(), challan_no: data?.suggested_challan_no || '', ...blankAccessories() });
    setOpen(true);
  };

  const selectVehicle = (value, baseForm = form) => {
    const vehicle = (data?.available_vehicles || []).find((v) => String(v.id) === String(value));
    setForm({
      ...baseForm,
      vehicle_id: Number(value),
      battery_maker: vehicle?.battery_maker || '',
      battery_no1: vehicle?.battery_no1 || '',
      battery_no2: vehicle?.battery_no2 || '',
      battery_no3: vehicle?.battery_no3 || '',
      battery_no4: vehicle?.battery_no4 || '',
    });
  };

  const selectedVehicle = (data?.available_vehicles || []).find(
    (v) => String(v.id) === String(form.vehicle_id)
  );

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await post('/delivery-challans', form);
      setOpen(false);
      setPage(1);
      load(1, search);
    });
  };

  const openEdit = (row) => {
    setError('');
    setOpen(false);
    setEditRow({ ...blankAccessories(), ...row });
  };

  const saveEdit = (e) => {
    e.preventDefault();
    run(async () => {
      await put(`/delivery-challans/${editRow.id}`, editRow);
      setEditRow(null);
      load(page, search);
    });
  };

  const cancelChallan = (id) => {
    if (!confirm('Toggle cancel on this Delivery Challan? Cancelling sends the chassis back to Manufacturing.')) return;
    run(async () => { await post(`/delivery-challans/${id}/cancel`); load(page, search); });
  };

  const remove = (id) => {
    if (!confirm('Delete this Delivery Challan permanently?')) return;
    run(async () => { await del(`/delivery-challans/${id}`); load(page, search); });
  };

  if (!data) return <div className="card">Loading…</div>;

  const formVehicle = (editRow && data.available_vehicles || []).find(
    (v) => String(v.id) === String(editRow?.vehicle_id)
  );

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
      <ErrorBanner message={!open && !editRow ? error : ''} />

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
                  <td>{formatDate(c.date)}</td>
                  <td>{c.challan_no}</td>
                  <td>{c.dealer_name}</td>
                  <td>{c.product_name}</td>
                  <td><b>{c.chassis_no}</b></td>
                  <td>
                    {c.cancelled ? <Pill text="Cancelled" /> : c.invoiced ? <Pill text={`Sold (${c.bill_no})`} kind="t" /> : <Pill text="Unsold" kind="d" />}
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => openEdit(c)}>Edit</button>
                    <button className="btn" onClick={() => setPrintId(c.id)}>Preview</button>
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
          <form className="modalbox" onSubmit={save} style={{ maxWidth: 760 }}>
            <h2>New Delivery Challan</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Challan No." value={form.challan_no} onChange={(v) => setForm({ ...form, challan_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />

              <Field label="Dealer" type="select" value={form.dealer_id}
                     options={dealers.map((d) => ({ value: d.id, label: d.name }))}
                     onChange={(v) => setForm(applyDealer(v))} required />

              <Field label="Chassis to Dispatch" type="select" value={form.vehicle_id}
                     options={data.available_vehicles.map((v) => ({ value: v.id, label: v.chassis_no }))}
                     onChange={(v) => selectVehicle(v)} required />

              <Field label="Destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} />
              <Field label="Salesman" value={form.salesman} readOnly />

              <div style={{ gridColumn: '1 / -1' }}>
                <VehicleDetails vehicle={selectedVehicle} />
              </div>

              <Field label="Battery Maker" type="select" value={form.battery_maker}
                     options={batteryMakers.map((b) => ({ value: b.name, label: b.name }))}
                     onChange={(v) => setForm({ ...form, battery_maker: v })} />
              <Field label="Battery No. 1" value={form.battery_no1} onChange={(v) => setForm({ ...form, battery_no1: v })} />
              <Field label="Battery No. 2" value={form.battery_no2} onChange={(v) => setForm({ ...form, battery_no2: v })} />
              <Field label="Battery No. 3" value={form.battery_no3} onChange={(v) => setForm({ ...form, battery_no3: v })} />
              <Field label="Battery No. 4" value={form.battery_no4} onChange={(v) => setForm({ ...form, battery_no4: v })} />

              <AccessoriesFields
                value={form}
                onChange={(next) => setForm({ ...form, ...next })}
              />

              <Field label="Remarks" value={form.remarks1} onChange={(v) => setForm({ ...form, remarks1: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {editRow && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveEdit} style={{ maxWidth: 760 }}>
            <h2>Edit Delivery Challan — {editRow.challan_no}</h2>
            <ErrorBanner message={error} />
            <p className="muted" style={{ marginTop: -6 }}>
              Chassis, model, colour, formula and motor details remain linked to the original dispatch.
              Sale Value and Dealer Page No. are not entered on this form.
            </p>
            <div className="formgrid">
              <Field label="Challan No." value={editRow.challan_no} onChange={(v) => setEditRow({ ...editRow, challan_no: v })} />
              <Field label="Date" type="date" value={editRow.date} onChange={(v) => setEditRow({ ...editRow, date: v })} />
              <Field label="Dealer" value={editRow.dealer_name} readOnly />
              <Field label="Destination" value={editRow.destination} onChange={(v) => setEditRow({ ...editRow, destination: v })} />
              <Field label="Salesman" value={editRow.salesman} onChange={(v) => setEditRow({ ...editRow, salesman: v })} />
              <Field label="Chassis No." value={editRow.chassis_no} readOnly />
              <Field label="Model Name" value={editRow.product_name} readOnly />
              <Field label="Colour" value={editRow.colour} readOnly />
              <Field label="Motor No." value={editRow.motor_no} readOnly />
              <Field label="Formula Name" value={formVehicle?.formula_name} readOnly />
              <Field label="Battery Maker" type="select" value={editRow.battery_maker}
                     options={batteryMakers.map((b) => ({ value: b.name, label: b.name }))}
                     onChange={(v) => setEditRow({ ...editRow, battery_maker: v })} />
              <Field label="Battery No. 1" value={editRow.battery_no1} onChange={(v) => setEditRow({ ...editRow, battery_no1: v })} />
              <Field label="Battery No. 2" value={editRow.battery_no2} onChange={(v) => setEditRow({ ...editRow, battery_no2: v })} />
              <Field label="Battery No. 3" value={editRow.battery_no3} onChange={(v) => setEditRow({ ...editRow, battery_no3: v })} />
              <Field label="Battery No. 4" value={editRow.battery_no4} onChange={(v) => setEditRow({ ...editRow, battery_no4: v })} />
              <AccessoriesFields value={editRow} onChange={(next) => setEditRow({ ...editRow, ...next })} />
              <Field label="Remarks" value={editRow.remarks1} onChange={(v) => setEditRow({ ...editRow, remarks1: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setEditRow(null)}>Cancel</button>
              <button type="button" className="btn" onClick={() => setPrintId(editRow.id)}>Print / Preview</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {printId && <DeliveryChallanPrintView challanId={printId} onClose={() => setPrintId(null)} />}
    </>
  );
}

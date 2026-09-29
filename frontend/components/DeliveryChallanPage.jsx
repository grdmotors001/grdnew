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
    <div className="dcVeh">
      {[
        ['Model Name', vehicle.model_name],
        ['Formula Name', vehicle.formula_name],
        ['Motor No.', vehicle.motor_no],
        ['Chassis No.', vehicle.chassis_no],
      ].map(([label, value]) => (
        <div key={label}>
          <div className="muted" style={{ fontSize: 11 }}>{label}</div>
          <div style={{ fontWeight: 700, marginTop: 2, wordBreak: 'break-word' }}>{value || '—'}</div>
        </div>
      ))}
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
  const [colourMasters, setColourMasters] = useState([]);
  const [dispatchItems, setDispatchItems] = useState([]);
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
    get(`/delivery-challans?${params}`).then((d) => {
      const safe = {
        ...d,
        challans: Array.isArray(d?.challans) ? d.challans : (Array.isArray(d?.rows) ? d.rows : []),
        available_vehicles: Array.isArray(d?.available_vehicles) ? d.available_vehicles : [],
        dispatch_items: Array.isArray(d?.dispatch_items) ? d.dispatch_items : [],
        page: Number(d?.page || p), per_page: Number(d?.per_page || 50),
        total: Number(d?.total || 0), total_pages: Number(d?.total_pages || 1),
      };
      setData(safe); setDispatchItems(safe.dispatch_items);
    }).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load(1, search);
    get('/dealers').then((d) => setDealers(d.dealers || []));
    get('/masters/battery-maker').then((d) => {
      const rows = Array.isArray(d)
        ? d
        : (Array.isArray(d?.masters) ? d.masters
          : Array.isArray(d?.rows) ? d.rows
          : Array.isArray(d?.data) ? d.data
          : []);
      setBatteryMakers(rows);
    }).catch(() => setBatteryMakers([]));

    get('/masters/colour').then((d) => {
      const rows = Array.isArray(d)
        ? d
        : (Array.isArray(d?.masters) ? d.masters
          : Array.isArray(d?.rows) ? d.rows
          : Array.isArray(d?.data) ? d.data
          : []);
      setColourMasters(rows);
    }).catch(() => setColourMasters([]));
  }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const dealerById = (id) => dealers.find((d) => String(d.id) === String(id));

  // Dispatch items ke duplicate naam (jaise JACK 2 baar) ek hi dikhao (jiska stock zyada ho).
  const normName = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uniqueDispatch = (() => {
    const m = new Map();
    for (const it of dispatchItems) {
      const k = normName(it.name);
      const cur = m.get(k);
      if (!cur || Number(it.stock_qty || 0) > Number(cur.stock_qty || 0)) m.set(k, it);
    }
    return [...m.values()];
  })();
  // Accessory ka naam agar kisi Dispatch item se match kare to dono ek hi tile me jud jaate hain.
  const linkedItem = (label) => uniqueDispatch.find((i) => normName(i.name) === normName(label));
  const otherItems = uniqueDispatch.filter((i) => !ACCESSORIES.some(([, l]) => normName(l) === normName(i.name)));
  const toggleAccessory = (key, label, on) => {
    const it = linkedItem(label);
    setForm({
      ...form, [key]: on,
      ...(it ? { dispatch_selected: { ...(form.dispatch_selected || {}), [it.id]: on } } : {}),
    });
  };
  const colourMeta = (name) => {
    const rows = Array.isArray(colourMasters) ? colourMasters : [];
    return rows.find((x) =>
      String(x?.name || '').trim().toLowerCase() ===
      String(name || '').trim().toLowerCase()
    );
  };
  const colourPreview = (name) => {
    const x=colourMeta(name);
    if (!x?.color_hex) return null;
    return {background:x.is_double_tone&&x.color_hex2
      ? `linear-gradient(90deg,${x.color_hex} 0 50%,${x.color_hex2} 50% 100%)`
      : x.color_hex};
  };

  const applyDealer = (value, baseForm = form) => {
    const dealer = dealers.find((d) =>
      String(d.name || '').trim().toLowerCase() === String(value || '').trim().toLowerCase()
    );
    const destination = [dealer?.address1, dealer?.address2].filter(Boolean).join(', ');
    return {
      ...baseForm,
      dealer_name: value,
      dealer_id: dealer ? Number(dealer.id) : '',
      destination: dealer ? destination : (baseForm.destination || ''),
      salesman: dealer ? (dealer.salesman || '') : (baseForm.salesman || ''),
    };
  };

  const openNew = () => {
    setEditRow(null);
    const defaults = blankAccessories();
    const sel = {};
    ACCESSORIES.forEach(([k, l]) => {
      const it = linkedItem(l);
      if (defaults[k] && it) sel[it.id] = true;
    });
    setForm({ date: today(), challan_no: data?.suggested_challan_no || '', dispatch_selected: sel, ...defaults });
    setOpen(true);
  };

  const selectVehicle = async (value, baseForm = form) => {
    const vehicle = (data?.available_vehicles || []).find((v) => String(v.id) === String(value));
    if (!vehicle) return;
    let formulaName = '';
    try {
      const q = new URLSearchParams({ search: vehicle.chassis_no || '', page: 1, per_page: 1 });
      const pv = await get(`/production-vouchers?${q}`);
      formulaName = pv?.vouchers?.[0]?.formula_name || '';
    } catch (_) {}
    setForm({
      ...baseForm,
      vehicle_id: Number(value),
      product_name: vehicle?.model_name || '',
      chassis_no: vehicle?.chassis_no || '',
      motor_no: vehicle?.motor_no || '',
      controller_no: vehicle?.controller_no || '',
      differential_no: vehicle?.differential_no || '',
      colour: vehicle?.colour || '',
      formula_name: formulaName,
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
      await post('/delivery-challans', {
        ...form,
        dispatch_items: uniqueDispatch
          .filter((item) => !!form.dispatch_selected?.[item.id])
          .map((item) => ({ product_id: Number(item.id), qty: 1 })),
      });
      setOpen(false);
      setPage(1);
      load(1, search);
    });
  };

  const openEdit = (row) => {
    setError('');
    setOpen(false);
    setEditRow({ ...blankAccessories(), ...row, salesman: row.salesman || dealerById(row.dealer_id)?.salesman || '' });
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

  if (!data) return (
    <div className="card">
      {error ? (
        <>
          <b>Delivery Challan load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(1, search); }}>
            Retry
          </button>
        </>
      ) : 'Loading…'}
    </div>
  );

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
            <thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Product</th><th>Chassis No.</th><th>Colour</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.challans.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.date)}</td>
                  <td>{c.challan_no}</td>
                  <td>{c.dealer_name}</td>
                  <td>{c.product_name}</td>
                  <td><b>{c.chassis_no}</b></td>
                  <td><span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{width:22,height:14,borderRadius:4,border:'1px solid var(--border)',background:colourPreview(c.colour)?.background||'transparent'}} />{c.colour||'—'}</span></td>
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
          <form className="modalbox dcModal" onSubmit={save}>
            <div className="dcHead">
              <h2 style={{ margin: 0 }}>New Delivery Challan</h2>
              <span className="pill m">{form.challan_no || 'New'}</span>
            </div>
            <ErrorBanner message={error} />

            <div className="dcSec">
              <div className="dcSecTitle">Challan &amp; Dealer</div>
              <div className="dcGrid c4">
                <Field label="Challan No." value={form.challan_no} onChange={(v) => setForm({ ...form, challan_no: v })} />
                <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="Dealer" type="combo" value={form.dealer_name || dealerById(form.dealer_id)?.name || ''}
                         options={dealers.map((d) => ({ value: d.name, label: d.name }))}
                         onChange={(v) => setForm(applyDealer(v))} required />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <Field label="Destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} />
                </div>
                <Field label="Salesman" value={form.salesman} readOnly />
              </div>
            </div>

            <div className="dcSec">
              <div className="dcSecTitle">Vehicle</div>
              <div className="dcGrid c4">
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="Chassis to Dispatch" type="combo"
                         value={selectedVehicle?.chassis_no || ''}
                         options={data.available_vehicles.map((v) => ({ value: v.chassis_no, label: v.chassis_no }))}
                         onChange={(v) => {
                           const vehicle = data.available_vehicles.find((x) => String(x.chassis_no).toLowerCase() === String(v).toLowerCase());
                           if (vehicle) selectVehicle(vehicle.id);
                           else setForm({ ...form, vehicle_id: '', chassis_no: v });
                         }} required />
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 42, height: 32, borderRadius: 6, border: '1px solid var(--line)', background: colourPreview(selectedVehicle?.colour || form.colour)?.background || 'transparent' }} />
                    <input value={selectedVehicle?.colour || form.colour || ''} readOnly style={{ background: 'var(--bg)', flex: 1 }} />
                  </div>
                </div>
              </div>
              <VehicleDetails vehicle={selectedVehicle} />
            </div>

            <div className="dcSec">
              <div className="dcSecTitle">Battery</div>
              <div className="dcGrid c5">
                <Field label="Battery Maker" type="combo" value={form.battery_maker || ''}
                       options={batteryMakers.map((b) => ({ value: b.name, label: b.name }))}
                       onChange={(v) => setForm({ ...form, battery_maker: v })} />
                <Field label="Battery No. 1" value={form.battery_no1} onChange={(v) => setForm({ ...form, battery_no1: v })} />
                <Field label="Battery No. 2" value={form.battery_no2} onChange={(v) => setForm({ ...form, battery_no2: v })} />
                <Field label="Battery No. 3" value={form.battery_no3} onChange={(v) => setForm({ ...form, battery_no3: v })} />
                <Field label="Battery No. 4" value={form.battery_no4} onChange={(v) => setForm({ ...form, battery_no4: v })} />
              </div>
            </div>

            <div className="dcSec">
              <div className="dcSecTitle">Accessories / Fitments</div>
              <div className="dcTiles">
                {ACCESSORIES.map(([key, label]) => {
                  const it = linkedItem(label);
                  const stock = Number(it?.stock_qty || 0);
                  return (
                    <label key={key} className={'dcTile' + (form[key] ? ' on' : '')}>
                      <input type="checkbox" checked={!!form[key]} onChange={(e) => toggleAccessory(key, label, e.target.checked)} />
                      <span>{label}</span>
                      {it && <span className={'dcStock' + (stock > 0 ? '' : ' out')}>Stock: {stock}</span>}
                    </label>
                  );
                })}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                Tick kiya item challan par print hoga. Jin par Stock dikh raha hai wo save par stock se minus honge; stock 0 ya minus ho tab bhi minus hota rahega.
              </div>
            </div>

            {otherItems.length > 0 && (
              <div className="dcSec">
                <div className="dcSecTitle">Other Dispatch Items</div>
                <div className="dcTiles">
                  {otherItems.map((item) => {
                    const checked = !!form.dispatch_selected?.[item.id];
                    const stock = Number(item.stock_qty || 0);
                    return (
                      <label key={item.id} className={'dcTile' + (checked ? ' on' : '')}>
                        <input type="checkbox" checked={checked}
                          onChange={(e) => setForm({ ...form, dispatch_selected: { ...(form.dispatch_selected || {}), [item.id]: e.target.checked } })} />
                        <span>{item.name}</span>
                        <span className={'dcStock' + (stock > 0 ? '' : ' out')}>Stock: {stock}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Checked items save par stock se minus honge (stock minus me bhi count badhega).</div>
              </div>
            )}

            <Field label="Remarks" value={form.remarks1} onChange={(v) => setForm({ ...form, remarks1: v })} />

            <div className="dcFooter">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {editRow && (
        <div className="modal">
          <form className="modalbox dcModal" onSubmit={saveEdit}>
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
              <div className="field"><label>Colour</label><div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:42,height:28,borderRadius:6,border:'1px solid var(--border)',background:colourPreview(editRow.colour)?.background||'transparent'}} />
                <input value={editRow.colour||''} readOnly style={{background:'var(--surface-2)',flex:1}} />
              </div></div>
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

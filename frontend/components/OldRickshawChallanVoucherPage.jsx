'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner, Field, EmptyState } from './ui';
import { formatDate } from '../lib/date';

// Old Rickshaw Challan Voucher (Factory).
// GRD Old Rickshaw Inventory ki "Available for Sale" gaadi se, Dealer ke naam voucher banta hai.
// Voucher banne ke baad hi gaadi dealer ke Old Rickshaw stock me dikhti hai.
// Stock lena-dena (ledger) abhi nahi - sirf form.
const today = () => new Date().toISOString().slice(0, 10);
const YN = [{ value: 'NO', label: 'No' }, { value: 'YES', label: 'Yes' }];
const blank = () => ({
  date: today(), challan_no: '', dealer_id: '', salesman: '', ledger_date: today(), inventory_id: '',
  chassis_no: '', battery_name: '', charger: '',
  mat: 'NO', jack: 'NO', centre_lock: 'NO', big_mirror: 'NO', colour: 'NO', toolkit: 'NO', stepney: 'NO'
});

export function OldRickshawChallanVoucherPage() {
  const [data, setData] = useState({ challans: [], available_for_sale: [], dealers: [] });
  const [form, setForm] = useState(blank());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  const load = async () => {
    try { setError(''); setData(await get('/factory/old-rickshaw-challans')); }
    catch (e) { setError(e.message || 'Could not load Old Rickshaw vouchers.'); }
  };
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm(x => ({ ...x, [k]: v }));
  const dealers = data.dealers || [];
  const dealerOf = id => dealers.find(d => String(d.id) === String(id));

  const vehicleOptions = useMemo(() => [
    { value: '', label: 'Select Available for Sale vehicle' },
    ...(data.available_for_sale || []).map(v => ({
      value: String(v.id),
      label: [v.vehicle_no, v.model_name, v.sp_no ? 'SP ' + v.sp_no : ''].filter(Boolean).join(' · ')
    }))
  ], [data.available_for_sale]);
  const dealerOptions = useMemo(() => [
    { value: '', label: 'Select Dealer' },
    ...dealers.map(d => ({ value: String(d.id), label: d.name + (d.code ? ' (' + d.code + ')' : '') }))
  ], [dealers]);

  const pickVehicle = id => {
    const v = (data.available_for_sale || []).find(x => String(x.id) === String(id));
    const did = v?.dealer_id ? String(v.dealer_id) : '';
    setForm(x => ({
      ...x, inventory_id: id, dealer_id: did || x.dealer_id,
      salesman: x.salesman || dealerOf(did)?.salesman || '',
      battery_name: x.battery_name || v?.battery_maker || ''
    }));
  };
  const pickDealer = id => setForm(x => ({ ...x, dealer_id: id, salesman: dealerOf(id)?.salesman || x.salesman }));

  const openForm = () => { setForm(blank()); setError(''); setNotice(''); setOpen(true); };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await post('/factory/old-rickshaw-challans', form);
      setOpen(false);
      setNotice('Voucher ban gaya: ' + (r?.row?.challan_no || '') + '. Gaadi ab dealer ke Old Rickshaw stock me dikhegi.');
      await load();
    } catch (err) { setError(err.message || 'Could not create voucher.'); }
    finally { setBusy(false); }
  };

  const vehicles = data.available_for_sale || [];
  const rows = data.challans || [];

  return <div className="page">
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Old Rickshaw Challan Voucher</h2>
          <div className="muted">Available for Sale gaadi ka voucher Dealer ke naam banao. Voucher ke baad hi gaadi dealer ke stock me dikhegi.</div>
        </div>
        <div className="actions">
          <span className="muted">Voucher pending: <b>{vehicles.length}</b></span>
          <button className="btn primary" onClick={openForm} disabled={!vehicles.length}>+ New Voucher</button>
        </div>
      </div>
    </div>
    {!open && <ErrorBanner message={error} />}
    {notice && <div className="muted" style={{ margin: '0 0 10px', fontWeight: 700, color: '#15803d' }}>{notice}</div>}
    {!vehicles.length && <div className="muted" style={{ margin: '0 0 10px' }}>Voucher ke liye koi Available for Sale gaadi nahi hai (Inventory me pehle Available for Sale karein).</div>}

    {!rows.length ? <EmptyState text="Abhi koi Old Rickshaw Challan Voucher nahi bana." /> :
      <div className="card"><div className="tablewrap"><table className="table">
        <thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Salesman</th><th>Vehicle No.</th><th>Chassis</th><th>Battery</th><th>Charger</th><th>Ledger Date</th><th>Status</th></tr></thead>
        <tbody>{rows.map(c => <tr key={c.id}>
          <td>{formatDate(c.date)}</td><td><b>{c.challan_no}</b></td><td>{c.dealer_name || '—'}</td><td>{c.salesman || '—'}</td>
          <td>{c.vehicle_no || '—'}</td><td>{c.chassis_no || '—'}</td><td>{c.battery_name || '—'}</td><td>{c.charger || '—'}</td>
          <td>{c.ledger_date ? formatDate(c.ledger_date) : '—'}</td><td>{c.status}</td>
        </tr>)}</tbody>
      </table></div></div>}

    {open && <div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>Old Rickshaw Challan Voucher</h2><ErrorBanner message={error} />
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v => setF('date', v)} required />
        <Field label="Challan No. (khali = auto)" value={form.challan_no} onChange={v => setF('challan_no', v)} />
        <Field label="Vehicle (Available for Sale)" type="select" value={form.inventory_id} options={vehicleOptions} onChange={pickVehicle} required />
        <Field label="Dealer" type="select" value={form.dealer_id} options={dealerOptions} onChange={pickDealer} required />
        <Field label="Sales Man" value={form.salesman} onChange={v => setF('salesman', v)} />
        <Field label="Ledger Date" type="date" value={form.ledger_date} onChange={v => setF('ledger_date', v)} />
        <Field label="Chassis" value={form.chassis_no} onChange={v => setF('chassis_no', v)} />
        <Field label="Battery Name" value={form.battery_name} onChange={v => setF('battery_name', v)} />
        <Field label="Charger (Name / No.)" value={form.charger} onChange={v => setF('charger', v)} />
        <Field label="Mat" type="select" value={form.mat} options={YN} onChange={v => setF('mat', v)} />
        <Field label="Jack" type="select" value={form.jack} options={YN} onChange={v => setF('jack', v)} />
        <Field label="Centre Lock" type="select" value={form.centre_lock} options={YN} onChange={v => setF('centre_lock', v)} />
        <Field label="Big Mirror" type="select" value={form.big_mirror} options={YN} onChange={v => setF('big_mirror', v)} />
        <Field label="Colour" type="select" value={form.colour} options={YN} onChange={v => setF('colour', v)} />
        <Field label="Toolkit" type="select" value={form.toolkit} options={YN} onChange={v => setF('toolkit', v)} />
        <Field label="Stepney" type="select" value={form.stepney} options={YN} onChange={v => setF('stepney', v)} />
      </div>
      <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" disabled={busy || !form.inventory_id || !form.dealer_id}>{busy ? 'Saving…' : 'Save Voucher'}</button>
      </div>
    </form></div>}
  </div>;
}

'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { EmptyState, ErrorBanner, Field } from './ui';
import { formatDate } from '../lib/date';

export function ChallanShiftPage() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dealerId, setDealerId] = useState('');
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (q = search) => {
    try {
      setError('');
      const qs = q ? '?search=' + encodeURIComponent(q) : '';
      setData(await get('/challan-shift' + qs));
    } catch (e) {
      setError(e.message || 'Challan Shift load failed.');
    }
  };

  useEffect(() => { load(''); }, []);

  const openShift = (row) => {
    setSelected(row);
    setDealerId('');
    setShiftDate(new Date().toISOString().slice(0, 10));
    setRemark('');
    setError('');
  };

  const confirmShift = async (e) => {
    e.preventDefault();
    if (!selected) return;
    if (!dealerId) { setError('Please select the dealer to shift to.'); return; }
    if (!remark.trim()) { setError('Shift Remark is required. Please enter a remark.'); return; }
    setError('');
    setBusy(true);
    try {
      await post('/challan-shift', {
        challan_id: selected.id,
        to_dealer_id: Number(dealerId),
        shift_date: shiftDate,
        remark: remark.trim(),
      });
      setSelected(null);
      await load(search);
    } catch (e) {
      setError(e.message || 'Dealer shift failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="card">{error || 'Loading…'}</div>;

  const dealers = (data.dealers || []).filter((d) => String(d.id) !== String(selected?.dealer_id));

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Challan Shift</h2>
            <div className="muted" style={{ marginTop: 4 }}>
              Bill generate hone se pehle Delivery Challan ko ek dealer se doosre dealer ko shift karein.
            </div>
          </div>
          <div className="pill m">Bill Pending Only</div>
        </div>
      </div>

      <ErrorBanner message={selected ? '' : error} />

      <form className="actions" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); load(search); }}>
        <input className="input" placeholder="Search challan / chassis / dealer"
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 330 }} />
        <button className="btn" type="submit">Search</button>
        {search && <button className="btn" type="button" onClick={() => { setSearch(''); load(''); }}>Clear</button>}
      </form>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
          <b>Challans Eligible for Dealer Shift</b>
          <span className="muted" style={{ marginLeft: 8 }}>Only non-cancelled, non-billed challans</span>
        </div>
        {(data.challans || []).length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Challan No.</th><th>Current Dealer</th><th>Model</th>
                  <th>Chassis No.</th><th>Battery</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(data.challans || []).map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.date)}</td>
                    <td><b>{c.challan_no}</b></td>
                    <td>{c.dealer_name || '—'}</td>
                    <td>{c.product_name || c.model_name || '—'}</td>
                    <td><b>{c.chassis_no || '—'}</b></td>
                    <td>{[c.battery_maker, c.battery_no1, c.battery_no2, c.battery_no3, c.battery_no4].filter(Boolean).join(' / ') || 'Not Fitted'}</td>
                    <td><button className="btn primary" type="button" onClick={() => openShift(c)}>Shift Dealer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><b>Challan Shift Register</b></div>
        {(data.shifts || []).length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Shift Date</th><th>Challan</th><th>Chassis No.</th><th>Model</th><th>Shift From</th><th>Shift To</th><th>Remark</th><th>By</th></tr></thead>
              <tbody>
                {(data.shifts || []).map((s) => (
                  <tr key={s.id}>
                    <td>{formatDate(s.shift_date)}</td>
                    <td><b>{s.challan_no}</b><div className="muted" style={{ fontSize: 11 }}>{s.shift_ref || ''}</div></td>
                    <td>{s.chassis_no || '—'}</td>
                    <td>{s.model_name || '—'}</td>
                    <td>{s.shift_from_dealer_name || '—'}</td>
                    <td>{s.shift_to_dealer_name || '—'}</td>
                    <td>{s.remark || '—'}</td>
                    <td>{s.shifted_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <form className="modalbox" onSubmit={confirmShift}>
            <h2>Shift Dealer — {selected.challan_no}</h2>
            <div className="muted" style={{ marginBottom: 14 }}>
              Challan number same rahega. Sirf current dealer change hoga.
            </div>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Challan No." value={selected.challan_no || '—'} readOnly />
              <Field label="Chassis No." value={selected.chassis_no || '—'} readOnly />
              <Field label="Model" value={selected.product_name || selected.model_name || '—'} readOnly />
              <Field label="Current Dealer" value={selected.dealer_name || '—'} readOnly />
              <Field label="Shift To Dealer *" type="select" value={dealerId}
                options={dealers.map((d) => ({ value: String(d.id), label: d.name }))}
                onChange={setDealerId} />
              <Field label="Shift Date" type="date" value={shiftDate} onChange={setShiftDate} required />
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Remark * (required)" value={remark} onChange={setRemark} />
              </div>
            </div>
            <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setSelected(null)}>Cancel</button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Shifting…' : 'Confirm Shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

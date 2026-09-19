'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post, downloadExcel } from '../lib/api';
import { EmptyState, ErrorBanner, Field, Money } from './ui';
import { formatDate } from '../lib/date';

export function IncentiveRegisterPage() {
  const [dealers, setDealers] = useState([]);
  const [dealerId, setDealerId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState('cash');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async (resetSelection = true) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: 1, per_page: 100 });
      if (dealerId) params.set('dealer_id', dealerId);
      if (search) params.set('search', search);
      const [d, rows] = await Promise.all([
        dealers.length ? Promise.resolve(dealers) : get('/dealers').then(x => x.dealers || []),
        get('/expense-payment-voucher/incentive-pending?' + params.toString()),
      ]);
      if (!dealers.length) setDealers(d);
      setData(rows);
      if (resetSelection) setSelected([]);
    } catch (e) {
      setError(e.message || 'Could not load incentive register');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dealerId, search]);

  const selectedRows = useMemo(
    () => (data?.rows || []).filter(r => selected.includes(r.vehicle_id)),
    [data, selected]
  );

  const allVisibleSelected = (data?.rows || []).length > 0 &&
    (data?.rows || []).every(r => selected.includes(r.vehicle_id));

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const toggleAll = () => {
    const ids = (data?.rows || []).map(r => r.vehicle_id);
    setSelected(allVisibleSelected ? [] : ids);
  };

  const save = async () => {
    setError('');
    setMsg('');
    if (!selected.length) return setError('Select at least one rickshaw.');
    if (!amount || Number(amount) <= 0) return setError('Enter incentive amount per rickshaw.');
    const dealer = dealers.find(d => String(d.id) === String(dealerId));
    if (!dealer) return setError('Select a dealer first.');

    setSaving(true);
    try {
      const res = await post('/expense-payment-voucher', {
        date,
        pay_to_type: 'dealer',
        pay_to_name: dealer.name,
        dealer_id: Number(dealer.id),
        expense_type: 'incentive',
        vehicle_ids: selected,
        payment_mode: paymentMode,
        amount: Number(amount),
        remarks,
      });
      setMsg(`${res.count || res.vouchers?.length || selected.length} incentive voucher(s) created. Each rickshaw has its own voucher number.`);
      setSelected([]);
      await load(false);
    } catch (e) {
      setError(e.message || 'Could not create incentive vouchers');
    } finally {
      setSaving(false);
    }
  };

  const exportRows = () => {
    const params = new URLSearchParams();
    if (dealerId) params.set('dealer_id', dealerId);
    if (search) params.set('search', search);
    params.set('export','csv');
    downloadExcel('/expense-payment-voucher/incentive-pending?' + params.toString(), 'Incentive_Pending_Register.xlsx');
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Incentive Register</h1>
          <p className="muted">Only unpaid / pending incentive rickshaws are shown here.</p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <Field label="Dealer" type="select" value={dealerId}
            options={[{ value: '', label: 'All Dealers' }, ...dealers.map(d => ({ value: d.id, label: `${d.code ? d.code + ' — ' : ''}${d.name}` }))]}
            onChange={v => setDealerId(v)} />
          <Field label="Search" value={search} onChange={setSearch}
            placeholder="Chassis / Customer / Bill No." />
          <Field label="Payment Date" type="date" value={date} onChange={setDate} />
          <Field label="Payment Mode" type="select" value={paymentMode}
            options={['cash','bank','upi','cheque'].map(v => ({ value: v, label: v.toUpperCase() }))} onChange={setPaymentMode} />
          <Field label="Incentive / Rickshaw" type="number" value={amount} onChange={setAmount}
            placeholder="Amount per rickshaw" />
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={exportRows}>Export Excel</button>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={toggleAll} disabled={!data?.rows?.length}>
            {allVisibleSelected ? 'Unselect All' : 'Select All'}
          </button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            Selected: <b>{selected.length}</b> | Total incentive: <b><Money value={(Number(amount) || 0) * selected.length} /></b>
          </span>
          <button className="btn primary" onClick={save} disabled={saving || !selected.length}>
            {saving ? 'Saving…' : `Create Incentive Voucher${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}

      {loading && !data ? <div className="card">Loading…</div> : !data || data.rows.length === 0 ? (
        <EmptyState text={dealerId ? 'No unpaid incentive found for this dealer.' : 'No unpaid incentive found.'} />
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
                  <th>Date</th><th>Dealer</th><th>Model</th><th>Chassis No.</th>
                  <th>Customer</th><th>Mobile No.</th><th>Bill No.</th><th>Value Amt.</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.vehicle_id} onClick={() => toggle(r.vehicle_id)} style={{ cursor: 'pointer' }}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={() => toggle(r.vehicle_id)} />
                    </td>
                    <td>{formatDate(r.date)}</td><td>{r.dealer_name}</td><td>{r.model}</td>
                    <td><b>{r.chassis_no}</b></td><td>{r.customer || '—'}</td><td>{r.mobile_no || '—'}</td>
                    <td>{r.bill_no || '—'}</td><td><Money value={r.value_amt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total_pages > 1 && (
            <div className="actions" style={{ marginTop: 12, justifyContent: 'center' }}>
              <span className="muted">Page {data.page} of {data.total_pages} ({data.total.toLocaleString()} unpaid)</span>
            </div>
          )}
        </>
      )}

      {selectedRows.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Selected Rickshaws</b>
          <div className="muted" style={{ marginTop: 6 }}>
            {selectedRows.map(r => r.chassis_no).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}

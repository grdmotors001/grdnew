'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { EmptyState, ErrorBanner, Field } from './ui';
import { formatDate } from '../lib/date';

export function ClosingStockPremisesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setError('');
    get('/stock/closing-premises').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading…</div>;
  const q = search.trim().toLowerCase();
  const vehicles = data.vehicles.filter((v) => [v.date, v.chassis_no, v.model_name, v.motor_no, v.colour].join(' ').toLowerCase().includes(q));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}><b>Summary by Model / Colour</b><input className="input" placeholder="Search model, colour, chassis…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
        <div className="tablewrap stockTable" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th>Model</th><th>Colour</th><th>Qty</th></tr></thead>
            <tbody>{data.summary.map((s, i) => <tr key={i}><td data-label="Model">{s.model_name}</td><td data-label="Colour">{s.colour}</td><td data-label="Qty">{s.qty}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {vehicles.length === 0 ? <EmptyState text={search ? 'No stock matches your search.' : 'No stock at Premises.'} /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Date</th><th>Chassis No.</th><th>Model</th><th>Motor No.</th><th>Colour</th></tr></thead>
            <tbody>{vehicles.map((v) => <tr key={v.id}><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Motor No.">{v.motor_no}</td><td data-label="Colour">{v.colour}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ClosingStockDealersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setError('');
    get('/stock/closing-dealers').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading…</div>;
  const q = search.trim().toLowerCase();
  const vehicles = data.vehicles.filter((v) => [v.date, v.chassis_no, v.model_name, v.dealer_name].join(' ').toLowerCase().includes(q));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}><b>Summary by Dealer / Model</b><input className="input" placeholder="Search dealer, model, chassis…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
        <div className="tablewrap stockTable" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th>Dealer</th><th>Model</th><th>Qty</th></tr></thead>
            <tbody>{data.summary.map((s, i) => <tr key={i}><td data-label="Dealer">{s.dealer_name}</td><td data-label="Model">{s.model_name}</td><td data-label="Qty">{s.qty}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {vehicles.length === 0 ? <EmptyState text={search ? 'No stock matches your search.' : 'No stock with dealers.'} /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Date</th><th>Chassis No.</th><th>Model</th><th>Dealer</th></tr></thead>
            <tbody>{vehicles.map((v) => <tr key={v.id}><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Dealer">{v.dealer_name}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ClosingStockRawPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState(null); // item name currently drilled into

  useEffect(() => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    setRows(null);
    get(`/stock/closing-raw?${q}`).then(setRows).catch((e) => setError(e.message));
  }, [from, to]);

  return (
    <>
      <DateFilterBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <ErrorBanner message={error} />
      {!rows ? <div className="card">Loading…</div> : (rows.rows || rows.events || rows).length === 0 ? <EmptyState /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Item</th><th>HSN</th><th>Opening</th><th>Purchased</th><th>Consumed</th><th>Closing</th></tr></thead>
            <tbody>
              {(rows.rows || rows.events || rows).map((r, i) => (
                <tr key={i} onClick={() => setDetailItem(r.name)} style={{ cursor: 'pointer' }} title="Click for item ledger">
                  <td data-label="Item">{r.name}</td><td data-label="HSN">{r.hsn}</td><td data-label="Opening">{r.opening ?? 0}</td><td data-label="Purchased">{r.purchased}</td><td data-label="Consumed">{r.consumed}</td>
                  <td data-label="Closing"><b>{r.closing}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailItem && (
        <RawItemLedgerModal itemName={detailItem} defaultFrom={from} defaultTo={to} onClose={() => setDetailItem(null)} />
      )}
    </>
  );
}

function RawItemLedgerModal({ itemName, defaultFrom, defaultTo, onClose }) {
  const [from, setFrom] = useState(defaultFrom || '');
  const [to, setTo] = useState(defaultTo || '');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ item_name: itemName, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    setRows(null);
    get(`/stock/ledger-raw?${q}`).then((d) => setRows(d)).catch((e) => setError(e.message));
  }, [itemName, from, to]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalbox" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Stock Ledger — {itemName}</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="subtitle" style={{ marginBottom: 12 }}>
          {from || to ? `${from || '…'} to ${to || '…'}` : 'All dates'}
        </div>
        <DateFilterBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ErrorBanner message={error} />
        {!rows ? <div className="card">Loading…</div> : (rows.events || []).length === 0 ? <EmptyState text="No movements for this item in the selected period." /> : (
          <div className="tablewrap stockTable">
            <table className="table">
              <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Party / Ref</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
              <tbody>
                {(rows.events || rows).map((e, i) => (
                  <tr key={i}>
                    <td data-label="Date">{formatDate(e.date)}</td><td data-label="Type">{e.type}</td><td data-label="Doc No.">{e.doc_no}</td><td data-label="Party / Ref">{e.party_name}</td>
                    <td data-label="Particulars">{e.particulars}</td><td data-label="Qty">{e.type === 'IN' ? '+' : '-'}{e.qty}</td><td data-label="Balance">{e.balance}</td>
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

function DateFilterBar({ from, to, setFrom, setTo }) {
  return (
    <div className="toolbar">
      <Field label="From" type="date" value={from} onChange={setFrom} />
      <Field label="To" type="date" value={to} onChange={setTo} />
    </div>
  );
}

export function StockLedgerPremisesPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    get(`/stock/ledger-premises?${q}`).then((d) => setRows(d)).catch((e) => setError(e.message));
  }, [from, to]);

  return (
    <>
      <DateFilterBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <ErrorBanner message={error} />
      {!rows ? <div className="card">Loading…</div> : (rows.events || []).length === 0 ? <EmptyState /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Chassis No.</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
            <tbody>
              {(rows.events || rows).map((e, i) => (
                <tr key={i}>
                  <td data-label="Date">{formatDate(e.date)}</td><td data-label="Type">{e.type}</td><td data-label="Doc No.">{e.doc_no}</td><td data-label="Chassis No.">{e.chassis_no}</td>
                  <td data-label="Particulars">{e.particulars}</td><td data-label="Qty">{e.type === 'IN' ? '+' : '-'}{e.qty}</td><td data-label="Balance">{e.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function StockLedgerDealersPage() {
  const [dealers, setDealers] = useState([]);
  const [dealerId, setDealerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dealers').then((d) => setDealers(d.dealers || [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const q = new URLSearchParams({ ...(dealerId ? { dealer_id: dealerId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    get(`/stock/ledger-dealers?${q}`).then((d) => setRows(d)).catch((e) => setError(e.message));
  }, [dealerId, from, to]);

  return (
    <>
      <div className="toolbar">
        <Field label="Dealer" type="select" value={dealerId} options={dealers.map((d) => ({ value: d.id, label: d.name }))} onChange={setDealerId} />
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
      </div>
      <ErrorBanner message={error} />
      {!rows ? <div className="card">Loading…</div> : (rows.events || rows || []).length === 0 ? <EmptyState /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Chassis No.</th><th>Dealer</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
            <tbody>
              {(rows.events || rows).map((e, i) => (
                <tr key={i}>
                  <td data-label="Date">{formatDate(e.date)}</td><td data-label="Type">{e.type}</td><td data-label="Doc No.">{e.doc_no}</td><td data-label="Chassis No.">{e.chassis_no}</td>
                  <td data-label="Dealer">{e.dealer_name}</td><td data-label="Particulars">{e.particulars}</td><td data-label="Qty">{e.type === 'IN' ? '+' : '-'}{e.qty}</td><td data-label="Balance">{e.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

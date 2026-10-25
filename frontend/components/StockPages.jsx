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
  const vehicles = (data.vehicles || []).filter((v) => [v.date, v.chassis_no, v.model_name, v.motor_no, v.colour].join(' ').toLowerCase().includes(q));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}><b>Summary by Model / Colour</b><input className="input" placeholder="Search model, colour, chassis…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
        <div className="tablewrap stockTable" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th>Model</th><th>Colour</th><th>Qty</th></tr></thead>
            <tbody>{(data.summary || []).map((s, i) => <tr key={i}><td data-label="Model">{s.model_name}</td><td data-label="Colour">{s.colour}</td><td data-label="Qty">{s.qty}</td></tr>)}</tbody>
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

const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function ClosingStockDealersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detailDealer, setDetailDealer] = useState(null); // dealer name jiske detail khule hain
  useEffect(() => {
    setError('');
    get('/stock/closing-dealers').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading…</div>;
  const q = search.trim().toLowerCase();
  const vehicles = data.vehicles || [];
  // Search: dealer, model, chassis, challan no, salesman - kisi se bhi summary filter hoti hai.
  const matchDealers = new Set(
    vehicles
      .filter((v) => !q || [v.dealer_name, v.model_name, v.chassis_no, v.challan_no, v.salesman, v.battery_maker].join(' ').toLowerCase().includes(q))
      .map((v) => String(v.dealer_name || '')),
  );
  const summary = (data.summary || []).filter((s) => !q || matchDealers.has(String(s.dealer_name || '')) || [s.dealer_name, s.model_name].join(' ').toLowerCase().includes(q));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}><b>Summary by Dealer / Model</b><input className="input" placeholder="Search dealer, model, chassis…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
        {summary.length === 0 ? <EmptyState text={search ? 'No stock matches your search.' : 'No stock with dealers.'} /> : (
          <div className="tablewrap stockTable" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Dealer</th><th>Model</th><th>Qty</th></tr></thead>
              <tbody>{summary.map((s, i) => (
                <tr key={i} onClick={() => setDetailDealer(s.dealer_name)} style={{ cursor: 'pointer' }} title="Click for dealer stock detail">
                  <td data-label="Dealer">{s.dealer_name}</td><td data-label="Model">{s.model_name || '—'}</td><td data-label="Qty">{s.qty}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {detailDealer && (
        <DealerStockDetailModal
          dealerName={detailDealer}
          vehicles={vehicles.filter((v) => String(v.dealer_name || '') === String(detailDealer))}
          onClose={() => setDetailDealer(null)}
        />
      )}
    </>
  );
}

function DealerStockDetailModal({ dealerName, vehicles, onClose }) {
  const salesman = [...new Set(vehicles.map((v) => String(v.salesman || '').trim()).filter(Boolean))].join(', ') || '—';
  const today = formatDate(new Date().toISOString().slice(0, 10));
  const cols = ['Sr.', 'Challan No.', 'Date', 'Model', 'Chassis No.', 'Battery Make'];
  const rowsOf = () => vehicles.map((v, i) => [i + 1, v.challan_no || '', formatDate(v.date), v.model_name || '', v.chassis_no || '', v.battery_maker || '']);

  const doPrint = () => {
    const body = rowsOf().map((r) => '<tr>' + r.map((c) => `<td>${escHtml(c)}</td>`).join('') + '</tr>').join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Stock with Dealer - ${escHtml(dealerName)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:16px}h2{margin:0 0 6px}.meta{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:5px 7px;text-align:left}th{background:#eee}tfoot td{font-weight:700}</style></head><body><h2>G.R.D. MOTORS — Closing Stock with Dealer</h2><div class="meta"><b>Dealer:</b> ${escHtml(dealerName)}</div><div class="meta"><b>Salesman:</b> ${escHtml(salesman)}</div><div class="meta"><b>Date:</b> ${escHtml(today)} &nbsp;·&nbsp; <b>Total Qty:</b> ${vehicles.length}</div><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="${cols.length}">Total Qty: ${vehicles.length}</td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };

  const doExport = async () => {
    const XLSX = await import('xlsx');
    const aoa = [
      ['G.R.D. MOTORS — Closing Stock with Dealer'],
      ['Dealer', dealerName],
      ['Salesman', salesman],
      ['Date', today],
      ['Total Qty', vehicles.length],
      [],
      cols,
      ...rowsOf(),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 12 }, { wch: 26 }, { wch: 24 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dealer Stock');
    const safe = String(dealerName).replace(/[^\w\-]+/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `Closing_Stock_${safe}.xlsx`);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalbox" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{dealerName}</h2>
            <div className="subtitle">Salesman: <b>{salesman}</b> · Total Qty: <b>{vehicles.length}</b></div>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={doPrint}>Print</button>
            <button type="button" className="btn" onClick={doExport}>Export Excel</button>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
        {vehicles.length === 0 ? <EmptyState text="No stock with this dealer." /> : (
          <div className="tablewrap stockTable">
            <table className="table">
              <thead><tr><th>Challan No.</th><th>Date</th><th>Model</th><th>Chassis No.</th><th>Battery Make</th></tr></thead>
              <tbody>{vehicles.map((v) => (
                <tr key={v.id}>
                  <td data-label="Challan No.">{v.challan_no || '—'}</td>
                  <td data-label="Date">{formatDate(v.date)}</td>
                  <td data-label="Model">{v.model_name || '—'}</td>
                  <td data-label="Chassis No."><b>{v.chassis_no}</b></td>
                  <td data-label="Battery Make">{v.battery_maker || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ClosingStockRawPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState(null); // item name currently drilled into
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    setRows(null);
    get(`/stock/closing-raw?${q}`).then(setRows).catch((e) => setError(e.message));
  }, [from, to]);

  const sq = search.trim().toLowerCase();
  const allRows = rows ? (rows.rows || rows.events || rows).filter((r) => !sq || [r.name, r.hsn, r.code].join(' ').toLowerCase().includes(sq)) : [];

  return (
    <>
      <div className="toolbar">
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <Field label="Search (item / HSN)" value={search} onChange={setSearch} />
      </div>
      <ErrorBanner message={error} />
      {!rows ? <div className="card">Loading…</div> : allRows.length === 0 ? <EmptyState text={search ? 'No item matches your search.' : undefined} /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Item</th><th>HSN</th><th>Opening</th><th>Purchased</th><th>Consumed</th><th>Closing</th></tr></thead>
            <tbody>
              {allRows.map((r, i) => (
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
              <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Chassis No.</th><th>Model</th><th>Party / Ref</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
              <tbody>
                {(rows.events || rows).map((e, i) => (
                  <tr key={i}>
                    <td data-label="Date">{formatDate(e.date)}</td><td data-label="Type">{e.type}</td><td data-label="Doc No.">{e.doc_no}</td><td data-label="Chassis No.">{e.chassis_no||'—'}</td><td data-label="Model">{e.model_name||'—'}</td><td data-label="Party / Ref">{e.party_name}</td>
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
            <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Chassis No.</th><th>Model</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
            <tbody>
              {(rows.events || rows).map((e, i) => (
                <tr key={i}>
                  <td data-label="Date">{formatDate(e.date)}</td><td data-label="Type">{e.type}</td><td data-label="Doc No.">{e.doc_no}</td><td data-label="Chassis No.">{e.chassis_no}</td>
                  <td data-label="Model">{e.model_name||'—'}</td><td data-label="Particulars">{e.particulars}</td><td data-label="Qty">{e.type === 'IN' ? '+' : '-'}{e.qty}</td><td data-label="Balance">{e.balance}</td>
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
      {!rows ? <div className="card">Loading…</div> : (Array.isArray(rows) ? rows : (rows.events || rows.rows || [])).length === 0 ? <EmptyState /> : (
        <div className="tablewrap stockTable">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Doc No.</th><th>Chassis No.</th><th>Dealer</th><th>Particulars</th><th>Qty</th><th>Balance</th></tr></thead>
            <tbody>
              {(Array.isArray(rows) ? rows : (rows.events || rows.rows || [])).map((e, i) => (
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


export function ClosingStockBatteryDealersPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detailDealer, setDetailDealer] = useState(null);
  const load = () => { setError(''); get('/stock/closing-dealers-battery', { noClientCache: true }).then(setData).catch((e) => setError(e.message)); };
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading…</div>;
  const q = search.trim().toLowerCase();
  const batteries = data.batteries || [];
  const matchDealers = new Set(
    batteries
      .filter((b) => !q || [b.dealer_name, b.battery_maker, b.battery_no, b.reference_no, b.salesman].join(' ').toLowerCase().includes(q))
      .map((b) => String(b.dealer_name || '')),
  );
  const summary = (data.summary || []).filter((s) => !q || matchDealers.has(String(s.dealer_name || '')) || [s.dealer_name, s.battery_maker].join(' ').toLowerCase().includes(q));
  const totalQty = summary.reduce((n, s) => n + Number(s.qty || 0), 0);
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <b>Battery Stock with Dealers — Summary by Dealer / Battery Maker</b>
          <div className="actions">
            <input className="input" placeholder="Search dealer, maker, battery no…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
            <button type="button" className="btn" onClick={load}>↻ Refresh</button>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><span className="pill d">Total Battery {totalQty}</span></div>
        {summary.length === 0 ? <EmptyState text={search ? 'No battery stock matches your search.' : 'No battery stock with dealers.'} /> : (
          <div className="tablewrap stockTable" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Dealer</th><th>Battery Maker</th><th>Qty</th></tr></thead>
              <tbody>{summary.map((s, i) => (
                <tr key={i} onClick={() => setDetailDealer(s.dealer_name)} style={{ cursor: 'pointer' }} title="Click for dealer battery detail">
                  <td data-label="Dealer">{s.dealer_name}</td><td data-label="Battery Maker">{s.battery_maker || '—'}</td><td data-label="Qty">{s.qty}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {detailDealer && (
        <DealerBatteryDetailModal
          dealerName={detailDealer}
          batteries={batteries.filter((b) => String(b.dealer_name || '') === String(detailDealer))}
          onClose={() => setDetailDealer(null)}
        />
      )}
    </>
  );
}

function DealerBatteryDetailModal({ dealerName, batteries, onClose }) {
  const today = formatDate(new Date().toISOString().slice(0, 10));
  const cols = ['Sr.', 'Date', 'Battery Maker', 'Battery No.', 'Reference'];
  const rowsOf = () => batteries.map((b, i) => [i + 1, formatDate(b.date), b.battery_maker || '', b.battery_no || '', b.reference_no || '']);
  const doPrint = () => {
    const body = rowsOf().map((r) => '<tr>' + r.map((c) => `<td>${escHtml(c)}</td>`).join('') + '</tr>').join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Battery Stock - ${escHtml(dealerName)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:16px}h2{margin:0 0 6px}.meta{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:5px 7px;text-align:left}th{background:#eee}tfoot td{font-weight:700}</style></head><body><h2>G.R.D. MOTORS — Battery Stock with Dealer</h2><div class="meta"><b>Dealer:</b> ${escHtml(dealerName)}</div><div class="meta"><b>Date:</b> ${escHtml(today)} &nbsp;·&nbsp; <b>Total Qty:</b> ${batteries.length}</div><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="${cols.length}">Total Qty: ${batteries.length}</td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };
  const doExport = async () => {
    const XLSX = await import('xlsx');
    const aoa = [['G.R.D. MOTORS — Battery Stock with Dealer'], ['Dealer', dealerName], ['Date', today], ['Total Qty', batteries.length], [], cols, ...rowsOf()];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 24 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dealer Battery');
    XLSX.writeFile(wb, `Battery_Stock_${String(dealerName).replace(/[^\w\-]+/g, '_').slice(0, 40)}.xlsx`);
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="modalbox" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{dealerName}</h2>
            <div className="subtitle">Total Battery: <b>{batteries.length}</b></div>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={doPrint}>Print</button>
            <button type="button" className="btn" onClick={doExport}>Export Excel</button>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
        {batteries.length === 0 ? <EmptyState text="No battery stock with this dealer." /> : (
          <div className="tablewrap stockTable">
            <table className="table">
              <thead><tr><th>Date</th><th>Battery Maker</th><th>Battery No.</th><th>Reference</th></tr></thead>
              <tbody>{batteries.map((b) => (
                <tr key={b.id}>
                  <td data-label="Date">{formatDate(b.date)}</td>
                  <td data-label="Battery Maker">{b.battery_maker || '—'}</td>
                  <td data-label="Battery No."><b>{b.battery_no}</b></td>
                  <td data-label="Reference">{b.reference_no || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


const ACTIVITY_TYPES = [['', 'All'], ['delivery-challans', 'Delivery Challan'], ['tax-invoices', 'Bill / Tax Invoice'], ['credit-notes', 'Credit Note'], ['production-vouchers', 'Production Voucher'], ['challan-shift', 'Challan Shift'], ['battery-addition', 'Battery Added'], ['battery-withdrawal', 'Battery Withdrawn'], ['battery-swap-vouchers', 'Battery Swap / Exchange'], ['battery-fit', 'Battery Fit on Challan'], ['dealer/customer-invoice', 'Dealer Customer Invoice']];
const MODULE_LABEL = { 'delivery-challans': 'Delivery Challan', 'tax-invoices': 'Bill (Tax Invoice)', 'credit-notes': 'Credit Note', 'production-vouchers': 'Production Voucher', 'dealer/tax-invoices': 'Bill (Tax Invoice, dealer)', 'dealer/customer-invoice': 'Dealer Customer Invoice', 'battery-addition': 'Battery', 'battery-withdrawal': 'Battery' };
const activityLabel = (r) => {
  const act = String(r.action || '');
  if (['create', 'edit', 'update', 'delete'].includes(act)) return `${MODULE_LABEL[r.module_key] || r.module_key} ${act === 'create' ? 'created' : act === 'delete' ? 'deleted' : 'edited'}`;
  return act;
};
const activityDetail = (r) => {
  const n = r.new_value || {}, o = r.old_value || {};
  if (r.module_key === 'battery-swap-vouchers') return [n.from && n.to && `${n.from} <-> ${n.to}`, n.battery_maker, n.voucher_no && 'Voucher: ' + n.voucher_no].filter(Boolean).join(' | ');
  if (r.module_key === 'battery-fit') return [n.chassis_no && 'Chassis: ' + n.chassis_no, n.battery_maker, n.battery_no && 'New: ' + n.battery_no, o.battery_no && 'Old: ' + o.battery_no].filter(Boolean).join(' | ');
  if (r.action === 'edit' || r.action === 'update') {
    const skip = new Set(['id', 'created_at', 'updated_at']);
    const diff = Object.keys(n).filter((k) => !skip.has(k) && JSON.stringify(n[k]) !== JSON.stringify(o[k]) && typeof n[k] !== 'object').slice(0, 6).map((k) => `${k}: ${o[k] ?? '—'} → ${n[k] ?? '—'}`);
    const ref = r.record_ref ? r.record_ref + ' | ' : '';
    return diff.length ? ref + diff.join(' ; ') : (r.record_ref || '—');
  }
  if (r.action === 'delete' || r.module_key === 'delivery-challans') { const x = n.challan_no || n.bill_no ? n : o; if (x.challan_no || x.bill_no) return [x.challan_no && 'Challan: ' + x.challan_no, x.bill_no && 'Bill: ' + x.bill_no, x.chassis_no && 'Chassis: ' + x.chassis_no].filter(Boolean).join(' | '); }
  if (r.module_key === 'challan-shift') return `${o.dealer || '—'} → ${n.dealer || '—'}${n.remark ? ' | ' + n.remark : ''}`;
  if (r.module_key === 'battery-addition' || r.module_key === 'battery-withdrawal') return [n.battery_maker, n.battery_no && 'No: ' + n.battery_no, n.chassis_no && 'Chassis: ' + n.chassis_no, n.position && 'Pos ' + n.position].filter(Boolean).join(' | ');
  if (r.module_key === 'production-vouchers' && r.action !== 'edit') { const x = n.vou_no ? n : o; return [x.vou_no && 'Vou: ' + x.vou_no, x.product_name, x.quantity && 'Qty: ' + x.quantity, x.chassis_no && 'Chassis: ' + x.chassis_no].filter(Boolean).join(' | '); }
  if (r.module_key === 'credit-notes') return [n.credit_note_no && 'CN: ' + n.credit_note_no, n.bill_no && 'Bill: ' + n.bill_no, n.challan_no && 'Challan: ' + n.challan_no, n.chassis_no && 'Chassis: ' + n.chassis_no, n.total_amount && 'Amt: ' + n.total_amount, n.reason && 'Reason: ' + n.reason].filter(Boolean).join(' | ');
  return [n.challan_no && 'Challan: ' + n.challan_no, n.bill_no && 'Bill: ' + n.bill_no, n.chassis_no && 'Chassis: ' + n.chassis_no].filter(Boolean).join(' | ');
};

export function ActivityLogPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ type: '', user: '', q: '', from: '', to: '' });
  const load = (flt = f) => {
    setError('');
    const qs = new URLSearchParams(Object.entries(flt).filter(([, v]) => v));
    get('/activity-log?' + qs.toString(), { noClientCache: true }).then((d) => setRows(d.rows || [])).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, []);
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <div className="page">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Activity Log</h2>
            <div className="muted">Delivery Challan, Bill, Credit Note, Production Voucher, Challan Shift aur Battery — kisne kiya aur kab.</div>
          </div>
          <button type="button" className="btn" onClick={() => load()}>↻ Refresh</button>
        </div>
        <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: 190 }} value={f.type} onChange={(e) => set('type', e.target.value)}>{ACTIVITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input className="input" style={{ maxWidth: 160 }} placeholder="User" value={f.user} onChange={(e) => set('user', e.target.value)} />
          <input className="input" style={{ maxWidth: 220 }} placeholder="Challan / Bill / Chassis / Dealer" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <input className="input" type="date" style={{ maxWidth: 150 }} value={f.from} onChange={(e) => set('from', e.target.value)} />
          <input className="input" type="date" style={{ maxWidth: 150 }} value={f.to} onChange={(e) => set('to', e.target.value)} />
          <button type="button" className="btn primary" onClick={() => load()}>Search</button>
        </div>
      </div>
      <ErrorBanner message={error} />
      {!rows ? <div className="card">Loading…</div> : rows.length === 0 ? <EmptyState text="Koi activity nahi mili." /> : (
        <div className="card"><div className="tablewrap stockTable"><table className="table">
          <thead><tr><th>Date / Time</th><th>User</th><th>Activity</th><th>Dealer</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Date / Time">{new Date(r.created_at).toLocaleString('en-IN')}</td>
              <td data-label="User"><b>{r.username || '—'}</b>{r.department ? <div className="muted" style={{ fontSize: 11 }}>{r.department}</div> : null}</td>
              <td data-label="Activity">{activityLabel(r)}</td>
              <td data-label="Dealer">{r.dealer_name || '—'}</td>
              <td data-label="Details">{activityDetail(r) || r.record_ref || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

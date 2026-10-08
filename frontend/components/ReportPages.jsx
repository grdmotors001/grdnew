'use client';
import { useEffect, useRef, useState } from 'react';
import { get, post, put, del, downloadExcel } from '../lib/api';
import { EmptyState, ErrorBanner, Field, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { DeliveryChallanPrintView } from './PrintDocs';
import { DayBookPreview, Pagination } from './DayBookPreview';
import { PartyLedgerView } from './PartyLedgers';

function useReport(path, extraParams = {}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState(extraParams);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const firstRun = useRef(true);

  // Search/date badalne par page 1 par wapas (warna page 3 par khali result dikhta tha)
  const setSearchReset = (v) => { setSearch(v); setExtra((x) => (x && x.page && x.page !== 1 ? { ...x, page: 1 } : x)); };

  useEffect(() => {
    const q = new URLSearchParams({
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...extra,
    });
    const myReq = ++reqId.current;
    const run = () => {
      setLoading(true);
      get(`${path}?${q}`)
        .then((d) => { if (myReq === reqId.current) { setData(d); setError(''); } }) // late aaya purana response ignore
        .catch((e) => { if (myReq === reqId.current) setError(e.message); })
        .finally(() => { if (myReq === reqId.current) setLoading(false); });
    };
    // Pehli load turant; baad me typing par 300ms debounce
    if (firstRun.current) { firstRun.current = false; run(); return undefined; }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [path, from, to, search, JSON.stringify(extra)]);

  return { from, setFrom, to, setTo, search, setSearch: setSearchReset, data, error, extra, setExtra, loading };
}

// Export Excel ke liye current filters ka query string (backend export=csv me pagination ignore karta hai).
const qs = (r) => {
  const { page, per_page, _r, ...rest } = r.extra || {};
  return '?' + new URLSearchParams({
    ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}), ...(r.search ? { search: r.search } : {}), ...rest,
  });
};

function FilterBar({ r, showSearch = true, children }) {
  return (
    <div className="toolbar">
      <Field label="From" type="date" value={r.from} onChange={r.setFrom} />
      <Field label="To" type="date" value={r.to} onChange={r.setTo} />
      {showSearch && <Field label={r.loading ? 'Search (searching...)' : 'Search'} value={r.search} onChange={r.setSearch} />}
      {children}
    </div>
  );
}

// Groups consecutive Ledger events that share a Doc No. (a Sale row plus its
// Hypothecation/direct-received CASH row(s), which the backend always emits
// back-to-back for the same bill) so they can be rendered as one visual
// block: a merged Doc No. cell, a single combined net-amount figure, and a
// boxed outline around the group. Receipts (Day Book rows, blank Doc No.)
// are left as their own single-row "group".
function groupLedgerEvents(events) {
  const out = [];
  let i = 0;
  while (i < events.length) {
    let j = i;
    if (events[i].doc_no) {
      while (j + 1 < events.length && events[j + 1].doc_no === events[i].doc_no) j++;
    }
    const group = events.slice(i, j + 1);
    const groupNet = group.reduce((s, e) => s + (e.credit || 0) - (e.debit || 0), 0);
    group.forEach((e, idx) => out.push({
      ...e, _groupSize: group.length, _groupPos: idx, _groupNet: groupNet,
    }));
    i = j + 1;
  }
  return out;
}

export function PurchaseRegisterPage() {
  const r = useReport('/reports/purchase-register', { page: 1, per_page: 50 });
  const [detailRow, setDetailRow] = useState(null);
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  const goPage = (page) => r.setExtra({ ...r.extra, page });

  return (
    <>
      <FilterBar r={r}>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/purchase-register' + qs(r), 'Purchase_Register.xlsx')}>Export Excel</button>
      </FilterBar>
      {r.data.rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Party</th><th>Items</th><th>Qty</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {r.data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td><b>{row.bill_no}</b></td>
                  <td>{row.party_name}</td>
                  <td>{row.item_count}</td>
                  <td>{row.total_qty ?? 0}</td>
                  <td><Money value={row.taxable_amt} /></td>
                  <td><Money value={row.cgst_amt} /></td>
                  <td><Money value={row.sgst_amt} /></td>
                  <td><Money value={row.igst_amt} /></td>
                  <td><b><Money value={row.total_amt} /></b></td>
                  <td><button className="btn" onClick={() => setDetailRow(row)}>View</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={5}><b>Current Page Totals</b></td>
              <td><Money value={r.data.totals.taxable} /></td>
              <td><Money value={r.data.totals.cgst} /></td>
              <td><Money value={r.data.totals.sgst} /></td>
              <td><Money value={r.data.totals.igst} /></td>
              <td><b><Money value={(r.data.totals.taxable || 0) + (r.data.totals.cgst || 0) + (r.data.totals.sgst || 0) + (r.data.totals.igst || 0)} /></b></td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
      )}
      {(r.data.total_pages || 1) > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center', gap: 8 }}>
          <button className="btn" disabled={r.data.page <= 1} onClick={() => goPage(r.data.page - 1)}>← Previous</button>
          <span className="muted">Page {r.data.page} of {r.data.total_pages} · {r.data.total.toLocaleString('en-IN')} bills</span>
          <button className="btn" disabled={r.data.page >= r.data.total_pages} onClick={() => goPage(r.data.page + 1)}>Next →</button>
        </div>
      )}

      {detailRow && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailRow(null); }}>
          <div className="modalbox" style={{ maxWidth: 980 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div>
                <h2 style={{ marginBottom:4 }}>Purchase Bill Details — {detailRow.bill_no}</h2>
                <div className="muted">{formatDate(detailRow.date)} · {detailRow.party_name}</div>
              </div>
              <button className="btn" onClick={() => setDetailRow(null)}>Close</button>
            </div>
            <div className="formgrid" style={{ marginTop:16 }}>
              <Field label="Party Name" value={detailRow.party_name || '—'} readOnly />
              <Field label="Supplier GSTIN" value={detailRow.party_gst_no || '—'} readOnly />
              <Field label="Bill No." value={detailRow.bill_no || '—'} readOnly />
              <Field label="Invoice Date" value={formatDate(detailRow.date)} readOnly />
              <Field label="State Code" value={detailRow.party_state_code || '—'} readOnly />
              <Field label="Remarks" value={detailRow.remarks || '—'} readOnly />
            </div>
            <div className="tablewrap" style={{ marginTop:18 }}>
              <table className="table">
                <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
                <tbody>
                  {(detailRow.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td><td>{it.item_name}</td><td>{it.hsn || '—'}</td><td>{it.qty}</td><td><Money value={it.rate} /></td><td>{it.gst_rate}%</td>
                      <td><Money value={it.taxable_amt} /></td><td><Money value={it.cgst_amt} /></td><td><Money value={it.sgst_amt} /></td><td><Money value={it.igst_amt} /></td><td><b><Money value={it.total_amt} /></b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={6}><b>Grand Total</b></td>
                  <td><Money value={detailRow.taxable_amt} /></td><td><Money value={detailRow.cgst_amt} /></td><td><Money value={detailRow.sgst_amt} /></td><td><Money value={detailRow.igst_amt} /></td><td><b><Money value={detailRow.total_amt} /></b></td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ProductionRegisterPage() {
  const r = useReport('/reports/production-register', { status: 'all' });
    if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;

  const rows = r.data.rows || [];
  const costVisible = !!r.data.cost_visible;   // sent by the server to admin users only
  const setStatus = (status) => r.setExtra({ ...r.extra, status, page: 1 });
  const goPage = (page) => r.setExtra({ ...r.extra, page });

  return (
    <>
      <FilterBar r={r}>
        <div className="actions" style={{ alignSelf: 'flex-end', gap: 6 }}>
          <button className={`btn ${r.extra.status === 'all' ? 'primary' : ''}`} onClick={() => setStatus('all')}>ALL</button>
          <button className={`btn ${r.extra.status === 'delivered' ? 'primary' : ''}`} onClick={() => setStatus('delivered')}>DELIVERED</button>
          <button className={`btn ${r.extra.status === 'factory' ? 'primary' : ''}`} onClick={() => setStatus('factory')}>IN STOCK</button>
        </div>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
                onClick={() => downloadExcel('/reports/production-register' + qs(r) + `&status=${r.extra.status}&export=csv`, 'Production_Register.xlsx')}>
          Export Excel
        </button>
      </FilterBar>

      {costVisible && (
        <p className="muted" style={{ margin: '4px 0 8px' }}>
          Avg Cost = raw material used × average purchase rate (voucher date tak ki purchases, GST alag) ÷ vehicles. <b style={{ color: '#d97706' }}>*</b> = kuch item ka rate/line nahi mili, cost kam ho sakti hai. Ye column sirf Admin ko dikhta hai.
        </p>
      )}

      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Product</th><th>Formula Name</th><th>Qty</th><th>Chassis No.</th><th>Motor No.</th><th>Mechanic</th>{costVisible && <th style={{ textAlign: 'right' }}>Avg Cost (₹)</th>}<th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((v) => {
              const status = v.stage || 'In Factory Stock';
              return <tr key={v.id}>
                <td>{formatDate(v.date)}</td><td>{v.vou_no}</td><td>{v.product_name}</td><td>{v.formula_name || '—'}</td><td>{v.quantity}</td>
                <td>{v.chassis_no}</td><td>{v.motor_no}</td><td>{String(v.machnic || '').trim()}</td>
                {costVisible && (
                  <td style={{ textAlign: 'right' }}
                      title={v.cost_missing_items > 0 ? `${v.cost_missing_items} raw item(s) ka purchase rate nahi mila - cost kam dikh sakti hai` : (v.cost_source === 'none' ? 'Raw material lines / formula nahi mili' : '')}>
                    {v.avg_cost > 0 ? Number(v.avg_cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    {(v.cost_missing_items > 0 || v.cost_source === 'none') && <b style={{ color: '#d97706' }}> *</b>}
                  </td>
                )}
                <td>{status}</td>
                <td><span className="muted">View only</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {(r.data.total_pages || 1) > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center', gap: 8 }}>
          <button className="btn" disabled={r.data.page <= 1} onClick={() => goPage(r.data.page - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Page {r.data.page} of {r.data.total_pages} ({r.data.total.toLocaleString()} total)</span>
          <button className="btn" disabled={r.data.page >= r.data.total_pages} onClick={() => goPage(r.data.page + 1)}>Next →</button>
        </div>
      )}

      <div className="muted" style={{marginTop:12}}>Production Register is view-only. Edit Production Voucher from Factory → Production Voucher.</div>
    </>
  );
}

export function DeliveryChallanRegisterPage() {
  const r = useReport('/reports/delivery-challan-register', { status: 'all', page: 1, per_page: 100 });
  const [colourMasters, setColourMasters] = useState([]);
  useEffect(() => { get('/masters/colour').then((x) => setColourMasters(Array.isArray(x) ? x : (x.masters || x.rows || x.data || []))).catch(() => {}); }, []);
  const [editRow, setEditRow] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [printId, setPrintId] = useState(null);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ product: 'ALL', dealer: 'ALL', salesman: 'ALL', battery: 'ALL' });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showRemarks, setShowRemarks] = useState(false); // Remarks hamesha hidden; button se dikhao


  if (r.error) return <ErrorBanner message={r.error} />;
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;

  const rows = r.data.rows || [];
  const colourMeta = (name) => colourMasters.find((x) => String(x.name||'').trim().toLowerCase() === String(name||'').trim().toLowerCase());
  const colourPreview = (name) => {
    const x=colourMeta(name);
    if (!x?.color_hex) return null;
    return x.is_double_tone && x.color_hex2
      ? `linear-gradient(90deg,${x.color_hex} 0 50%,${x.color_hex2} 50% 100%)`
      : x.color_hex;
  };
  const filterOptions = r.data.filters || { product: [], dealer: [], salesman: [], battery: [] };
  const activeFilterCount = Object.values(filters).filter((v) => v !== 'ALL').length;

  const setStatus = (status) => r.setExtra({ ...r.extra, status, page: 1 });
  const openFilter = () => { setDraftFilters(filters); setFilterOpen(true); };
  const applyFilter = () => {
    setFilters(draftFilters);
    r.setExtra({ ...r.extra, ...draftFilters, page: 1 });
    setFilterOpen(false);
  };
  const resetFilter = () => {
    const cleared = { product: 'ALL', dealer: 'ALL', salesman: 'ALL', battery: 'ALL' };
    setDraftFilters(cleared);
    setFilters(cleared);
    r.setExtra({ status: 'all', page: 1, per_page: 100 });
    setFilterOpen(false);
  };
  const goPage = (page) => r.setExtra({ ...r.extra, page });
  const setE = (key) => (v) => setEditRow((x) => ({ ...x, [key]: v }));
  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true); setEditError('');
    try {
      await put(`/delivery-challans/${editRow.id}`, editRow);
      setEditRow(null);
      r.setExtra({ ...r.extra, _r: Date.now() }); // register reload
    } catch (err) { setEditError(err.message || 'Could not save challan'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <FilterBar r={r}>
        <div className="actions" style={{ alignSelf: 'flex-end', gap: 6 }}>
          <button className={`btn ${r.extra.status === 'all' ? 'primary' : ''}`} onClick={() => setStatus('all')}>All</button>
          <button className={`btn ${r.extra.status === 'sold' ? 'primary' : ''}`} onClick={() => setStatus('sold')}>Sold</button>
          <button className={`btn ${r.extra.status === 'unsold' ? 'primary' : ''}`} onClick={() => setStatus('unsold')}>Unsold</button>
        </div>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={openFilter}>
          Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
                onClick={() => downloadExcel('/reports/delivery-challan-register' + qs(r) + `&status=${r.extra.status}&export=csv`, 'Delivery_Challan_Register.xlsx')}>
          Export Excel
        </button>
        <button className={`btn ${showRemarks ? 'primary' : ''}`} style={{ alignSelf: 'flex-end' }} onClick={() => setShowRemarks((v) => !v)}>
          {showRemarks ? 'Hide Remarks' : 'Show Remarks'}
        </button>
      </FilterBar>

      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Challan No.</th><th>Party Name</th>
                <th>Chassis No.</th><th>Model</th><th>Formula Name</th><th>Colour</th><th>Other</th>
                <th>Sale Bill No.</th><th>Sale Value</th><th>Salesman</th>
                <th>Battery Make</th><th>Battery No.</th><th>Old Battery Make</th><th>Old Battery No.</th>
                {showRemarks && <><th>Remarks (1)</th><th>Remarks (2)</th></>}<th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  onDoubleClick={() => setDetailRow(c)}
                  style={{ cursor: 'pointer' }}
                  title="Double-click to view challan"
                >
                  <td>{formatDate(c.date)}</td>
                  <td>{c.challan_no}</td>
                  <td><button type="button" onClick={() => setDetailRow(c)} title="Open Delivery Challan" style={{border:0,background:"none",padding:0,color:"var(--primary,#1976d2)",textDecoration:"underline",fontWeight:600,cursor:"pointer"}}>{c.dealer_name}</button></td>
                  <td><button type="button" onClick={() => setDetailRow(c)} title="Open Delivery Challan" style={{border:0,background:"none",padding:0,color:"var(--primary,#1976d2)",textDecoration:"underline",fontWeight:600,cursor:"pointer"}}>{c.chassis_no}</button></td>
                  <td>{c.product_name || '—'}</td>
                  <td>{c.formula_name || '—'}</td>
                  <td><span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                    <span style={{width:22,height:14,borderRadius:4,border:'1px solid var(--border)',background:colourPreview(c.colour)||'transparent'}} />
                    {c.colour||'—'}
                  </span></td>
                  <td>{c.other}</td>
                  <td>{c.bill_no || '—'}</td>
                  <td>{c.sale_value ? <Money value={c.sale_value} /> : ''}</td>
                  <td>{c.salesman}</td>
                  <td>{c.battery_maker}</td>
                  <td>{[c.battery_no1,c.battery_no2,c.battery_no3,c.battery_no4].map((x) => String(x||'').trim()).filter(Boolean).join(', ')}</td>
                  <td>{c.old_battery_maker || ''}</td>
                  <td>{[c.old_battery_no1,c.old_battery_no2,c.old_battery_no3,c.old_battery_no4].map((x) => String(x||'').trim()).filter(Boolean).join(', ')}</td>
                  {showRemarks && <><td>{c.remarks1}</td><td>{c.remarks2}</td></>}
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(r.data.total_pages || 1) > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center', gap: 8 }}>
          <button className="btn" disabled={r.data.page <= 1} onClick={() => goPage(r.data.page - 1)}>← Previous</button>
          <span className="muted">Page {r.data.page} of {r.data.total_pages} · {r.data.total.toLocaleString('en-IN')} rows</span>
          <button className="btn" disabled={r.data.page >= r.data.total_pages} onClick={() => goPage(r.data.page + 1)}>Next →</button>
        </div>
      )}

      {filterOpen && (
        <div className="modal">
          <div className="modalbox" style={{ maxWidth: 420 }}>
            <h2>Filter</h2>
            <div className="formgrid" style={{ gridTemplateColumns: '1fr' }}>
              <Field label="E-Rickshaw" type="select" value={draftFilters.product}
                     options={['ALL', ...(filterOptions.product || [])]}
                     onChange={(v) => setDraftFilters({ ...draftFilters, product: v })} />
              <Field label="Dealer" type="select" value={draftFilters.dealer}
                     options={['ALL', ...(filterOptions.dealer || []).filter((d) => d && (typeof d !== 'object' || d.id)).map((d) => (typeof d === 'object' ? { value: String(d.id), label: d.name || ('Dealer #' + d.id) } : d))]}
                     onChange={(v) => setDraftFilters({ ...draftFilters, dealer: v })} />
              <Field label="Salesman" type="select" value={draftFilters.salesman}
                     options={['ALL', ...(filterOptions.salesman || [])]}
                     onChange={(v) => setDraftFilters({ ...draftFilters, salesman: v })} />
              <Field label="Battery Make" type="select" value={draftFilters.battery}
                     options={['ALL', ...(filterOptions.battery || [])]}
                     onChange={(v) => setDraftFilters({ ...draftFilters, battery: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              <button type="button" className="btn" onClick={resetFilter}>Reset</button>
              <div className="actions">
                <button type="button" className="btn" onClick={() => setFilterOpen(false)}>Cancel</button>
                <button type="button" className="btn primary" onClick={applyFilter}>Okay</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveEdit} style={{ maxWidth: 760 }}>
            <h2>Edit Delivery Challan — {editRow.challan_no}</h2>
            <ErrorBanner message={editError} />
            <p className="muted" style={{ marginTop: -6 }}>
              Chassis/Dealer/vehicle details are preserved. Sale Value and Dealer Page No. are not entered here;
              Sale Value appears in the register after the Tax Invoice is created.
            </p>
            <div className="formgrid">
              <Field label="Challan No." value={editRow.challan_no} onChange={setE('challan_no')} />
              <Field label="Date" type="date" value={editRow.date} onChange={setE('date')} />
              <Field label="Dealer" value={editRow.dealer_name} readOnly />
              <Field label="Destination" value={editRow.destination} onChange={setE('destination')} />
              <Field label="Salesman" value={editRow.salesman} onChange={setE('salesman')} />
              <Field label="Chassis No." value={editRow.chassis_no} readOnly />
              <Field label="Model Name" value={editRow.product_name} readOnly />
              <Field label="Colour" value={editRow.colour} readOnly />
              <Field label="Motor No." value={editRow.motor_no} readOnly />
              <Field label="Battery Maker" value={editRow.battery_maker} onChange={setE('battery_maker')} />
              <Field label="Battery No. 1" value={editRow.battery_no1} onChange={setE('battery_no1')} />
              <Field label="Battery No. 2" value={editRow.battery_no2} onChange={setE('battery_no2')} />
              <Field label="Battery No. 3" value={editRow.battery_no3} onChange={setE('battery_no3')} />
              <Field label="Battery No. 4" value={editRow.battery_no4} onChange={setE('battery_no4')} />
              {[
                ['toolkit', 'Toolkit'], ['jack', 'Jack'], ['charger', 'Charger'], ['center_lock', 'Center Lock'],
                ['mat', 'Mat'], ['stapney', 'Stapney'], ['front_glass', 'Front Glass'], ['h_lock', 'H Lock'],
              ].map(([key, label]) => (
                <Field key={key} label={label} type="checkbox" value={!!editRow[key]} onChange={setE(key)} />
              ))}
              <Field label="Remarks" value={editRow.remarks1} onChange={setE('remarks1')} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setEditRow(null)}>Cancel</button>
              <button type="button" className="btn" onClick={() => setPrintId(editRow.id)}>Print / Preview</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {detailRow && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailRow(null); }}>
          <div className="modalbox" style={{ maxWidth: 820 }}>
            <h2>Delivery Challan Details — {detailRow.challan_no}</h2>
            <div className="formgrid">
              <Field label="Challan No." value={detailRow.challan_no || '—'} readOnly />
              <Field label="Date" value={detailRow.date ? formatDate(detailRow.date) : '—'} readOnly />
              <Field label="Dealer" value={detailRow.dealer_name || '—'} readOnly />
              <Field label="Salesman" value={detailRow.salesman || '—'} readOnly />
              <Field label="Model Name" value={detailRow.product_name || '—'} readOnly />
              <Field label="Chassis No." value={detailRow.chassis_no || '—'} readOnly />
              <Field label="Motor No." value={detailRow.motor_no || '—'} readOnly />
              <Field label="Controller No." value={detailRow.controller_no || '—'} readOnly />
              <Field label="Differential No." value={detailRow.differential_no || '—'} readOnly />
              <Field label="Colour" value={detailRow.colour || '—'} readOnly />
              <Field label="Battery Maker" value={detailRow.battery_maker || '—'} readOnly />
              <Field label="Battery No. 1" value={detailRow.battery_no1 || '—'} readOnly />
              <Field label="Battery No. 2" value={detailRow.battery_no2 || '—'} readOnly />
              <Field label="Battery No. 3" value={detailRow.battery_no3 || '—'} readOnly />
              <Field label="Battery No. 4" value={detailRow.battery_no4 || '—'} readOnly />
              <Field label="Old Battery Maker" value={detailRow.old_battery_maker || '—'} readOnly />
              <Field label="Old Battery No." value={[detailRow.old_battery_no1,detailRow.old_battery_no2,detailRow.old_battery_no3,detailRow.old_battery_no4].map((x) => String(x||'').trim()).filter(Boolean).join(', ') || '—'} readOnly />
              <Field label="Item Amount" value={detailRow.item_amount ?? '—'} readOnly />
              <Field label="Sale Bill No." value={detailRow.bill_no || '—'} readOnly />
              <Field label="Sale Value" value={detailRow.sale_value ?? '—'} readOnly />
              <Field label="Destination" value={detailRow.destination || '—'} readOnly />
              <Field label="Other" value={detailRow.other || '—'} readOnly />
              <Field label="Remarks 1" value={detailRow.remarks1 || '—'} readOnly />
              <Field label="Remarks 2" value={detailRow.remarks2 || '—'} readOnly />
            </div>
            <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDetailRow(null)}>Close</button>
              <button className="btn primary" onClick={() => setPrintId(detailRow.id)}>Preview / PDF</button>
            </div>
          </div>
        </div>
      )}
      {printId && <DeliveryChallanPrintView challanId={printId} onClose={() => setPrintId(null)} />}
    </>
  );
}

export function SaleRegisterPage() {
  const r = useReport('/reports/sale-register', { page: 1, per_page: 50 });
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  const goPage = (page) => r.setExtra({ ...r.extra, page });
  return (
    <>
      <FilterBar r={r}>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/sale-register' + qs(r), 'Sale_Register.xlsx')}>Export Excel</button>
      </FilterBar>
      {r.data.invoices.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Buyer</th><th>State</th><th>Product</th><th>Taxable</th><th>Tax</th><th>Total</th></tr></thead>
            <tbody>
              {r.data.invoices.map((i) => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.buyer_name}</td><td>{i.buyer_state || '—'}</td><td>{i.product_name}</td><td><Money value={i.taxable_value} /></td><td><Money value={i.tax_amount} /></td><td><Money value={i.bill_total} /></td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={5}><b>All matching totals</b></td><td><Money value={r.data.totals.taxable} /></td><td><Money value={r.data.totals.tax} /></td><td><Money value={r.data.totals.total} /></td></tr></tfoot>
          </table>
        </div>
      )}
      {(r.data.total_pages || 1) > 1 && <div className="actions" style={{marginTop:12,justifyContent:'center',gap:8}}>
        <button className="btn" disabled={r.data.page<=1} onClick={()=>goPage(r.data.page-1)}>← Previous</button>
        <span className="muted">Page {r.data.page} of {r.data.total_pages} · {r.data.total.toLocaleString('en-IN')} bills</span>
        <button className="btn" disabled={r.data.page>=r.data.total_pages} onClick={()=>goPage(r.data.page+1)}>Next →</button>
      </div>}
    </>
  );
}

export function GstRegisterPage() {
  const r = useReport('/reports/gst-register');
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  return (
    <>
      <FilterBar r={r}>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/gst-register' + qs(r), 'GST_Register.xlsx')}>Export Excel</button>
      </FilterBar>
      <div className="card" style={{ marginBottom: 14 }}>
        <b>Outward (Sale) — Net Payable Basis</b>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Buyer</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th></tr></thead>
            <tbody>{r.data.outward.map((i) => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.buyer_name}</td><td><Money value={i.taxable_value} /></td><td><Money value={i.cgst_amount} /></td><td><Money value={i.sgst_amount} /></td><td><Money value={i.igst_amount} /></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><b>Totals</b></td><td><Money value={r.data.outward_totals.taxable} /></td><td><Money value={r.data.outward_totals.cgst} /></td><td><Money value={r.data.outward_totals.sgst} /></td><td><Money value={r.data.outward_totals.igst} /></td></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="card">
        <b>Inward (Purchase) — Net Credit Basis</b>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Party</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th></tr></thead>
            <tbody>{r.data.inward.map((row, i) => <tr key={i}><td>{formatDate(row.date)}</td><td>{row.doc_no}</td><td>{row.party_name}</td><td><Money value={row.taxable} /></td><td><Money value={row.cgst} /></td><td><Money value={row.sgst} /></td><td><Money value={row.igst} /></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><b>Totals</b></td><td><Money value={r.data.inward_totals.taxable} /></td><td><Money value={r.data.inward_totals.cgst} /></td><td><Money value={r.data.inward_totals.sgst} /></td><td><Money value={r.data.inward_totals.igst} /></td></tr></tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

const localToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const emptyReceipt = () => ({ receipt_date: localToday(), financer_name: '', amount: '', cheque_no: '', chassis_no: '', vehicle_no: '', received_in: '' });

export function HypothecationRegisterPage() {
  const r = useReport('/reports/hypothecation-register');
  const [receipts, setReceipts] = useState([]);
  const [rcSearch, setRcSearch] = useState('');
  const [rcError, setRcError] = useState('');
  const [financers, setFinancers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyReceipt());
  const [found, setFound] = useState(null);
  const [lookupMsg, setLookupMsg] = useState('');
  const [notice, setNotice] = useState([]);
  const { busy, error, setError, run } = useAsyncAction();

  const loadReceipts = () => get(`/hypothecation-receipts?${new URLSearchParams(rcSearch ? { search: rcSearch } : {})}`)
    .then((d) => { setReceipts(d.receipts || d.rows || []); setRcError(''); })
    .catch((e) => setRcError(e.message));
  useEffect(() => { loadReceipts(); }, [rcSearch]);
  useEffect(() => {
    get('/masters/financer').then((d) => {
      const list = Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.items || []);
      setFinancers(list.map((x) => x.name || x.value || x.label || '').filter(Boolean));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    get('/masters/bank').then((d) => {
      const list = Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.items || []);
      setBanks(list.map((x) => ({ name: x.name || x.value || x.label || '', acc: x.account_no || '' })).filter((x) => x.name));
    }).catch(() => {});
  }, []);

  const refresh = () => { loadReceipts(); r.setExtra({ ...r.extra, _r: Date.now() }); };

  // Chassis No. (ya Vehicle No.) se bill dhundhta hai; vehicle no. / financer khud bhar deta hai.
  const lookup = async (by, value) => {
    const v = String(value || '').trim();
    if (!v) { setFound(null); setLookupMsg(''); return; }
    try {
      const d = await get(`/hypothecation-receipts/lookup?${new URLSearchParams({ [by]: v })}`);
      if (!d.found) { setFound(null); setLookupMsg('Is Chassis / Vehicle No. ka koi bill nahi mila.'); return; }
      const inv = d.invoice;
      if (!inv.has_loan) { setFound(null); setLookupMsg('Is bill par loan (hypothecation) nahi hai.'); return; }
      setFound(inv);
      setLookupMsg('');
      setForm((f) => ({ ...f, chassis_no: inv.chassis_no || f.chassis_no, vehicle_no: inv.vehicle_no || f.vehicle_no, financer_name: f.financer_name || inv.financer_name || '' }));
    } catch (e) { setFound(null); setLookupMsg(e.message); }
  };

  const openNew = (inv) => {
    setError(''); setLookupMsg(''); setFound(null);
    setForm({ ...emptyReceipt(), ...(inv ? { chassis_no: inv.chassis_no || '', financer_name: inv.financer_name || '', vehicle_no: inv.vehicle_no || '' } : {}) });
    setOpen(true);
    if (inv && inv.chassis_no) lookup('chassis_no', inv.chassis_no);
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const isCash = form.received_in === 'CASH';
      const d = await post('/hypothecation-receipts', { ...form, pay_mode: isCash ? 'cash' : 'bank', bank_name: isCash ? '' : form.received_in });
      setNotice(d.warnings || []);
      setOpen(false); setFound(null); setForm(emptyReceipt());
      refresh();
    }).catch(() => {});
  };

  const removeReceipt = (id) => {
    if (!confirm('Ye receipt delete karni hai?')) return;
    del(`/hypothecation-receipts/${id}`).then(refresh).catch((e) => setRcError(e.message));
  };

  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  const chassisOptions = r.data.invoices.filter((i) => i.chassis_no && Number(i.balance_amount) > 0).map((i) => i.chassis_no);

  return (
    <>
      <FilterBar r={r}>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => openNew()}>+ Add Financer Receipt</button>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/hypothecation-register' + qs(r), 'Hypothecation_Register.xlsx')}>Export Excel</button>
      </FilterBar>
      {notice.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: 'rgba(239,159,39,.14)', border: '1px solid rgba(239,159,39,.5)', color: 'var(--ink)' }}>
          <b>Receipt save ho gayi, par dhyan dein:</b>
          <ul style={{ margin: '6px 0 8px 18px' }}>{notice.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <button className="btn" onClick={() => setNotice([])}>OK</button>
        </div>
      )}
      {r.data.invoices.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Dealer</th><th>Buyer</th><th>Chassis No.</th><th>Vehicle No.</th><th>Financer</th><th>Loan / Hyp.</th><th>Received (Financer)</th><th>Balance</th><th></th></tr></thead>
            <tbody>{r.data.invoices.map((i) => (
              <tr key={i.id}>
                <td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.dealer_name || '—'}</td><td>{i.buyer_name || '—'}</td><td>{i.chassis_no || '—'}</td><td>{i.vehicle_no || '—'}</td><td>{i.financer_name || '—'}</td>
                <td><Money value={i.hypothecation_amount} /></td><td><Money value={i.fin_received} /></td><td><b><Money value={i.balance_amount} /></b></td>
                <td>{i.chassis_no && Number(i.balance_amount) > 0 ? <button className="btn" onClick={() => openNew(i)}>+ Receipt</button> : null}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={7}><b>Total</b></td><td><Money value={r.data.total_hyp} /></td><td><Money value={r.data.total_received} /></td><td><b><Money value={r.data.total_balance} /></b></td><td></td></tr></tfoot>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <b>Financer Receipts (bank me aaye)</b>
          <input className="input" placeholder="Search financer, cheque/ref, chassis, vehicle…" value={rcSearch} onChange={(e) => setRcSearch(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        <ErrorBanner message={rcError} />
        {receipts.length === 0 ? <EmptyState text="Abhi koi financer receipt nahi hai." /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Financer</th><th>Amount</th><th>Received In</th><th>Cheque / Ref No.</th><th>Chassis No.</th><th>Vehicle No.</th><th>Bill No.</th><th>Buyer</th><th></th></tr></thead>
              <tbody>{receipts.map((x) => (
                <tr key={x.id}>
                  <td>{formatDate(x.receipt_date)}</td><td>{x.financer_name}</td><td><Money value={x.amount} /></td><td>{x.pay_mode === 'BANK' ? (x.bank_name || 'Bank') : 'Cash'}</td><td>{x.cheque_no}</td>
                  <td>{x.chassis_no || '—'}</td><td>{x.vehicle_no || '—'}</td><td>{x.bill_no || '—'}</td><td>{x.buyer_name || '—'}</td>
                  <td><button className="btn danger" onClick={() => removeReceipt(x.id)}>Delete</button></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={2}><b>Total</b></td><td><Money value={receipts.reduce((t, x) => t + Number(x.amount || 0), 0)} /></td><td colSpan={7}></td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>Add Financer Receipt</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Date" type="date" value={form.receipt_date} onChange={(v) => setForm({ ...form, receipt_date: v })} required />
              <Field label="Financer Name" type="combo" options={financers} value={form.financer_name} onChange={(v) => setForm({ ...form, financer_name: v })} required />
              <Field label="Amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              <Field label="Received In (Cash / Bank)" type="select" required value={form.received_in}
                     options={[{ value: 'CASH', label: 'Cash' }, ...banks.map((b) => ({ value: b.name, label: b.name + (b.acc ? ' — ' + b.acc : '') }))]}
                     onChange={(v) => setForm({ ...form, received_in: v })} />
              <Field label="Cheque No. / Ref No." value={form.cheque_no} onChange={(v) => setForm({ ...form, cheque_no: v })} required />
              <div onBlur={() => lookup('chassis_no', form.chassis_no)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup('chassis_no', form.chassis_no); } }}>
                <Field label="Chassis No." type="combo" options={chassisOptions} value={form.chassis_no}
                       onChange={(v) => { setForm((f) => ({ ...f, chassis_no: v, ...(found ? { vehicle_no: '' } : {}) })); setFound(null); }} />
              </div>
              <div onBlur={() => { if (!form.chassis_no.trim()) lookup('vehicle_no', form.vehicle_no); }}>
                <Field label="Vehicle No." value={form.vehicle_no} readOnly={!!found?.vehicle_no}
                       onChange={(v) => setForm({ ...form, vehicle_no: v.toUpperCase() })} />
              </div>
            </div>
            {lookupMsg && <div className="error" style={{ marginTop: 10 }}>{lookupMsg}</div>}
            {found && (
              <div className="card" style={{ marginTop: 12, background: 'rgba(39,157,140,.14)', border: '1px solid rgba(39,157,140,.5)', color: 'var(--ink)' }}>
                <div><b>Bill {found.bill_no}</b> · {formatDate(found.date)} · {found.buyer_name || '—'} · {found.dealer_name || '—'}</div>
                <div className="muted" style={{ marginTop: 4 }}>{found.product_name || ''} {found.financer_name ? `· Financer: ${found.financer_name}` : ''}</div>
                <div style={{ marginTop: 6 }}>Loan <Money value={found.hypothecation_amount} /> · Mila <Money value={found.fin_received} /> · <b>Baaki <Money value={found.balance} /></b></div>
                {!found.vehicle_no && form.vehicle_no && <div className="muted" style={{ marginTop: 4 }}>Vehicle no. bill me bhi update ho jayega.</div>}
              </div>
            )}
            <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Receipt'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function PaymentReceivablePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState('1');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const buildQs = (p = page) => {
    const params = new URLSearchParams({ page: p, per_page: 50, show_all: showAll });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (search) params.set('search', search);
    return params;
  };

  useEffect(() => {
    get(`/reports/payment-receivable?${buildQs(1)}`).then((d) => { setData(d); setPage(1); }).catch((e) => setError(e.message));
  }, [from, to, search, showAll]);

  const goToPage = (p) => {
    setPage(p);
    get(`/reports/payment-receivable?${buildQs(p)}`).then(setData).catch((e) => setError(e.message));
  };

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading…</div>;

  return (
    <>
      <div className="toolbar">
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <Field label="Search (dealer, customer, bill no.)" value={search} onChange={setSearch} />
        <Field label="Show" type="select" value={showAll}
               options={[{ value: '0', label: 'Outstanding only' }, { value: '1', label: 'All' }]}
               onChange={setShowAll} />
        <button className="btn" style={{ alignSelf: 'flex-end' }}
                onClick={() => downloadExcel(`/reports/payment-receivable?${buildQs(1)}`, 'Payment_Receivable_Report.xlsx')}>
          Export Excel
        </button>
      </div>
      {data.rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sr.No.</th><th>Date</th><th>Dealer Name</th><th>Bill No.</th><th>Model</th>
                <th>Chassis No.</th><th>Other</th><th>Customer</th><th>Mobile No.</th>
                <th>Value Amt.</th><th>Loan Amt.</th><th>Amt.Recd.</th><th>Balance</th>
                <th>Financer</th><th>RTO</th><th>Chassis Record</th><th>Ledger</th>
                <th>Voucher No.</th><th>Cheque No.</th><th>Vehicle No.</th><th>Salesman</th>
                <th>Incentive Amount</th><th>Incentive Voucher</th><th>Incentive Date</th><th>All Expenses</th><th>Expense Details</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, idx) => (
                <tr key={r.id}>
                  <td>{(data.page - 1) * data.per_page + idx + 1}</td>
                  <td>{formatDate(r.date)}</td><td>{r.dealer_name}</td><td>{r.bill_no}</td><td>{r.model}</td>
                  <td>{r.chassis_no}</td><td>{r.other}</td><td>{r.customer}</td><td>{r.mobile_no}</td>
                  <td><Money value={r.value_amt} /></td><td><Money value={r.loan_amt} /></td>
                  <td><Money value={r.amt_recd} /></td><td><b><Money value={r.balance} /></b></td>
                  <td>{r.financer}</td><td>{r.rto}</td><td>{r.chassis_record}</td><td>{r.ledger}</td>
                  <td>{r.voucher_no}</td><td>{r.cheque_no}</td><td>{r.vehicle_no}</td><td>{r.salesman}</td>
                  <td><Money value={r.incentive_amount} /></td><td>{r.incentive_voucher_no||'—'}</td><td>{r.incentive_date?formatDate(r.incentive_date):'—'}</td><td><Money value={r.expense_total} /></td><td>{(r.expense_details||[]).map((e,i)=><div key={i}>{e.type}: <Money value={e.amount} /> <span className="muted">{e.voucher_no}</span></div>)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9}><b>Totals</b></td>
                <td><Money value={data.totals.value} /></td>
                <td><Money value={data.totals.loan} /></td>
                <td><Money value={data.totals.received} /></td>
                <td><b><Money value={data.totals.balance} /></b></td>
                <td colSpan={12}></td>
              </tr>
            </tfoot>
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
    </>
  );
}

export function SubsidyReportPage() {
  const r = useReport('/reports/subsidy');
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  return (
    <>
      <FilterBar r={r}>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/subsidy' + qs(r), 'Subsidy_Report.xlsx')}>Export Excel</button>
      </FilterBar>
      {r.data.invoices.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Buyer</th><th>Chassis No.</th><th>Subsidy</th></tr></thead>
            <tbody>{r.data.invoices.map((i) => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.buyer_name}</td><td>{i.chassis_no}</td><td><Money value={i.subsidy_amount} /></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}><b>Total Subsidy</b></td><td><Money value={r.data.total_subsidy} /></td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function DealerLedgerView() {
  const [dealers, setDealers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [dealerId, setDealerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [summarySearch, setSummarySearch] = useState('');
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [error, setError] = useState('');

  const [saleForm, setSaleForm] = useState(null);
  const [receiptForm, setReceiptForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [financers, setFinancers] = useState([]);

  // No dealer selected yet: load the all-dealers balance summary.
  useEffect(() => {
    if (dealerId) return;
    get('/reports/ledger').then((d) => { setSummary(d.summary); setDealers(d.dealers); }).catch((e) => setError(e.message));
  }, [dealerId]);

  useEffect(() => { get('/masters/financer').then((d) => setFinancers(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const loadDetail = () => {
    if (!dealerId) { setData(null); return; }
    const q = new URLSearchParams({ dealer_id: dealerId, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    get(`/reports/ledger?${q}`).then(setData).catch((e) => setError(e.message));
  };
  // A dealer is selected: load their full statement.
  useEffect(loadDetail, [dealerId, from, to, search]);

  const openEventEdit = (e) => {
    setEditError('');
    if (e.record_type === 'sale' && e.record_id) {
      get(`/tax-invoices/${e.record_id}`).then(setSaleForm).catch((err) => setEditError(err.message));
    } else if (e.record_type === 'receipt' && e.record_id) {
      setReceiptForm({
        id: e.record_id, date: e.date, dealer_name: selectedName,
        credit_received: e.credit || 0, debit_paid: e.debit || 0,
        narration: (e.lines || [])[0] || '',
      });
    }
  };

  const saveSale = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      await put(`/tax-invoices/${saleForm.id}`, saleForm);
      setSaleForm(null);
      loadDetail();
    } catch (err) { setEditError(err.message); }
    setSaving(false);
  };

  const saveReceipt = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      await post('/day-book', receiptForm);
      setReceiptForm(null);
      loadDetail();
    } catch (err) { setEditError(err.message); }
    setSaving(false);
  };

  if (error) return <ErrorBanner message={error} />;

  const selectedName = dealers.find((d) => String(d.id) === String(dealerId))?.name || '';
  const filteredSummary = (summary || []).filter((s) => !summarySearch || (s.dealer_name || '').toLowerCase().includes(summarySearch.toLowerCase()));

  if (!dealerId) {
    return (
      <>
        <div className="toolbar">
          <Field label="Search Dealer" value={summarySearch} onChange={setSummarySearch} />
        </div>
        {!summary ? <div className="card">Loading…</div> : filteredSummary.length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Dealer</th><th>Balance</th></tr></thead>
              <tbody>
                {filteredSummary.map((s) => (
                  <tr key={s.dealer_id} onClick={() => setDealerId(String(s.dealer_id))} style={{ cursor: 'pointer' }} title="Click to view statement">
                    <td><b>{s.dealer_name}</b></td>
                    <td><b>{s.balance} {s.dc}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  const set = (f) => (v) => setSaleForm({ ...saleForm, [f]: v });
  const setR = (f) => (v) => setReceiptForm({ ...receiptForm, [f]: v });

  // Totals for the header summary boxes — computed from the full (unsorted,
  // ungrouped) event list for this date range, independent of the table's
  // current sort order. Closing balance is just the last chronological
  // event's running balance, since each row's Balance is already a running
  // total.
  const allEvents = data?.events || [];
  const totalDebit = allEvents.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
  const totalCredit = allEvents.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
  const lastEvent = allEvents[allEvents.length - 1];
  const closingBalanceText = lastEvent ? `${lastEvent.balance} ${lastEvent.dc}` : '—';


  const displayEvents = groupLedgerEvents(sortOrder === 'desc'
    // Stable sort by date descending only — same-date entries keep their
    // original (chronological) relative order instead of being flipped,
    // so the Balance column still reads as a sensible running total.
    ? [...(data?.events || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    : (data?.events || []));
  const toggleSort = () => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));

  // Sale rows (and their linked Hypothecation/direct-received CASH rows)
  // are tinted blue; Day Book receipts are tinted green — so the two kinds
  // of entries are visually distinct at a glance.
  const rowTint = (e) => (e.vr_type === 'S' ? 'rgba(63,126,219,.14)' : e.vr_type === 'E' ? 'rgba(239,159,39,.16)' : 'rgba(39,157,140,.16)');
  const groupBorder = '1.5px solid rgba(125,149,201,.8)';
  const groupRowStyle = (e) => ({
    cursor: e.record_type ? 'pointer' : 'default',
    background: rowTint(e),
    color: 'var(--ink)',
    borderLeft: e._groupSize > 1 ? groupBorder : undefined,
    borderRight: e._groupSize > 1 ? groupBorder : undefined,
    borderTop: e._groupSize > 1 && e._groupPos === 0 ? groupBorder : undefined,
    borderBottom: e._groupSize > 1 && e._groupPos === e._groupSize - 1 ? groupBorder : undefined,
  });

  return (
    <>
      <div className="toolbar">
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setDealerId(''); setSearch(''); }}>← Back to List</button>
        <Field label="Search" value={search} onChange={setSearch} />
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => window.print()}>Print</button>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
          onClick={() => downloadExcel(`/reports/ledger?${new URLSearchParams({ dealer_id: dealerId, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) })}`, `Ledger_${selectedName || 'Dealer'}.xlsx`)}>
          Export Excel
        </button>
      </div>
      <h3 style={{ margin: '4px 0 12px' }}>{selectedName}</h3>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 16 }}>
        <div className="card" style={{ boxShadow: 'none' }}>
          <div className="muted">Total Debit</div>
          <div className="metric"><Money value={totalDebit} /></div>
        </div>
        <div className="card" style={{ boxShadow: 'none' }}>
          <div className="muted">Total Credit</div>
          <div className="metric"><Money value={totalCredit} /></div>
        </div>
        <div className="card" style={{ boxShadow: 'none' }}>
          <div className="muted">Balance</div>
          <div className="metric">{closingBalanceText}</div>
        </div>
      </div>

      {!data ? <div className="card">Loading…</div> : data.events.length === 0 ? <EmptyState text="No transactions in this range." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th onClick={toggleSort} style={{ cursor: 'pointer' }} title="Click to sort by date">
                  Date {sortOrder === 'asc' ? '▲' : '▼'}
                </th>
                <th>Type</th><th>Doc No.</th><th>Particulars</th><th>Debit</th><th>Credit</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {displayEvents.map((e, i) => (
                <tr key={i} onClick={() => openEventEdit(e)}
                    style={groupRowStyle(e)}
                    title={e.record_type ? 'Click to edit' : ''}>
                  <td>{formatDate(e.date)}</td><td>{e.vr_type}</td>
                  {e._groupPos === 0 && <td rowSpan={e._groupSize}>{e.doc_no}</td>}
                  <td>{e.account} {e.lines?.length ? `— ${e.lines.join(', ')}` : ''}</td>
                  <td>{Number(e.debit) ? <Money value={e.debit} /> : 'NIL'}</td>
                  <td>{Number(e.credit) ? <Money value={e.credit} /> : 'NIL'}</td>
                  <td><b>{e.balance} {e.dc}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {saleForm && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveSale} style={{ maxWidth: 780 }}>
            <h2>Edit Sale — Bill No. {saleForm.bill_no}</h2>
            <ErrorBanner message={editError} />
            <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
              {saleForm.buyer_name} — {saleForm.product_name} — Chassis {saleForm.chassis_no}
            </p>
            {/* Only the "Internal" tab's fields are editable here — same set as
                step 1 of the Tax Invoice form. Bill No./Date/Buyer details/GST
                & tax fields (incl. GST Sale Amount, the taxable-value basis)/
                Remarks are shown elsewhere (Tax Invoice page) and are
                intentionally not editable from the Ledger.

                Amount Received is editable here for convenience, but has no
                bearing on this Ledger's Debit/Credit numbers -- those come
                from Sale Amount net of Hypothecation, credited only by
                manually-created Day Book vouchers. Amount Received is
                tracked separately in Ledger V. */}
            <div className="formgrid">
              <Field label="Sale Amount (Internal)" type="number" value={saleForm.sale_amount} onChange={set('sale_amount')} required />
              <Field label="Amount Received" type="number" value={saleForm.amount_received} onChange={set('amount_received')} />
              <Field label="Financer Name (Hypothecation)" type="combo" value={saleForm.financer_name}
                     options={financers.map((f) => ({ value: f.name, label: f.name }))}
                     onChange={set('financer_name')} />
              <Field label="Hypothecation Amount" type="number" value={saleForm.hypothecation_amount} onChange={set('hypothecation_amount')} />
              <div className="field">
                <label>Balance (Sale − Hypothecation)</label>
                <input value={((Number(saleForm.sale_amount) || 0) - (Number(saleForm.hypothecation_amount) || 0))
                         .toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} readOnly disabled />
              </div>
              <Field label="Vehicle Reg. No." value={saleForm.vehicle_reg_no} onChange={set('vehicle_reg_no')} />
              <Field label="Ledger No." value={saleForm.ledger_no} onChange={set('ledger_no')} />
              <Field label="Chassis Record No." value={saleForm.chassis_record_no} onChange={set('chassis_record_no')} />
              <Field label="Voucher No." value={saleForm.voucher_no} onChange={set('voucher_no')} />
              <Field label="Subsidy Amount" type="number" value={saleForm.subsidy_amount} onChange={set('subsidy_amount')} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setSaleForm(null)}>Cancel</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {receiptForm && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveReceipt}>
            <h2>Edit Day Book Entry</h2>
            <ErrorBanner message={editError} />
            <div className="formgrid">
              <Field label="Date" type="date" value={receiptForm.date} onChange={setR('date')} />
              <Field label="Dealer Name" value={receiptForm.dealer_name} onChange={setR('dealer_name')} required />
              <Field label="Credit Received" type="number" value={receiptForm.credit_received} onChange={setR('credit_received')} />
              <Field label="Debit Paid" type="number" value={receiptForm.debit_paid} onChange={setR('debit_paid')} />
              <Field label="Narration" value={receiptForm.narration} onChange={setR('narration')} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setReceiptForm(null)}>Cancel</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// Ledger: Dealer (existing) + Bank + Financer (Hypothecation) + Other party
export function LedgerPage() {
  const [type, setType] = useState('DEALER');
  const tabs = [['DEALER', 'Dealer'], ['FINANCER', 'Financer (Hypothecation)'], ['BANK', 'Bank'], ['OTHER', 'Other Party']];
  return (
    <div>
      <div className="actions" style={{ marginBottom: 14, flexWrap: 'wrap', display: 'flex', gap: 8 }}>
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (type === k ? ' primary' : '')} onClick={() => setType(k)}>{l} Ledger</button>)}
      </div>
      {type === 'DEALER' ? <DealerLedgerView /> : <PartyLedgerView key={type} type={type} />}
    </div>
  );
}

const toList = (d) => Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.items || []);
const ymd10 = (v) => String(v || '').slice(0, 10);
const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Bank & Cash Book — cash (day_book) + bank (bank_ledger_entry) ek hi report me.
// voucher = 'RECEIPT' | 'PAYMENT' -> Vouchers tab (F6 / F5): same Bank & Cash book, but header shows only that voucher's button
// and the list is limited to that kind. Without the prop it is the normal full Bank & Cash book.
export function DayBookPage({ voucher, payMode } = {}) {
  const [data,setData]=useState(null);           // /day-book
  const [bankData,setBankData]=useState(null);   // /bank-ledger
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [mode,setMode]=useState('');             // '' = All, 'CASH', ya bank ka naam
  const [kind,setKind]=useState('');             // '' | 'IN' | 'OUT'
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(50);
  const [sPage,setSPage]=useState(1);
  const [dealers,setDealers]=useState([]);
  const [financers,setFinancers]=useState([]);
  const [banks,setBanks]=useState([]);
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({});
  const [edit,setEdit]=useState(null);           // bank entry classify/edit
  const [error,setError]=useState('');
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState(false);
  const [matchResult,setMatchResult]=useState(null);
  const [matching,setMatching]=useState(false);
  const fileRef=useRef(null);

  const load=()=>{
    get('/day-book').then(setData).catch(e=>setError(e.message));
    get('/bank-ledger?status=all').then(setBankData).catch(()=>setBankData({rows:[]}));
  };
  useEffect(()=>{
    load();
    get('/dealers').then(d=>setDealers(d.dealers||[])).catch(()=>{});
    get('/masters/financer').then(d=>setFinancers(toList(d))).catch(()=>{});
    get('/masters/bank').then(d=>setBanks(toList(d))).catch(()=>{});
  },[]);

  const bankName=id=>banks.find(b=>String(b.id)===String(id))?.name||'';
  const bankRows=bankData?.rows||[];

  // ---- ek unified list: Day Book (cash / bank_id) + posted Bank Ledger entries ----
  const unified=[
    ...toList(data).map(r=>({
      key:'d'+r.id, src:'daybook', id:r.id, date:ymd10(r.date), no:r.vr_no==null?'':String(r.vr_no),
      party:r.dealer_name||'', narration:r.narration||'',
      receipt:Number(r.credit_received||0), payment:Number(r.debit_paid||0),
      bank:r.bank_id?(bankName(r.bank_id)||'Bank'):'Cash', raw:r,
    })),
    ...bankRows.filter(r=>r.status==='POSTED').map(r=>({
      key:'b'+r.id, src:'bank', id:r.id, date:ymd10(r.entry_date), no:'B-'+r.id,
      party:r.party_name||'',
      narration:[r.cheque_no&&('Chq '+r.cheque_no),r.upi_ref&&('UTR '+r.upi_ref),r.narration].filter(Boolean).join(' | '),
      receipt:r.entry_type==='RECEIPT'?Math.abs(Number(r.amount||0)):0,
      payment:r.entry_type==='PAYMENT'?Math.abs(Number(r.amount||0)):0,
      bank:r.bank_name||'Bank', raw:r,
    })),
  ];
  const suspense=bankRows.filter(r=>r.status==='SUSPENSE');

  const kindEff=voucher==='RECEIPT'?'IN':voucher==='PAYMENT'?'OUT':kind;
  const showIn=voucher!=='PAYMENT',showOut=voucher!=='RECEIPT';
  const q=search.trim().toLowerCase();
  const modeOk=b=>!mode||(mode==='CASH'?b==='Cash':b===mode);
  // payMode: 'cash' = sirf Cash entries (Cashier F6), 'bank' = sirf Bank entries (Vouchers F6).
  const limitOk=b=>payMode==='cash'?b==='Cash':payMode==='bank'?b!=='Cash':true;
  const inRange=d=>(!from||d>=from)&&(!to||d<=to);
  const rows=unified
    .filter(x=>modeOk(x.bank)&&limitOk(x.bank)&&inRange(x.date)&&(!kindEff||(kindEff==='IN'?x.receipt>0:x.payment>0))
      &&(!q||[x.no,x.party,x.narration,x.bank,x.receipt||'',x.payment||''].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>b.date.localeCompare(a.date)||(b.src===a.src?Number(b.id)-Number(a.id):(a.src==='bank'?1:-1)));
  const susShown=suspense.filter(r=>modeOk(r.bank_name||'Bank')&&inRange(ymd10(r.entry_date))&&(!q||[r.bank_name,r.cheque_no,r.upi_ref,r.narration,r.amount].join(' ').toLowerCase().includes(q)));
  useEffect(()=>{setPage(1);setSPage(1)},[from,to,mode,kindEff,search,pageSize]);
  const paged=rows.slice((page-1)*pageSize,page*pageSize);
  const susPaged=susShown.slice((sPage-1)*10,sPage*10);
  const totalIn=rows.reduce((s,x)=>s+x.receipt,0);
  const totalOut=rows.reduce((s,x)=>s+x.payment,0);
  const bankOptions=[...new Set([...banks.map(b=>b.name),...bankRows.map(r=>r.bank_name)].filter(Boolean))];

  // ---- Print / Export (filtered saari rows, sirf current page nahi) ----
  const rangeLabel=(from||to)?`${from?formatDate(from):'Start'} to ${to?formatDate(to):'Today'}`:'All dates';
  const printReport=()=>{
    const w=window.open('','_blank');if(!w)return;
    const body=rows.map(x=>`<tr><td>${escHtml(formatDate(x.date))}</td><td>${escHtml(x.no)}</td><td>${escHtml(x.party)}</td><td>${escHtml(x.narration)}</td><td>${escHtml(x.bank)}</td><td class="n">${x.receipt?inr(x.receipt):''}</td><td class="n">${x.payment?inr(x.payment):''}</td></tr>`).join('');
    w.document.write(`<html><head><title>Bank & Cash Book</title><style>body{font-family:Arial,sans-serif;font-size:11px;padding:16px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.n{text-align:right}tfoot td{font-weight:700}</style></head><body><h2>G.R.D. MOTORS — Bank &amp; Cash Book</h2><div>${escHtml(rangeLabel)} · ${escHtml(mode==='CASH'?'Cash only':mode||'Cash + Bank')}</div><table><thead><tr><th>Date</th><th>Vr. No.</th><th>Party</th><th>Narration</th><th>Bank / Cash</th><th>Receipt</th><th>Payment</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="5">Total (${rows.length} entries)</td><td class="n">${inr(totalIn)}</td><td class="n">${inr(totalOut)}</td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };
  const exportReport=async()=>{
    try{
      const XLSX=await import('xlsx');
      const aoa=[['Date','Vr. No.','Party','Narration','Bank / Cash','Receipt','Payment'],
        ...rows.map(x=>[formatDate(x.date),x.no,x.party,x.narration,x.bank,x.receipt||'',x.payment||'']),
        ['','','','','Total',totalIn,totalOut]];
      const ws=XLSX.utils.aoa_to_sheet(aoa),wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,'Bank & Cash Book');
      XLSX.writeFile(wb,'Bank_Cash_Book.xlsx');
    }catch(e){setError(e.message||'Export failed')}
  };

  // ---- Bank Excel template (headers backend ke import parser se match karte hain) ----
  const downloadTemplate=async()=>{
    try{
      const XLSX=await import('xlsx');
      const wb=XLSX.utils.book_new();
      const data=XLSX.utils.aoa_to_sheet([['Date','Bank Name','Cheque No','UPI Ref','Narration','Amount']]);
      data['!cols']=[{wch:14},{wch:26},{wch:16},{wch:26},{wch:40},{wch:14}];
      XLSX.utils.book_append_sheet(wb,data,'Bank Entries');
      const names=bankOptions.length?bankOptions:['(Bank Details master me bank add karein)'];
      const info=[
        ['BANK IMPORT TEMPLATE — INSTRUCTIONS'],[''],
        ['1. "Bank Entries" sheet me neeche apni entries bharein (header row na badlein).'],
        ['2. Date: dd-mm-yyyy (jaise 30-09-2026). Khali chhodne par aaj ki date lagegi.'],
        ['3. Bank Name: neeche di list ke naam se match hona chahiye (Bank Details master).'],
        ['4. Amount: sirf number (₹ / comma chalega). Receipt ya Payment baad me import ke baad "Classify" me chuna jayega.'],
        ['5. Cheque No aur UPI Ref optional hain. Same file dobara upload karne par duplicate skip ho jayenge.'],
        [''],['EXAMPLE ROW'],
        ['Date','Bank Name','Cheque No','UPI Ref','Narration','Amount'],
        ['30-09-2026',names[0],'','UTR123456789012','RTGS from ABC Motors',50000],
        [''],['VALID BANK NAMES'],
        ...names.map(n=>[n]),
      ];
      const ws=XLSX.utils.aoa_to_sheet(info);ws['!cols']=[{wch:60},{wch:26},{wch:16},{wch:22},{wch:30},{wch:12}];
      XLSX.utils.book_append_sheet(wb,ws,'Instructions');
      XLSX.writeFile(wb,'Bank_Import_Template.xlsx');
    }catch(e){setError(e.message||'Template download failed')}
  };

  // ---- Bank Excel import (pehle Bank Ledger page me tha) ----
  const importFile=async e=>{
    const f=e.target.files?.[0];e.target.value='';if(!f)return;
    setBusy(true);setError('');setMsg('');
    try{
      const XLSX=await import('xlsx');
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
      const rowsX=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:true});
      if(!rowsX.length)throw new Error('Import file is empty.');
      const r=await post('/bank-ledger/import',{rows:rowsX});
      setMsg(`${r.inserted||0} entries imported (Suspense me), ${r.duplicates||0} duplicates skipped, ${r.rejected_count||0} rejected.`+((r.rejected||[]).length?' Rejected: '+r.rejected.slice(0,10).map(x=>`row ${x.row} (${x.reason})`).join('; '):''));
      load();
    }catch(err){setError(err.message||'Import failed')}finally{setBusy(false)}
  };
  const saveBank=async()=>{
    if(!edit)return;
    setBusy(true);setError('');
    try{
      await post('/bank-ledger/update',edit);
      setEdit(null);setMsg(edit.status==='POSTED'?'Entry posted.':'Entry updated.');load();
    }catch(err){setError(err.message||'Could not update entry')}finally{setBusy(false)}
  };
  const openBankEdit=r=>setEdit({id:r.id,bank_name:r.bank_name,amount:r.amount,party_name:r.party_name||'',narration:r.narration||'',entry_type:r.entry_type==='PAYMENT'?'PAYMENT':'RECEIPT',status:r.status==='SUSPENSE'?'POSTED':r.status,_was:r.status});

  // ---- Day Book (cash) entry form: Party Type = Dealer / Financer / Other ----
  const partyTypeOf=name=>{
    if(!name)return 'DEALER';
    if(dealers.some(d=>d.name===name))return 'DEALER';
    if(financers.some(f=>f.name===name))return 'FINANCER';
    return 'OTHER';
  };
  const openNew=(kind)=>{setForm({date:to||new Date().toISOString().slice(0,10),vr_no:data?.next_vr_no,party_type:'DEALER',kind});setError('');setOpen(true)};
  const onRow=x=>{
    if(x.src==='bank'){openBankEdit(x.raw);return;}
    const cr=Number(x.raw.credit_received||0),dr=Number(x.raw.debit_paid||0);
    setError('');setForm({...x.raw,date:ymd10(x.raw.date),party_type:partyTypeOf(x.raw.dealer_name),kind:cr>0&&dr>0?'BOTH':dr>0?'PAYMENT':'RECEIPT'});setOpen(true);
  };
  const save=async e=>{
    e.preventDefault();
    if(!String(form.dealer_name||'').trim()){setError('Party ka naam select/likhna zaroori hai.');return;}
    const {party_type,kind,...payload}=form;
    if(payMode==='cash')payload.bank_id=null;
    if(payMode==='bank'&&!payload.bank_id){setError('Bank select karna zaroori hai (is voucher me Cash nahi hota).');return;}
    if(kind==='RECEIPT'){payload.debit_paid=0;if(!(Number(payload.credit_received)>0)){setError('Receipt amount daalein.');return;}}
    if(kind==='PAYMENT'){payload.credit_received=0;if(!(Number(payload.debit_paid)>0)){setError('Payment amount daalein.');return;}}
    try{
      await post('/day-book',payload);setOpen(false);setError('');load();
    }catch(e){setError(e.message)}
  };
  const remove=async()=>{if(!form.id)return;if(!window.confirm('Delete this entry?'))return;try{await del('/day-book/'+form.id);setOpen(false);load()}catch(e){setError(e.message)}};
  const runAutoMatch=async()=>{setMatching(true);setMatchResult(null);try{const res=await post('/day-book/auto-match',{});setMatchResult(res);load()}catch(e){setError(e.message)}finally{setMatching(false)}};
  const setPT=v=>setForm({...form,party_type:v,dealer_name:''});

  if(!data)return (
    <div className="card">
      {error ? (
        <>
          <b>Bank & Cash Book load failed</b>
          <div style={{ marginTop: 8, color: 'var(--red)' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(); }}>Retry</button>
        </>
      ) : 'Loading…'}
    </div>
  );

  const tag=(b)=><span style={{display:'inline-block',padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:700,border:'1px solid var(--line)',background:b==='Cash'?'color-mix(in srgb, var(--accent) 12%, var(--card))':'transparent',color:'var(--ink)'}}>{b}</span>;
  const kpi={flex:'1 1 200px'};
  return <div>
    <div className="pageHeader">
      <div><h1>{voucher==='RECEIPT'?'Receipt Voucher'+(payMode==='cash'?' — Cash':payMode==='bank'?' — Bank':''):voucher==='PAYMENT'?'Payment Voucher':'Bank & Cash Book'}</h1><p className="muted">{voucher?'G.R.D. Motors · '+(voucher==='RECEIPT'?'paisa aaya ('+(payMode==='cash'?'sirf Cash':payMode==='bank'?'sirf Bank':'Cash / Bank')+') — naya Receipt yahin se banaye':'paisa gaya (Cash / Bank) — naya Payment yahin se banaye'):'G.R.D. Motors · saari receipts aur payments (Cash + Bank) ek jagah'}</p></div>
      <div className="actions" style={{flexWrap:'wrap'}}>
        {showIn&&<button className="btn primary" onClick={()=>openNew('RECEIPT')}>+ Receipt</button>}
        {showOut&&<button className="btn" onClick={()=>openNew('PAYMENT')} style={{borderColor:'var(--red)',color:'var(--red)',fontWeight:700}}>+ Payment</button>}
        {!voucher&&<>
        <button className="btn" onClick={downloadTemplate}>⇩ Excel Template</button>
        <button className="btn" onClick={()=>fileRef.current?.click()} disabled={busy}>{busy?'Processing…':'Import Bank Excel'}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importFile}/>
        <button className="btn" onClick={runAutoMatch} disabled={matching}>{matching?'Fixing…':'Fix Old Entries for Ledger'}</button>
        </>}
      </div>
    </div>
    {matchResult&&<div className="card" style={{marginBottom:12}}>
      <b>Fixed {matchResult.fixed.length} old entr{matchResult.fixed.length===1?'y':'ies'}</b>.
      {matchResult.unresolved.length>0&&<span className="muted"> {matchResult.unresolved.length} entries still need manual review.</span>}
    </div>}
    {msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    {!voucher&&<div className="muted" style={{marginBottom:10,fontSize:12}}>Bank Excel columns: <b>Date, Bank Name, Cheque No, UPI Ref, Narration, Amount</b> — "Excel Template" button se sahi format download karein.</div>}
    <ErrorBanner message={!open&&!edit?error:''}/>

    <div className="toolbar">
      <Field label="From" type="date" value={from} onChange={setFrom}/>
      <Field label="To" type="date" value={to} onChange={setTo}/>
      {payMode!=='cash'&&<Field label={payMode==='bank'?'Bank':'Bank / Cash'} type="select" value={mode} options={[{value:'',label:payMode==='bank'?'All Banks':'All (Cash + Bank)'},...(payMode==='bank'?[]:[{value:'CASH',label:'Cash only'}]),...bankOptions.map(n=>({value:n,label:n}))]} onChange={setMode}/>}
      {!voucher&&<Field label="Type" type="select" value={kind} options={[{value:'',label:'Receipts + Payments'},{value:'IN',label:'Receipts only'},{value:'OUT',label:'Payments only'}]} onChange={setKind}/>}
      <Field label="Search" value={search} onChange={setSearch}/>
      <button className="btn" style={{alignSelf:'flex-end'}} onClick={()=>{setFrom('');setTo('');setMode('');setKind('');setSearch('')}}>Clear</button>
      <button className="btn" style={{alignSelf:'flex-end'}} onClick={printReport}>Print</button>
      <button className="btn primary" style={{alignSelf:'flex-end'}} onClick={exportReport}>Export Excel</button>
    </div>

    <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'12px 0'}}>
      {showIn&&<div className="card" style={kpi}><div className="muted">Total Receipts (In)</div><div className="metric" style={{color:'var(--green)',fontSize:22}}>₹{inr(totalIn)}</div></div>}
      {showOut&&<div className="card" style={kpi}><div className="muted">Total Payments (Out)</div><div className="metric" style={{color:'var(--red)',fontSize:22}}>₹{inr(totalOut)}</div></div>}
      <div className="card" style={kpi}><div className="muted">Entries</div><div className="metric" style={{fontSize:22}}>{rows.length}</div></div>
    </div>

    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Date</th><th>Vr. No.</th><th>Party / Particulars</th><th>Narration</th><th>Bank / Cash</th>{showIn&&<th style={{textAlign:'right'}}>Receipt</th>}{showOut&&<th style={{textAlign:'right'}}>Payment</th>}</tr></thead>
        <tbody>
          {paged.map(x=><tr key={x.key} onClick={()=>onRow(x)} style={{cursor:'pointer'}} title={x.src==='bank'?'Bank entry — click to edit':'Click to edit'}>
            <td style={{whiteSpace:'nowrap'}}>{formatDate(x.date)}</td><td>{x.no||'—'}</td><td><b>{x.party||'—'}</b></td><td>{x.narration||'—'}</td><td>{tag(x.bank)}</td>
            {showIn&&<td style={{textAlign:'right',fontWeight:700,color:'var(--green)'}}>{x.receipt?inr(x.receipt):''}</td>}
            {showOut&&<td style={{textAlign:'right',fontWeight:700,color:'var(--red)'}}>{x.payment?inr(x.payment):''}</td>}
          </tr>)}
          {!rows.length&&<tr><td colSpan={voucher?6:7} className="muted" style={{textAlign:'center'}}>No entries found.</td></tr>}
        </tbody>
        {rows.length>0&&<tfoot><tr><td colSpan={5} style={{fontWeight:800}}>Total ({rows.length} entries)</td>{showIn&&<td style={{textAlign:'right',fontWeight:800}}>{inr(totalIn)}</td>}{showOut&&<td style={{textAlign:'right',fontWeight:800}}>{inr(totalOut)}</td>}</tr></tfoot>}
      </table>
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize}/>
    </div>

    {!voucher&&susShown.length>0&&<div className="card" style={{marginTop:16}}>
      <h3 style={{margin:0}}>Other / Unclassified Bank Entries ({susShown.length})</h3>
      <div className="muted">Bank Excel se aayi entries jo abhi Receipt/Payment classify nahi hui. "Classify" karte hi upar Bank &amp; Cash Book me aa jayengi (totals me tab judti hain).</div>
      <div className="tablewrap" style={{marginTop:10}}>
        <table className="table"><thead><tr><th>Date</th><th>Bank</th><th>Cheque / UTR</th><th>Narration</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr></thead>
          <tbody>{susPaged.map(r=><tr key={r.id} style={{background:'color-mix(in srgb, var(--orange) 12%, var(--card))'}}>
            <td>{formatDate(r.entry_date)}</td><td><b>{r.bank_name}</b></td><td>{[r.cheque_no,r.upi_ref].filter(Boolean).join(' / ')||'—'}</td><td>{r.narration||'—'}</td>
            <td style={{textAlign:'right',fontWeight:700}}>{inr(Math.abs(Number(r.amount||0)))}</td>
            <td><button className="btn" onClick={()=>openBankEdit(r)}>Classify</button></td></tr>)}</tbody>
        </table>
        <Pagination page={sPage} pageSize={10} total={susShown.length} onPage={setSPage} onPageSize={()=>{}} sizes={[10]}/>
      </div>
    </div>}

    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{form.id?'Edit ':'New '}{form.kind==='PAYMENT'?'Payment':form.kind==='RECEIPT'?'Receipt':'Entry'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
        <Field label="Party Type" type="select" value={form.party_type||'DEALER'} options={[{value:'DEALER',label:'Dealer'},{value:'FINANCER',label:'Financer (Hypothecation)'},{value:'OTHER',label:'Other'}]} onChange={setPT}/>
        {(form.party_type||'DEALER')==='DEALER'&&<Field label="Dealer Name" type="select" value={form.dealer_name} options={[{value:'',label:'Select Dealer'},...dealers.map(d=>({value:d.name,label:d.name}))]} onChange={v=>setForm({...form,dealer_name:v})} required/>}
        {form.party_type==='FINANCER'&&<Field label="Financer Name" type="select" value={form.dealer_name} options={[{value:'',label:'Select Financer'},...financers.map(f=>({value:f.name,label:f.name}))]} onChange={v=>setForm({...form,dealer_name:v})} required/>}
        {form.party_type==='OTHER'&&<Field label="Other Party Name" value={form.dealer_name} onChange={v=>setForm({...form,dealer_name:v})} required/>}
        {payMode==='cash'
          ?<Field label="Mode" value="Cash" readOnly/>
          :<Field label={payMode==='bank'?'Bank':'Bank (khali = Cash)'} type="select" value={form.bank_id||''} options={[{value:'',label:payMode==='bank'?'Select Bank':'Cash (No Bank)'},...banks.map(b=>({value:b.id,label:`${b.name}${b.account_no?` — ${b.account_no}`:''}`}))]} onChange={v=>setForm({...form,bank_id:v||null})} required={payMode==='bank'}/>}
        {form.kind!=='PAYMENT'&&<Field label="Receipt Amount (Credit Received)" type="number" value={form.credit_received} onChange={v=>setForm({...form,credit_received:v})} required={form.kind==='RECEIPT'}/>}
        {form.kind!=='RECEIPT'&&<Field label="Payment Amount (Debit Paid)" type="number" value={form.debit_paid} onChange={v=>setForm({...form,debit_paid:v})} required={form.kind==='PAYMENT'}/>}
        <Field label="Narration" value={form.narration} onChange={v=>setForm({...form,narration:v})}/>
      </div>
      <div className="actions" style={{marginTop:18,justifyContent:form.id?'space-between':'flex-end',display:'flex'}}>
        {form.id?<button type="button" className="btn danger" onClick={remove}>Delete</button>:<span/>}
        <div style={{display:'flex',gap:8}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary">Save</button></div>
      </div>
    </form></div>}

    {edit&&<div className="modal"><div className="modalbox">
      <h2>{edit._was==='SUSPENSE'?'Classify Bank Entry':'Edit Bank Entry'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Bank" value={edit.bank_name} readOnly/>
        <Field label="Amount" value={inr(Math.abs(Number(edit.amount||0)))} readOnly/>
        <Field label="Direction" type="select" value={edit.entry_type} options={[{value:'RECEIPT',label:'Receipt (paisa aaya)'},{value:'PAYMENT',label:'Payment (paisa gaya)'}]} onChange={v=>setEdit({...edit,entry_type:v})}/>
        <Field label="Party / From-To" value={edit.party_name} onChange={v=>setEdit({...edit,party_name:v})}/>
        <Field label="Narration" value={edit.narration} onChange={v=>setEdit({...edit,narration:v})}/>
        <Field label="Status" type="select" value={edit.status} options={[{value:'POSTED',label:'Posted'},{value:'SUSPENSE',label:'Back to Suspense'},{value:'CANCELLED',label:'Cancelled'}]} onChange={v=>setEdit({...edit,status:v})}/>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14,display:'flex',gap:8}}><button className="btn" onClick={()=>{setEdit(null);setError('')}}>Close</button><button className="btn primary" onClick={saveBank} disabled={busy}>{busy?'Saving…':'Save'}</button></div>
    </div></div>}
  </div>;
}

export function LedgerVPage() {
  // Ledger V — reconciliation of Day Book receipts against the "Amount
  // Received" field entered directly on Tax Invoices, per dealer. Same
  // summary → dealer-detail shape as W. Ledger, but a narrower, read-only
  // event set (see the backend's _ledger_v_events_for_dealer for what's
  // included and why sale/hypothecation are left out here).
  const [dealers, setDealers] = useState([]);
  const [dealerId, setDealerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState(null);
  const [summarySearch, setSummarySearch] = useState('');
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [vSort, setVSort] = useState({ key: '', dir: 'asc' });
  const toggleV = (key) => setVSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const vArrow = (key) => (vSort.key === key ? (vSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
  const vEvents = (() => {
    const ev = data?.events || [];
    if (!vSort.key) return ev;
    const num = (x) => Number(x) || 0;
    const val = (e) => (['receipt', 'amount_received', 'balance'].includes(vSort.key) ? num(e[vSort.key]) : vSort.key === 'date' ? String(e.date || '').slice(0, 10) : String(e[vSort.key] ?? '').toLowerCase());
    return ev.map((e, i) => [e, i]).sort((a, b) => {
      const x = val(a[0]), y = val(b[0]);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (c || a[1] - b[1]) * (vSort.dir === 'asc' ? 1 : -1);
    }).map((p) => p[0]);
  })();

  useEffect(() => {
    if (dealerId) return;
    get('/reports/ledger-v').then((d) => { setSummary(d.summary); setDealers(d.dealers); }).catch((e) => setError(e.message));
  }, [dealerId]);

  useEffect(() => {
    if (!dealerId) { setData(null); return; }
    const q = new URLSearchParams({ dealer_id: dealerId, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    get(`/reports/ledger-v?${q}`).then(setData).catch((e) => setError(e.message));
  }, [dealerId, from, to, search]);

  if (error) return <ErrorBanner message={error} />;

  const selectedName = dealers.find((d) => String(d.id) === String(dealerId))?.name || '';
  const filteredSummary = (summary || []).filter((s) => !summarySearch || (s.dealer_name || '').toLowerCase().includes(summarySearch.toLowerCase()));

  if (!dealerId) {
    return (
      <>
        <div className="toolbar">
          <Field label="Search Dealer" value={summarySearch} onChange={setSummarySearch} />
        </div>
        {!summary ? <div className="card">Loading…</div> : filteredSummary.length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Dealer</th><th>Total Received (Adjusted)</th><th>Balance</th></tr></thead>
              <tbody>
                {filteredSummary.map((s) => (
                  <tr key={s.dealer_id} onClick={() => setDealerId(String(s.dealer_id))} style={{ cursor: 'pointer' }} title="Click to view statement">
                    <td><b>{s.dealer_name}</b></td>
                    <td><b><Money value={s.total} /></b></td><td><b><Money value={Math.abs(Number(s.balance) || 0)} /> {Number(s.balance) >= 0 ? 'Cr' : 'Dr'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setDealerId(''); setSearch(''); }}>← Back to List</button>
        <Field label="Search" value={search} onChange={setSearch} />
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => window.print()}>Print</button>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
          onClick={() => downloadExcel(`/reports/ledger-v?${new URLSearchParams({ dealer_id: dealerId, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) })}`, `Ledger_V_${selectedName || 'Dealer'}.xlsx`)}>
          Export Excel
        </button>
      </div>
      <h3 style={{ margin: '4px 0 12px' }}>{selectedName}</h3>
      {!data ? <div className="card">Loading…</div> : data.events.length === 0 ? <EmptyState text="No transactions in this range." /> : (
        <div className="tablewrap">
          <table className="table" data-nosort>
            <thead>
              <tr>
                <th onClick={() => toggleV('date')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Date{vArrow('date')}</th><th onClick={() => toggleV('doc_no')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Doc No.{vArrow('doc_no')}</th><th onClick={() => toggleV('particulars')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Particulars{vArrow('particulars')}</th><th onClick={() => toggleV('voucher_no')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Voucher No.{vArrow('voucher_no')}</th><th onClick={() => toggleV('bill_no')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Bill No.{vArrow('bill_no')}</th><th onClick={() => toggleV('chassis_no')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Chassis No.{vArrow('chassis_no')}</th><th onClick={() => toggleV('customer')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Customer{vArrow('customer')}</th><th onClick={() => toggleV('receipt')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Receipt / Cash (Credit){vArrow('receipt')}</th><th onClick={() => toggleV('amount_received')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Received Amount (Adjusted - Debit){vArrow('amount_received')}</th><th onClick={() => toggleV('balance')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Balance{vArrow('balance')}</th>
              </tr>
            </thead>
            <tbody>
              {vEvents.map((e, i) => (
                <tr key={i}>
                  <td>{formatDate(e.date)}</td><td>{e.doc_no}</td><td>{e.particulars}</td>
                  <td>{e.voucher_no}</td><td>{e.bill_no}</td><td>{e.chassis_no}</td><td>{e.customer}</td>
                  <td>{e.receipt ? <Money value={e.receipt} /> : ''}</td>
                  <td>{e.amount_received ? <Money value={e.amount_received} /> : ''}</td>
                  <td><b><Money value={Math.abs(Number(e.balance) || 0)} /> {Number(e.balance) >= 0 ? 'Cr' : 'Dr'}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function VehicleNoRegisterPage() {
  const r = useReport('/vehicle-no-register');
  // Every row has its own always-visible box. An empty row is open for typing / pasting. As soon as a value is
  // pasted (or Enter / leaving the box) it is saved and the box locks; only the Edit button unlocks it again.
  const [drafts, setDrafts] = useState({});      // id -> text being typed
  const [unlocked, setUnlocked] = useState({});  // id -> true while a saved value is being edited
  const [saved, setSaved] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading...</div>;
  const rows = r.data.rows || [];
  const regOf = (i) => (saved[i.id] !== undefined ? saved[i.id] : i.vehicle_reg_no) || '';
  const isLocked = (i) => !!regOf(i) && !unlocked[i.id];
  const norm = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
  const setDraft = (id, v) => setDrafts((d) => ({ ...d, [id]: v }));
  const save = async (i, value) => {
    const val = norm(value);
    if (!val || val === regOf(i)) { setUnlocked((u) => ({ ...u, [i.id]: false })); setDrafts((d) => { const n = { ...d }; delete n[i.id]; return n; }); return; }
    setBusyId(i.id); setErr('');
    try {
      const res = await put(`/vehicle-no-register/${i.id}`, { vehicle_reg_no: val });
      setSaved((s) => ({ ...s, [i.id]: res?.row?.vehicle_reg_no ?? val }));
      setUnlocked((u) => ({ ...u, [i.id]: false }));
      setDrafts((d) => { const n = { ...d }; delete n[i.id]; return n; });
    } catch (e) { setErr(e.message); } finally { setBusyId(null); }
  };
  const startEdit = (i) => { setErr(''); setDraft(i.id, regOf(i)); setUnlocked((u) => ({ ...u, [i.id]: true })); };
  const cancelEdit = (i) => { setUnlocked((u) => ({ ...u, [i.id]: false })); setDrafts((d) => { const n = { ...d }; delete n[i.id]; return n; }); };
  return (
    <>
      <FilterBar r={r} />
      <ErrorBanner message={err} />
      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Customer Name</th><th>Chassis No.</th><th>Dealer</th><th>Model</th><th>Vehicle No.</th><th style={{ width: 150 }}>Action</th></tr></thead>
            <tbody>{rows.map((i) => {
              const locked = isLocked(i), busy = busyId === i.id;
              return (
              <tr key={i.id}>
                <td>{formatDate(i.date)}</td>
                <td>{i.bill_no}</td>
                <td>{i.buyer_name || '--'}</td>
                <td>{i.chassis_no || '--'}</td>
                <td>{i.dealer_name || '--'}</td>
                <td>{i.product_name || '--'}</td>
                <td>
                  <input className="input" style={{ maxWidth: 190, ...(locked ? { background: '#f2f4f7', color: '#475467' } : {}) }}
                    value={locked ? regOf(i) : (drafts[i.id] ?? regOf(i))}
                    disabled={locked || busy}
                    placeholder="Paste vehicle no. e.g. DL5ERB0160"
                    autoFocus={!!unlocked[i.id]}
                    onChange={(e) => setDraft(i.id, e.target.value.toUpperCase())}
                    onPaste={(e) => {
                      const text = (e.clipboardData || window.clipboardData).getData('text');
                      if (!norm(text)) return;
                      e.preventDefault();
                      setDraft(i.id, norm(text));
                      save(i, text);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(i, drafts[i.id] ?? regOf(i)); if (e.key === 'Escape' && unlocked[i.id]) cancelEdit(i); }}
                    onBlur={() => { if (!regOf(i) && drafts[i.id] !== undefined && norm(drafts[i.id]) && !busy) save(i, drafts[i.id]); }} />
                </td>
                <td>{locked
                  ? <button className="btn" onClick={() => startEdit(i)}>Edit</button>
                  : (regOf(i)
                      ? <><button className="btn primary" disabled={busy} onClick={() => save(i, drafts[i.id] ?? regOf(i))}>{busy ? 'Saving...' : 'Save'}</button>{' '}<button className="btn" disabled={busy} onClick={() => cancelEdit(i)}>Cancel</button></>
                      : <span className="muted">{busy ? 'Saving...' : 'Paste to save'}</span>)}</td>
              </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={8}><b>{rows.length}</b> records</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

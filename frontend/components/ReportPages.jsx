'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del, downloadExcel } from '../lib/api';
import { EmptyState, ErrorBanner, Field, Money } from './ui';
import { formatDate } from '../lib/date';
import { DeliveryChallanPrintView } from './PrintDocs';
import { DayBookPreview } from './DayBookPreview';

function useReport(path, extraParams = {}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState(extraParams);

  useEffect(() => {
    const q = new URLSearchParams({
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}), ...extra,
    });
    get(`${path}?${q}`).then(setData).catch((e) => setError(e.message));
  }, [path, from, to, search, JSON.stringify(extra)]);

  return { from, setFrom, to, setTo, search, setSearch, data, error, extra, setExtra };
}

function FilterBar({ r, showSearch = true, children }) {
  return (
    <div className="toolbar">
      <Field label="From" type="date" value={r.from} onChange={r.setFrom} />
      <Field label="To" type="date" value={r.to} onChange={r.setTo} />
      {showSearch && <Field label="Search" value={r.search} onChange={r.setSearch} />}
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
            <thead><tr><th>Date</th><th>Bill No.</th><th>Party</th><th>Items</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {r.data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td><b>{row.bill_no}</b></td>
                  <td>{row.party_name}</td>
                  <td>{row.item_count}</td>
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
              <td colSpan={4}><b>Current Page Totals</b></td>
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
  const setStatus = (status) => r.setExtra({ ...r.extra, status, page: 1 });
  const goPage = (page) => r.setExtra({ ...r.extra, page });

  return (
    <>
      <FilterBar r={r}>
        <div className="actions" style={{ alignSelf: 'flex-end', gap: 6 }}>
          <button className={`btn ${r.extra.status === 'all' ? 'primary' : ''}`} onClick={() => setStatus('all')}>All</button>
          <button className={`btn ${r.extra.status === 'delivered' ? 'primary' : ''}`} onClick={() => setStatus('delivered')}>Delivered</button>
          <button className={`btn ${r.extra.status === 'factory' ? 'primary' : ''}`} onClick={() => setStatus('factory')}>In Factory Stock</button>
        </div>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
                onClick={() => downloadExcel('/reports/production-register' + qs(r) + `&status=${r.extra.status}&export=csv`, 'Production_Register.xlsx')}>
          Export Excel
        </button>
      </FilterBar>

      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Product</th><th>Qty</th><th>Chassis No.</th><th>Motor No.</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((v) => {
              const status = v.stage || 'In Factory Stock';
              return <tr key={v.id}>
                <td>{formatDate(v.date)}</td><td>{v.vou_no}</td><td>{v.product_name}</td><td>{v.quantity}</td>
                <td>{v.chassis_no}</td><td>{v.motor_no}</td><td>{status}</td>
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
  useEffect(() => { get('/masters/colour').then((x) => setColourMasters(x || [])).catch(() => {}); }, []);
  const [editRow, setEditRow] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [printId, setPrintId] = useState(null);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ product: 'ALL', dealer: 'ALL', salesman: 'ALL', battery: 'ALL' });
  const [draftFilters, setDraftFilters] = useState(filters);


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
      </FilterBar>

      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Challan No.</th><th>Party Name</th>
                <th>Chassis No.</th><th>Colour</th><th>Other</th>
                <th>Sale Bill No.</th><th>Sale Value</th><th>Salesman</th>
                <th>Battery Make</th><th>Battery No. 1</th><th>Battery No. 2</th><th>Battery No. 3</th><th>Battery No. 4</th>
                <th>Remarks (1)</th><th>Remarks (2)</th><th></th>
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
                  <td><span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                    <span style={{width:22,height:14,borderRadius:4,border:'1px solid var(--border)',background:colourPreview(c.colour)||'transparent'}} />
                    {c.colour||'—'}
                  </span></td>
                  <td>{c.other}</td>
                  <td>{c.bill_no || '—'}</td>
                  <td>{c.sale_value ? <Money value={c.sale_value} /> : ''}</td>
                  <td>{c.salesman}</td>
                  <td>{c.battery_maker}</td><td>{c.battery_no1}</td><td>{c.battery_no2}</td><td>{c.battery_no3}</td><td>{c.battery_no4}</td>
                  <td>{c.remarks1}</td><td>{c.remarks2}</td>
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
                     options={['ALL', ...(filterOptions.dealer || [])]}
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
            <thead><tr><th>Date</th><th>Bill No.</th><th>Buyer</th><th>Product</th><th>Taxable</th><th>Tax</th><th>Total</th></tr></thead>
            <tbody>
              {r.data.invoices.map((i) => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.buyer_name}</td><td>{i.product_name}</td><td><Money value={i.taxable_value} /></td><td><Money value={i.tax_amount} /></td><td><Money value={i.bill_total} /></td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4}><b>All matching totals</b></td><td><Money value={r.data.totals.taxable} /></td><td><Money value={r.data.totals.tax} /></td><td><Money value={r.data.totals.total} /></td></tr></tfoot>
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

export function HypothecationRegisterPage() {
  const r = useReport('/reports/hypothecation-register');
  if (r.error) return <ErrorBanner message={r.error} />;
  if (!r.data) return <div className="card">Loading…</div>;
  return (
    <>
      <FilterBar r={r}>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => downloadExcel('/reports/hypothecation-register' + qs(r), 'Hypothecation_Register.xlsx')}>Export Excel</button>
      </FilterBar>
      {r.data.invoices.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Bill No.</th><th>Dealer</th><th>Buyer</th><th>Chassis No.</th><th>Financer</th><th>Loan / Hyp.</th><th>Received</th><th>Balance</th></tr></thead>
            <tbody>{r.data.invoices.map((i) => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.dealer_name||'—'}</td><td>{i.buyer_name||'—'}</td><td>{i.chassis_no||'—'}</td><td>{i.financer_name||'—'}</td><td><Money value={i.hypothecation_amount} /></td><td><Money value={i.amount_received} /></td><td><b><Money value={i.balance_amount} /></b></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={6}><b>Total Hypothecation</b></td><td><Money value={r.data.total_hyp} /></td><td colSpan={2}></td></tr></tfoot>
          </table>
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

export function LedgerPage() {
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
  const rowTint = (e) => (e.vr_type === 'S' ? '#eef4ff' : '#eafaf1');
  const groupBorder = '1.5px solid #7d95c9';
  const groupRowStyle = (e) => ({
    cursor: e.record_type ? 'pointer' : 'default',
    background: rowTint(e),
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

export function DayBookPage() {
  const [data,setData]=useState(null);
  const [selectedDate,setSelectedDate]=useState(new Date().toISOString().slice(0,10));
  const [dealers,setDealers]=useState([]);
  const [banks,setBanks]=useState([]);
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({});
  const [error,setError]=useState('');
  const [matchResult,setMatchResult]=useState(null);
  const [matching,setMatching]=useState(false);

  const load=()=>get('/day-book').then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[])).catch(()=>{});get('/masters/bank').then(d=>setBanks(d||[])).catch(()=>{});},[]);

  const entries=data?.entries||[];
  const dayEntries=entries.filter(r=>String(r.date||'').slice(0,10)===selectedDate);
  const priorEntries=entries.filter(r=>String(r.date||'').slice(0,10)<selectedDate);
  const receipts=dayEntries.filter(r=>Number(r.credit_received||0)>0).map(r=>({
    id:r.id,no:r.vr_no,date:r.date,particulars:[r.dealer_name,r.narration].filter(Boolean).join(' - ')||'Receipt',
    folio:r.folio||r.page_no||'',amount:r.credit_received
  }));
  const payments=dayEntries.filter(r=>Number(r.debit_paid||0)>0).map(r=>({
    id:r.id,no:r.vr_no,date:r.date,particulars:[r.dealer_name,r.narration].filter(Boolean).join(' - ')||'Payment',
    folio:r.folio||r.page_no||'',amount:r.debit_paid
  }));
  const opening=priorEntries.reduce((s,r)=>s+Number(r.credit_received||0)-Number(r.debit_paid||0),0);
  const totalReceipts=receipts.reduce((s,r)=>s+Number(r.amount||0),0);
  const totalPayments=payments.reduce((s,r)=>s+Number(r.amount||0),0);
  const closing=opening+totalReceipts-totalPayments;

  const moveDay=(delta)=>{
    const x=new Date(selectedDate+'T00:00:00');x.setDate(x.getDate()+delta);setSelectedDate(x.toISOString().slice(0,10));
  };
  const openNew=()=>{setForm({date:selectedDate,vr_no:data?.next_vr_no});setOpen(true)};
  const openEdit=r=>{setForm({...r});setOpen(true)};
  const save=async e=>{e.preventDefault();try{await post('/day-book',form);setOpen(false);load()}catch(e){setError(e.message)}};
  const remove=async()=>{if(!form.id)return;if(!window.confirm('Delete this entry?'))return;try{await del('/day-book/'+form.id);setOpen(false);load()}catch(e){setError(e.message)}};
  const runAutoMatch=async()=>{setMatching(true);setMatchResult(null);try{const res=await post('/day-book/auto-match',{});setMatchResult(res);load()}catch(e){setError(e.message)}finally{setMatching(false)}};

  if(!data)return (
    <div className="card">
      {error ? (
        <>
          <b>Day Book load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </>
      ) : 'Loading…'}
    </div>
  );
  return <div>
    <div className="actions" style={{marginBottom:12,flexWrap:'wrap'}}>
      <button className="btn primary" onClick={openNew}>+ New Entry</button>
      <button className="btn" onClick={runAutoMatch} disabled={matching}>{matching?'Fixing…':'Fix Old Entries for Ledger'}</button>
    </div>
    {matchResult&&<div className="card" style={{marginBottom:12}}>
      <b>Fixed {matchResult.fixed.length} old entr{matchResult.fixed.length===1?'y':'ies'}</b>.
      {matchResult.unresolved.length>0&&<span className="muted"> {matchResult.unresolved.length} entries still need manual review.</span>}
    </div>}
    <ErrorBanner message={!open?error:''}/>
    <DayBookPreview
      date={selectedDate}
      dealerLabel="ADMIN · ALL BRANCHES"
      receipts={receipts}
      payments={payments}
      openingBalance={opening}
      closingBalance={closing}
      onDateChange={setSelectedDate}
      onPrev={()=>moveDay(-1)}
      onNext={()=>moveDay(1)}
      onPrint={()=>window.print()}
      onExport={()=>downloadExcel('/day-book','Day_Book.xlsx')}
    />
    <div className="card" style={{marginTop:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div><h3 style={{margin:0}}>Day Book Entries</h3><div className="muted">Admin entry register · {selectedDate}</div></div>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <div className="tablewrap" style={{marginTop:10}}>
        <table className="table"><thead><tr><th>Date</th><th>Vr. No.</th><th>Dealer</th><th>Credit</th><th>Debit</th><th>Narration</th></tr></thead>
          <tbody>{dayEntries.map(r=><tr key={r.id} onClick={()=>openEdit(r)} style={{cursor:'pointer'}}><td>{formatDate(r.date)}</td><td>{r.vr_no}</td><td>{r.dealer_name}</td><td><Money value={r.credit_received}/></td><td><Money value={r.debit_paid}/></td><td>{r.narration||'—'}</td></tr>)}{!dayEntries.length&&<tr><td colSpan={6} className="muted">No entries for this date.</td></tr>}</tbody>
        </table>
      </div>
    </div>
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{form.id?'Edit Day Book Entry':'New Day Book Entry'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
        <Field label="Dealer Name" type="select" value={form.dealer_name} options={dealers.map(d=>({value:d.name,label:d.name}))} onChange={v=>setForm({...form,dealer_name:v})} required/>
        <Field label="Bank" type="select" value={form.bank_id||''} options={[{value:'',label:'Select Bank'},...banks.map(b=>({value:b.id,label:`${b.name}${b.account_no?` — ${b.account_no}`:''}`}))]} onChange={v=>setForm({...form,bank_id:v||null})}/>
        <Field label="Credit Received" type="number" value={form.credit_received} onChange={v=>setForm({...form,credit_received:v})}/>
        <Field label="Debit Paid" type="number" value={form.debit_paid} onChange={v=>setForm({...form,debit_paid:v})}/>
        <Field label="Narration" value={form.narration} onChange={v=>setForm({...form,narration:v})}/>
      </div>
      <div className="actions" style={{marginTop:18,justifyContent:form.id?'space-between':'flex-end',display:'flex'}}>
        {form.id?<button type="button" className="btn danger" onClick={remove}>Delete</button>:<span/>}
        <div style={{display:'flex',gap:8}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary">Save</button></div>
      </div>
    </form></div>}
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
              <thead><tr><th>Dealer</th><th>Total Received</th></tr></thead>
              <tbody>
                {filteredSummary.map((s) => (
                  <tr key={s.dealer_id} onClick={() => setDealerId(String(s.dealer_id))} style={{ cursor: 'pointer' }} title="Click to view statement">
                    <td><b>{s.dealer_name}</b></td>
                    <td><b><Money value={s.total} /></b></td>
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
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Doc No.</th><th>Particulars</th>
                <th>Voucher No.</th><th>Bill No.</th><th>Chassis No.</th><th>Customer</th>
                <th>Receipt (Day Book)</th><th>Amount Received (Invoice)</th><th>Running Total</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e, i) => (
                <tr key={i}>
                  <td>{formatDate(e.date)}</td><td>{e.doc_no}</td><td>{e.particulars}</td>
                  <td>{e.voucher_no}</td><td>{e.bill_no}</td><td>{e.chassis_no}</td><td>{e.customer}</td>
                  <td>{e.receipt ? <Money value={e.receipt} /> : ''}</td>
                  <td>{e.amount_received ? <Money value={e.amount_received} /> : ''}</td>
                  <td><b><Money value={e.balance} /></b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

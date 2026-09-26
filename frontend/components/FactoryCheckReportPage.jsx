'use client';
import React, { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner, EmptyState, Field } from './ui';
import { formatDate } from '../lib/date';

export function FactoryCheckReportPage() {
  const [reports, setReports] = useState([]);
  const [pending, setPending] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(null);
  const [addPart, setAddPart] = useState({ raw_item_name: '', qty: 1, unit: 'PCS', remarks: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      q.set('status', status);
      const [r, p] = await Promise.all([
        get('/factory-check-reports?' + q.toString()),
        get('/factory-check-pending-production')
      ]);
      setReports(r.reports || []);
      setPending(p.vouchers || []);
    } catch (e) { setError(e.message || 'Could not load Factory Check Report.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [status]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [search]);

  const create = async (productionVoucherId) => {
    try {
      setError('');
      const r = await post('/factory-check-reports', { production_voucher_id: productionVoucherId });
      await load();
      if (r.report?.id) openReport(r.report.id);
    } catch (e) { setError(e.message || 'Could not create checklist.'); }
  };

  const openReport = async (id) => {
    try {
      const r = await get('/factory-check-reports/' + id + '/preview');
      setOpen(r);
    } catch (e) { setError(e.message || 'Could not open checklist.'); }
  };

  const approve = async () => {
    if (!open?.report?.id) return;
    try {
      await post('/factory-check-reports/' + open.report.id + '/approve', {});
      await openReport(open.report.id);
      load();
    } catch (e) { setError(e.message || 'Approval failed.'); }
  };

  const approveItem = async (id) => {
    try {
      await post('/factory-check-items/' + id + '/approve', {});
      if (open?.report?.id) await openReport(open.report.id);
      load();
    } catch (e) { setError(e.message || 'Part approval failed.'); }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!open?.report?.id) return;
    try {
      await post('/factory-check-reports/' + open.report.id + '/parts', addPart);
      setAddPart({ raw_item_name: '', qty: 1, unit: 'PCS', remarks: '' });
      await openReport(open.report.id);
    } catch (e) { setError(e.message || 'Could not add part.'); }
  };

  return (
    <div>
      <div className="pageHeader">
        <div>
          <h2 style={{ marginBottom: 3 }}>Factory Check Report</h2>
          <p className="muted">Formula consumption ka checklist. Approval tracking ke liye hai — approval se production/work block nahi hoga.</p>
        </div>
        <button className="btn" onClick={load}>↻ Refresh</button>
      </div>
      <ErrorBanner message={error} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="actions">
          <input className="input" placeholder="Search voucher / chassis / model…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 330 }} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="all">All Status</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option>
          </select>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>Production Vouchers — Checklist Pending</h3>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Voucher</th><th>Model</th><th>Chassis</th><th>Qty</th><th></th></tr></thead>
              <tbody>{pending.slice(0, 100).map(v => (
                <tr key={v.id}>
                  <td>{formatDate(v.date)}</td><td><b>{v.vou_no}</b></td><td>{v.product_name}</td><td>{v.chassis_no || '—'}</td><td>{v.quantity}</td>
                  <td><button className="btn primary" onClick={() => create(v.id)}>Create Checklist</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Check Reports</h3>
        {loading ? <div className="muted">Loading…</div> : reports.length === 0 ? <EmptyState text="No factory check reports found." /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Voucher</th><th>Model</th><th>Chassis</th><th>Qty</th><th>Items</th><th>Status</th><th></th></tr></thead>
              <tbody>{reports.map(r => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.product_name}</td><td><b>{r.chassis_no || '—'}</b></td><td>{r.quantity}</td><td>{r.items?.length || 0}</td>
                  <td><b>{r.status}</b></td><td><button className="btn" onClick={() => openReport(r.id)}>Open Checklist</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="modalbox" style={{ maxWidth: 1050 }}>
            <div className="pageHeader">
              <div><h2 style={{ margin: 0 }}>Factory Check — {open.report?.vou_no}</h2><p className="muted">{open.report?.product_name} • {open.report?.chassis_no} • Qty {open.report?.quantity}</p></div>
              <div className="actions">
                <b>{open.report?.status}</b>
                {open.report?.status !== 'APPROVED' && <button className="btn primary" onClick={approve}>Approve Checklist</button>}
                <button className="btn" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12, background: '#f8fafc' }}>
              <b>Formula / Consumed Material Check</b>
              <div className="tablewrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead><tr><th>Part / Raw Material</th><th>Formula Qty</th><th>Consumed</th><th>Unit</th><th>Type</th><th>Status</th><th></th></tr></thead>
                  <tbody>{(open.items || []).map(item => (
                    <tr key={item.id}>
                      <td><b>{item.raw_item_name}</b></td><td>{item.expected_qty}</td><td>{item.consumed_qty}</td><td>{item.unit}</td>
                      <td>{item.additional ? 'Additional Part' : 'Formula'}</td><td>{item.status}</td>
                      <td>{item.status !== 'APPROVED' ? <button className="btn" onClick={() => approveItem(item.id)}>Approve Part</button> : '✓'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            <form onSubmit={add} className="card" style={{ marginTop: 12 }}>
              <b>Add Part / Extra Consumption</b>
              <p className="muted" style={{ marginTop: 4 }}>Yahin se additional part approval request create hoga. Approval pending hone par bhi factory ka kaam nahi rukega.</p>
              <div className="formgrid">
                <Field label="Part / Raw Material" value={addPart.raw_item_name} onChange={v => setAddPart({ ...addPart, raw_item_name: v })} required />
                <Field label="Qty" type="number" value={addPart.qty} onChange={v => setAddPart({ ...addPart, qty: v })} required />
                <Field label="Unit" value={addPart.unit} onChange={v => setAddPart({ ...addPart, unit: v })} />
                <Field label="Remarks" value={addPart.remarks} onChange={v => setAddPart({ ...addPart, remarks: v })} />
              </div>
              <button className="btn primary">+ Send for Approval</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

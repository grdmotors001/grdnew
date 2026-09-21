'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { formatDate } from '../lib/date';

const STATUS = {
  DO_PENDING: 'Pending FE Assignment',
  FE_ASSIGNED: 'FE Pending Approval',
  FE_APPROVED: 'FE Approved — DO Pending',
  DO_APPROVED: 'DO Approved',
  TVR_PENDING: 'TVR Pending — FE',
  DISBURSEMENT_PENDING: 'Disbursement Pending — DO',
  DISBURSED: 'Disbursed',
  DO_HOLD: 'On Hold',
  DO_REJECTED: 'Rejected',
  DO_EXPIRED: 'DO Expired',
  FE_SUBMITTED: 'FE Approved — DO Pending',
};
const statusLabel = (s) => STATUS[s] || s || '—';

function Stage({ title, done, active, date }) {
  return <div style={{ flex: 1, minWidth: 120, padding: 9, borderRadius: 10, border: '1px solid var(--border)', background: active ? 'var(--soft)' : 'transparent' }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: done || active ? 'var(--accent)' : 'var(--muted)' }}>{done ? '✓' : active ? '●' : '○'} {title}</div>
    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{date ? formatDate(date) : active ? 'Pending' : '—'}</div>
  </div>;
}

export function LoanWorkflowPage({ user }) {
  const [rows, setRows] = useState([]);
  const [fes, setFes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [feId, setFeId] = useState('');
  const [remark, setRemark] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dept = String(user?.department || '').trim().toLowerCase();
  const isAdmin = !!user?.is_super_user || dept === 'admin';
  const isFE = dept === 'fe';
  const isDO = dept === 'do' || dept === 'disbursement officer';

  const load = async () => {
    try {
      setError('');
      const d = await get('/loan-workflow', { noClientCache: true });
      setRows(d.applications || []);
      if (isAdmin) {
        const f = await get('/loan-workflow/field-executives', { noClientCache: true });
        setFes(f.field_executives || []);
      }
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [isAdmin]);

  const open = async (row) => {
    setSelected(row); setFeId(String(row.fe_user_id || '')); setRemark(''); setPhotos([]);
    try {
      const d = await get('/loan-workflow/' + row.id + '/history', { noClientCache: true });
      setHistory(d.history || []);
    } catch (e) { setHistory([]); setError(e.message); }
  };

  const run = async (path, body) => {
    setBusy(true); setError('');
    try {
      await post('/loan-workflow/' + selected.id + path, body);
      setSelected(null); setHistory([]); setRemark(''); setPhotos([]); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const addPhotos = async (files) => {
    const list = Array.from(files || []);
    try {
      const data = await Promise.all(list.map(f => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, type: f.type, size: f.size, data_url: r.result });
        r.onerror = reject; r.readAsDataURL(f);
      })));
      setPhotos(data);
    } catch (e) { setError(e.message); }
  };

  const counts = useMemo(() => rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}), [rows]);
  const canAssign = isAdmin && selected?.status === 'DO_PENDING';
  const canFEApprove = isFE && selected?.status === 'FE_ASSIGNED' && Number(selected?.fe_user_id) === Number(user?.id);
  const canDOApprove = isDO && ['FE_APPROVED','FE_SUBMITTED'].includes(selected?.status);
  const canTVR = isFE && selected?.status === 'TVR_PENDING' && Number(selected?.fe_user_id) === Number(user?.id);
  const canDisburse = isDO && selected?.status === 'DISBURSEMENT_PENDING';

  const stages = (r) => {
    const fe = ['FE_APPROVED','DO_APPROVED','TVR_PENDING','DISBURSEMENT_PENDING','DISBURSED'].includes(r.status);
    const doa = ['DO_APPROVED','TVR_PENDING','DISBURSEMENT_PENDING','DISBURSED'].includes(r.status);
    const tvr = ['DISBURSEMENT_PENDING','DISBURSED'].includes(r.status);
    const disb = r.status === 'DISBURSED';
    return [
      ['Dealer Submit', true, false, r.created_at],
      ['FE Approve', fe, r.status === 'FE_ASSIGNED', r.fe_approved_at],
      ['DO Approve', doa, ['FE_APPROVED','FE_SUBMITTED'].includes(r.status), r.approved_at],
      ['FE TVR', tvr, r.status === 'TVR_PENDING', r.tvr_submitted_at],
      ['DO Disburse', disb, r.status === 'DISBURSEMENT_PENDING', r.disbursed_at],
    ];
  };

  return <>
    <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
      <div><h2 style={{ margin: 0 }}>Loan Workflow / Status</h2><div className="muted">Dealer → FE Approval → DO Approval → FE TVR → DO Disbursement</div></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="grid" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))', marginBottom: 14 }}>
      {[['Pending', counts.DO_PENDING || 0], ['FE', (counts.FE_ASSIGNED || 0) + (counts.TVR_PENDING || 0)], ['DO', (counts.FE_APPROVED || 0) + (counts.DISBURSEMENT_PENDING || 0)], ['TVR Done', counts.DISBURSEMENT_PENDING || 0], ['Disbursed', counts.DISBURSED || 0]].map(([label, value]) =>
        <div className="card" key={label}><div className="muted">{label}</div><div className="metric">{value}</div></div>
      )}
    </div>

    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>Status</th><th>DO No.</th><th>Flow</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><b>{r.application_no}</b></td><td>{r.dealer_name || '—'}</td><td>{r.customer_name || '—'}</td>
          <td><b>{statusLabel(r.status)}</b></td><td>{r.do_no || '—'}</td>
          <td style={{ minWidth: 590 }}><div style={{ display: 'flex', gap: 5 }}>{stages(r).map(([t,d,a,dt]) => <Stage key={t} title={t} done={d} active={a} date={dt} />)}</div></td>
          <td><button className="btn" onClick={() => open(r)}>View / Action</button></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="card">No loan applications found.</div>}
    </div>

    {selected && <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
      <div className="modalbox" style={{ maxWidth: 900 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div><h2 style={{ marginBottom: 4 }}>{selected.application_no}</h2><div className="muted">{selected.customer_name} · {selected.dealer_name}</div></div>
          <button className="btn" onClick={() => setSelected(null)}>Close</button>
        </div>
        <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}><b>Current: {statusLabel(selected.status)}</b><div className="muted" style={{ marginTop: 5 }}>FE: {selected.fe_user_id || 'Not assigned'} · DO: {selected.do_user_id || 'Not set'}</div></div>

        {canAssign && <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <b>Admin — Assign Field Executive</b>
          <div className="actions" style={{ marginTop: 10 }}><select className="input" value={feId} onChange={e => setFeId(e.target.value)} style={{ maxWidth: 360 }}><option value="">Select FE</option>{fes.map(f => <option key={f.id} value={f.id}>{f.username}</option>)}</select><button className="btn primary" disabled={busy || !feId} onClick={() => run('/assign-fe', { fe_user_id: Number(feId) })}>Assign FE</button></div>
        </div>}

        {canFEApprove && <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <b>FE — Approve Field Verification</b>
          <input className="input" type="file" accept="image/*" capture="environment" multiple onChange={e => addPhotos(e.target.files)} style={{ marginTop: 10 }} />
          {photos.length > 0 && <div className="muted" style={{ marginTop: 5 }}>{photos.length} photo(s) selected</div>}
          <textarea className="input" rows="3" placeholder="FE approval remarks" value={remark} onChange={e => setRemark(e.target.value)} style={{ marginTop: 10 }} />
          <button className="btn primary" disabled={busy || !remark.trim() || !photos.length} onClick={() => run('/fe-approve', { remark, live_photos: photos })} style={{ marginTop: 10 }}>✓ FE Approve</button>
        </div>}

        {canDOApprove && <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <b>DO — Approval Decision</b>
          <textarea className="input" rows="3" placeholder="DO remark" value={remark} onChange={e => setRemark(e.target.value)} style={{ marginTop: 10 }} />
          <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" disabled={busy || !remark.trim()} onClick={() => run('/decision', { decision: 'APPROVE', remark })}>✓ DO Approve</button><button className="btn" disabled={busy || !remark.trim()} onClick={() => run('/decision', { decision: 'HOLD', remark })}>Hold</button><button className="btn danger" disabled={busy || !remark.trim()} onClick={() => run('/decision', { decision: 'REJECT', remark })}>Reject</button></div>
        </div>}

        {canTVR && <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <b>FE — TVR Verification</b>
          <textarea className="input" rows="3" placeholder="TVR verification remarks" value={remark} onChange={e => setRemark(e.target.value)} style={{ marginTop: 10 }} />
          <button className="btn primary" disabled={busy || !remark.trim()} onClick={() => run('/tvr', { remark })} style={{ marginTop: 10 }}>✓ Submit TVR</button>
        </div>}

        {canDisburse && <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <b>DO — Disbursement</b>
          <textarea className="input" rows="3" placeholder="Disbursement remarks / transaction reference" value={remark} onChange={e => setRemark(e.target.value)} style={{ marginTop: 10 }} />
          <button className="btn primary" disabled={busy || !remark.trim()} onClick={() => run('/disburse', { remark })} style={{ marginTop: 10 }}>₹ Disburse Loan</button>
        </div>}

        <div style={{ marginTop: 16 }}><b>Activity History</b><div className="tablewrap" style={{ marginTop: 8, maxHeight: 260 }}>
          <table className="table"><thead><tr><th>Time</th><th>Action</th><th>Transition</th><th>Remark</th></tr></thead><tbody>
            {history.length ? history.map(h => <tr key={h.id}><td>{h.created_at ? new Date(h.created_at).toLocaleString('en-IN') : '—'}</td><td>{h.action}</td><td>{h.from_status || '—'} → {h.to_status || '—'}</td><td>{h.remark || h.details || '—'}</td></tr>) : <tr><td colSpan="4">No activity recorded.</td></tr>}
          </tbody></table>
        </div></div>
      </div>
    </div>}
  </>;
}

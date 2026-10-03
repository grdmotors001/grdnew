'use client';
import { useEffect, useState } from 'react';
import { get, put } from '../lib/api';
import { EmptyState, ErrorBanner, Field, Money } from './ui';
import { formatDate } from '../lib/date';

// Accounts > Record.
// Every column is read-only except the four hand-filled ones below.
//  - An EMPTY cell is open: type, or paste straight from Excel (no Edit click needed). It saves and locks.
//  - A FILLED cell is disabled. Only the row's Edit button unlocks it.
//  - Pasting several rows / columns from Excel fills the following rows / columns, but never
//    overwrites a cell that already has a value.
const FIELDS = [
  ['chassis_record_no', 'Chassis Record', 'Chassis record'],
  ['ledger_no', 'Ledger', 'Ledger'],
  ['voucher_no', 'Voucher No.', 'Voucher no.'],
  ['vehicle_reg_no', 'Vehicle No.', 'DL5ERB0160'],
];
const KEYS = FIELDS.map(([k]) => k);
const norm = (k, v) => (k === 'vehicle_reg_no'
  ? String(v ?? '').toUpperCase().replace(/[\s-]+/g, '')
  : String(v ?? '').trim());

export function SaleRecordPage({ user }) {
  const isAdmin = !!user?.is_super_user || String(user?.department || '').trim().toLowerCase() === 'admin';
  const [amtEdit, setAmtEdit] = useState(null); // row being edited in the popup
  const [amtForm, setAmtForm] = useState({ sale_amount: '', loan_amount: '' });
  const [amtBusy, setAmtBusy] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});     // `${id}:${field}` -> text being typed
  const [unlocked, setUnlocked] = useState({}); // id -> true while Edit is active
  const [busy, setBusy] = useState({});         // id -> true while saving

  useEffect(() => {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    get(`/sale-record?${q}`).then((d) => { setRows(d.rows || []); setError(''); }).catch((e) => setError(e.message));
  }, [from, to, search]);

  if (error && !rows) return <ErrorBanner message={error} />;
  if (!rows) return <div className="card">Loading...</div>;

  const dKey = (id, k) => `${id}:${k}`;
  const valueOf = (r, k) => r[k] || '';
  const isLocked = (r, k) => !!valueOf(r, k) && !unlocked[r.id];
  const setDraft = (id, k, v) => setDrafts((d) => ({ ...d, [dKey(id, k)]: v }));
  const clearDrafts = (id) => setDrafts((d) => {
    const n = { ...d };
    KEYS.forEach((k) => delete n[dKey(id, k)]);
    return n;
  });

  // One PUT per row with only the changed fields; the row is updated from the server reply.
  const saveRow = async (id, changes) => {
    const keys = Object.keys(changes);
    if (!keys.length) return;
    setBusy((b) => ({ ...b, [id]: true })); setError('');
    try {
      const res = await put(`/sale-record/${id}`, changes);
      const saved = res?.row || changes;
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...saved } : r)));
      setUnlocked((u) => ({ ...u, [id]: false }));
      clearDrafts(id);
    } catch (e) { setError(e.message); } finally { setBusy((b) => ({ ...b, [id]: false })); }
  };

  // Save button / Enter on a row that is being edited: every field whose text differs from the stored value.
  const saveEdited = (r) => {
    const changes = {};
    KEYS.forEach((k) => {
      const dv = drafts[dKey(r.id, k)];
      if (dv !== undefined && norm(k, dv) !== valueOf(r, k)) changes[k] = norm(k, dv);
    });
    if (!Object.keys(changes).length) { setUnlocked((u) => ({ ...u, [r.id]: false })); clearDrafts(r.id); return; }
    saveRow(r.id, changes);
  };

  // Empty cell: Enter or leaving the box saves just that cell.
  const saveEmptyCell = (r, k) => {
    const v = norm(k, drafts[dKey(r.id, k)]);
    if (v) saveRow(r.id, { [k]: v });
  };

  const startEdit = (r) => {
    setError('');
    setDrafts((d) => {
      const n = { ...d };
      KEYS.forEach((k) => { n[dKey(r.id, k)] = valueOf(r, k); });
      return n;
    });
    setUnlocked((u) => ({ ...u, [r.id]: true }));
  };
  const cancelEdit = (r) => { setUnlocked((u) => ({ ...u, [r.id]: false })); clearDrafts(r.id); };

  // Paste straight into a cell. Single value -> saves this cell. Excel block (rows x columns) ->
  // spread over the next rows / editable columns, skipping cells that are already filled.
  const onPaste = (e, rowIdx, colIdx) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!String(text).trim()) return;
    e.preventDefault();
    const grid = String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((line) => line.split('\t'));
    const perRow = new Map();
    grid.forEach((cells, dr) => {
      const target = rows[rowIdx + dr];
      if (!target) return;
      cells.forEach((cell, dc) => {
        const k = KEYS[colIdx + dc];
        const v = norm(k, cell);
        if (!k || !v) return;
        const isTarget = dr === 0 && dc === 0;
        // Never overwrite a filled cell with a multi-cell paste; a single-cell paste into an open cell is fine.
        if (valueOf(target, k) && !(isTarget && unlocked[target.id])) return;
        if (!perRow.has(target.id)) perRow.set(target.id, {});
        perRow.get(target.id)[k] = v;
      });
    });
    (async () => { for (const [id, changes] of perRow) await saveRow(id, changes); })();
  };

  // Admin only: double-click chassis no. opens a popup to fill a BLANK (0) sale / loan amount. Filled amounts stay locked.
  const openAmtEdit = (r) => {
    if (!isAdmin) return;
    const saleBlank = !Number(r.sale_amount || 0), loanBlank = !Number(r.loan_amount || 0);
    if (!saleBlank && !loanBlank) { setError('Sale amount aur loan amount dono bhare hue hain - edit nahi ho sakta.'); return; }
    setError(''); setAmtForm({ sale_amount: '', loan_amount: '' }); setAmtEdit(r);
  };
  const saveAmt = async () => {
    const r = amtEdit; if (!r) return;
    const body = {};
    if (!Number(r.sale_amount || 0) && String(amtForm.sale_amount).trim() !== '') body.sale_amount = Number(amtForm.sale_amount);
    if (!Number(r.loan_amount || 0) && String(amtForm.loan_amount).trim() !== '') body.loan_amount = Number(amtForm.loan_amount);
    if (!Object.keys(body).length) { setAmtEdit(null); return; }
    if (Object.values(body).some((v) => !Number.isFinite(v) || v < 0)) { setError('Amount sahi number me daalein.'); return; }
    setAmtBusy(true); setError('');
    try {
      const res = await put(`/sale-record/${r.id}`, body);
      const saved = res?.row || {};
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...saved } : x)));
      setAmtEdit(null);
    } catch (e) { setError(e.message); } finally { setAmtBusy(false); }
  };

  return (
    <>
      <div className="toolbar">
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <Field label="Search" value={search} onChange={setSearch} />
      </div>
      <ErrorBanner message={error} />
      {rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sr.No.</th><th>Date</th><th>Dealer Name</th><th>Bill No.</th><th>Model</th><th>Chassis No.</th>
                <th>Other</th><th>Customer</th><th>Internal Sale Value</th><th>Loan</th><th>Amt.Recd.</th><th>Balance</th>
                <th>Financer</th>
                {FIELDS.map(([k, label]) => <th key={k}>{label}</th>)}
                <th>Salesman</th><th style={{ width: 150 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rowIdx) => {
                const isBusy = !!busy[r.id];
                const editing = !!unlocked[r.id];
                const anyFilled = KEYS.some((k) => valueOf(r, k));
                return (
                  <tr key={r.id}>
                    <td>{rowIdx + 1}</td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.dealer_name || '--'}</td>
                    <td>{r.bill_no}</td>
                    <td>{r.product_name || '--'}</td>
                    <td onDoubleClick={() => openAmtEdit(r)} style={isAdmin ? { cursor: 'pointer' } : undefined} title={isAdmin ? 'Double click: blank sale / loan amount edit' : undefined}>{r.chassis_no || '--'}</td>
                    <td>{r.other || '--'}</td>
                    <td>{r.buyer_name || '--'}</td>
                    <td><Money value={r.sale_amount} noSymbol /></td>
                    <td><Money value={r.loan_amount} noSymbol /></td>
                    <td><Money value={r.amount_received} noSymbol /></td>
                    <td><Money value={r.balance} noSymbol /></td>
                    <td>{r.financer_name || '--'}</td>
                    {FIELDS.map(([k, label, ph], colIdx) => {
                      const locked = isLocked(r, k);
                      return (
                        <td key={k}>
                          <input
                            className="input"
                            style={{ minWidth: 120, ...(locked ? { background: '#f2f4f7', color: '#475467' } : {}) }}
                            value={locked ? valueOf(r, k) : (drafts[dKey(r.id, k)] ?? valueOf(r, k))}
                            disabled={locked || isBusy}
                            placeholder={ph}
                            onChange={(e) => setDraft(r.id, k, k === 'vehicle_reg_no' ? e.target.value.toUpperCase() : e.target.value)}
                            onPaste={(e) => onPaste(e, rowIdx, colIdx)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { editing ? saveEdited(r) : saveEmptyCell(r, k); }
                              if (e.key === 'Escape' && editing) cancelEdit(r);
                            }}
                            onBlur={() => { if (!editing && !valueOf(r, k) && drafts[dKey(r.id, k)] !== undefined && !isBusy) saveEmptyCell(r, k); }}
                          />
                        </td>
                      );
                    })}
                    <td>{r.salesman || '--'}</td>
                    <td>
                      {editing ? (
                        <>
                          <button className="btn primary" disabled={isBusy} onClick={() => saveEdited(r)}>{isBusy ? 'Saving...' : 'Save'}</button>{' '}
                          <button className="btn" disabled={isBusy} onClick={() => cancelEdit(r)}>Cancel</button>
                        </>
                      ) : anyFilled ? (
                        <button className="btn" onClick={() => startEdit(r)}>Edit</button>
                      ) : (
                        <span className="muted">{isBusy ? 'Saving...' : 'Paste to save'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={19}><b>{rows.length}</b> records</td></tr></tfoot>
          </table>
        </div>
      )}
      {amtEdit && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setAmtEdit(null); }}>
          <div className="modalbox" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Edit Amount</h3>
            <p className="muted" style={{ marginTop: 0 }}>{amtEdit.chassis_no} &middot; {amtEdit.buyer_name || '--'} &middot; {amtEdit.bill_no}</p>
            <div className="formgrid">
              {!Number(amtEdit.sale_amount || 0)
                ? <Field label="Sale Amount" type="number" value={amtForm.sale_amount} onChange={(v) => setAmtForm((f) => ({ ...f, sale_amount: v }))} />
                : <Field label="Sale Amount (locked)" value={String(amtEdit.sale_amount)} readOnly onChange={() => {}} />}
              {!Number(amtEdit.loan_amount || 0)
                ? <Field label="Loan Amount" type="number" value={amtForm.loan_amount} onChange={(v) => setAmtForm((f) => ({ ...f, loan_amount: v }))} />
                : <Field label="Loan Amount (locked)" value={String(amtEdit.loan_amount)} readOnly onChange={() => {}} />}
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={amtBusy} onClick={saveAmt}>{amtBusy ? 'Saving...' : 'Save'}</button>{' '}
              <button className="btn" disabled={amtBusy} onClick={() => setAmtEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

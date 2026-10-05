'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner, EmptyState, Field } from './ui';

const today = () => new Date().toISOString().slice(0, 10);

export function DailyRawMaterialChecklistPage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaForm, setFormulaForm] = useState({ product_name: '', formula_name: '', raw_item_name: '', qty: 1, unit: 'PCS' });

  const load = async () => {
    setError('');
    try { setData(await get('/daily-raw-material-checklist?date=' + encodeURIComponent(date))); }
    catch (e) { setError(e.message || 'Checklist load failed.'); }
  };
  useEffect(() => { load(); }, [date]);

  const updateItem = (id, patch) => {
    setData(d => ({ ...d, items: (d.items || []).map(x => x.id === id ? { ...x, ...patch } : x) }));
  };

  const save = async () => {
    if (!data?.checklist?.id || data.checklist.status !== 'PENDING') return;
    setBusy(true); setError('');
    try {
      await post('/daily-raw-material-checklist', {
        date,
        items: (data.items || []).map(x => ({
          id: x.id, issued_qty: x.issued_qty, verified: x.verified, remarks: x.remarks
        }))
      });
      await load();
    } catch (e) { setError(e.message || 'Could not save checklist.'); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    if (!data?.checklist?.id) return;
    setBusy(true); setError('');
    try {
      await post('/daily-raw-material-checklist', {
        date,
        items: (data.items || []).map(x => ({
          id: x.id, issued_qty: x.issued_qty, verified: x.verified, remarks: x.remarks
        }))
      });
      await post('/daily-raw-material-checklist/verify', { checklist_id: data.checklist.id });
      await load();
    } catch (e) { setError(e.message || 'Verification failed.'); }
    finally { setBusy(false); }
  };

  const openFormula = (item = null) => {
    if (item) {
      setFormulaForm({
        id: item.formula_line_id,
        product_name: item.product_name,
        formula_name: item.formula_name || '',
        raw_item_name: item.raw_item_name,
        qty: item.formula_qty_per_unit,
        unit: item.unit || 'PCS'
      });
    } else {
      const first = data?.production?.[0];
      setFormulaForm({
        product_name: first?.product_name || '',
        formula_name: first?.formula_name || '',
        raw_item_name: '',
        qty: 1,
        unit: 'PCS'
      });
    }
    setFormulaOpen(true);
  };

  const saveFormula = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('/daily-raw-material-checklist/formula', formulaForm);
      setFormulaOpen(false);
      await load();
    } catch (e) { setError(e.message || 'Formula update failed.'); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="card"><ErrorBanner message={error} />{error ? <button className="btn" onClick={load}>Retry</button> : 'Loading…'}</div>;

  const locked = data.checklist?.status !== 'PENDING';
  const mismatchCount = (data.items || []).filter(x => Math.abs(Number(x.difference || 0)) > 0.000001).length;
  const verifiedCount = (data.items || []).filter(x => x.verified).length;

  return (
    <div>
      <div className="pageHeader">
        <div>
          <h2 style={{ margin: 0 }}>Daily Raw Material Issue Checklist</h2>
          <p className="muted">Production Formula se required quantity automatic calculate hogi. Store Room actual issue verify karega.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load}>↻ Refresh</button>
          <button className="btn primary" disabled={busy || locked} onClick={verify}>✓ Verify & Lock</button>
        </div>
      </div>
      <ErrorBanner message={error} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="formgrid">
          <Field label="Production Date" type="date" value={date} onChange={setDate} />
          <div><div className="fieldlabel">Status</div><div style={{ paddingTop: 9 }}><b>{data.checklist.status}</b></div></div>
          <div><div className="fieldlabel">Production Qty</div><div style={{ paddingTop: 9 }}><b>{data.checklist.production_qty || 0}</b></div></div>
          <div><div className="fieldlabel">Lines Verified</div><div style={{ paddingTop: 9 }}><b>{verifiedCount}/{data.items?.length || 0}</b></div></div>
        </div>
      </div>

      {data.production?.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>Today's Production</h3>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Model</th><th>Formula</th><th>Vehicles</th></tr></thead>
              <tbody>{data.production.map((p, i) => (
                <tr key={i}><td><b>{p.product_name}</b></td><td>{p.formula_name || '—'}</td><td>{p.quantity}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="pageHeader" style={{ marginBottom: 8 }}>
          <div><h3 style={{ margin: 0 }}>Raw Material Verification</h3><p className="muted">Difference = Actual Issued − Required.</p></div>
          <button className="btn" disabled={locked || !data.production?.length} onClick={() => openFormula()}>+ Add Item to Formula</button>
        </div>
        {(data.items || []).length === 0 ? (
          <EmptyState text={data.production?.length ? 'No formula items found. Use “Add Item to Formula” to add the first raw material.' : 'No production found for this date.'} />
        ) : (
          <>
            <div className="tablewrap">
              <table className="table">
                <thead><tr><th>Raw Material</th><th>Model / Formula</th><th>Vehicles</th><th>Required</th><th>Actual Issue</th><th>Difference</th><th>Verify</th><th>Formula</th><th>Remarks</th></tr></thead>
                <tbody>{data.items.map(item => {
                  const diff = Number(item.issued_qty || 0) - Number(item.required_qty || 0);
                  return (
                    <tr key={item.id}>
                      <td><b>{item.raw_item_name}</b><div className="muted" style={{ fontSize: 11 }}>{item.unit}</div></td>
                      <td>{item.product_name}<div className="muted" style={{ fontSize: 11 }}>{item.formula_name || 'Default Formula'}</div></td>
                      <td>{item.production_qty}</td>
                      <td><b>{item.required_qty}</b><div className="muted" style={{ fontSize: 11 }}>{item.formula_qty_per_unit} / vehicle</div>{!item.formula_line_id ? <div style={{ fontSize: 10, color: '#15803d' }}>Voucher me add kiya</div> : Math.abs(Number(item.required_qty || 0) - Number(item.production_qty || 0) * Number(item.formula_qty_per_unit || 0)) > 0.000001 ? <div style={{ fontSize: 10, color: '#b45309' }}>Voucher me qty badli hai</div> : null}</td>
                      <td><input type="number" min="0" step="any" disabled={locked} value={item.issued_qty ?? 0}
                        onChange={e => updateItem(item.id, { issued_qty: e.target.value, difference: Number(e.target.value || 0) - Number(item.required_qty || 0) })} style={{ width: 95 }} /></td>
                      <td><b>{diff > 0 ? '+' : ''}{diff}</b></td>
                      <td><input type="checkbox" disabled={locked} checked={Boolean(item.verified)} onChange={e => updateItem(item.id, { verified: e.target.checked })} /></td>
                      <td>{item.formula_line_id ? <button className="btn" disabled={locked} onClick={() => openFormula(item)}>Update Formula</button> : <span className="muted" style={{ fontSize: 11 }}>Formula me nahi</span>}</td>
                      <td><input disabled={locked} value={item.remarks || ''} onChange={e => updateItem(item.id, { remarks: e.target.value })} placeholder={Math.abs(diff) > 0.000001 ? 'Mismatch reason required' : 'Optional'} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {!locked && <div className="actions" style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={save}>Save Verification</button></div>}
            {mismatchCount > 0 && <div className="card" style={{ marginTop: 12, background: '#fff7ed' }}>⚠ {mismatchCount} line(s) have a quantity difference. Add a remark before Verify & Lock.</div>}
          </>
        )}
      </div>

      {formulaOpen && (
        <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setFormulaOpen(false); }}>
          <form className="modalbox" onSubmit={saveFormula} style={{ maxWidth: 620 }}>
            <h2>{formulaForm.id ? 'Update Formula Item' : 'Add Item to Formula'}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Product / Model" type="select" value={formulaForm.product_name}
                options={(data.production || []).map(x => ({ value: x.product_name, label: x.product_name }))}
                onChange={v => setFormulaForm(f => ({ ...f, product_name: v }))} required />
              <Field label="Formula" type="select" value={formulaForm.formula_name}
                options={(data.formulas || []).filter(x => x.product_name === formulaForm.product_name).map(x => x.formula_name)}
                onChange={v => setFormulaForm(f => ({ ...f, formula_name: v }))} required />
              <Field label="Raw Material" type="select" value={formulaForm.raw_item_name}
                options={(data.raw_materials || []).map(x => x.name)} onChange={v => setFormulaForm(f => ({ ...f, raw_item_name: v }))} required />
              <Field label="Qty per Vehicle" type="number" value={formulaForm.qty} onChange={v => setFormulaForm(f => ({ ...f, qty: v }))} required />
              <Field label="Unit" value={formulaForm.unit} onChange={v => setFormulaForm(f => ({ ...f, unit: v }))} required />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setFormulaOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Formula'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

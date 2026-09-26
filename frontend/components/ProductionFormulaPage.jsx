'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';

export function ProductionFormulaPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [isExisting, setIsExisting] = useState(false);
  const [modalForm, setModalForm] = useState(null);
  const [previewFormula, setPreviewFormula] = useState(null);
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/production-formulas').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (!data) return (
    <div className="card">
      {error ? (
        <>
          <b>Production Formula load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </>
      ) : 'Loading…'}
    </div>
  );

  const q = search.trim().toLowerCase();
  const visibleFormulas = q
    ? data.grouped.filter((g) => g.formula_name.toLowerCase().includes(q) || g.product_name.toLowerCase().includes(q))
    : data.grouped;

  const openNew = () => {
    setModalForm({ formula_name: '', product_name: '', lines: [{ raw_item_name: '', qty: 1, unit: 'PCS' }] });
    setIsExisting(false);
    setError('');
    setModalOpen(true);
  };

  const openModify = (g) => {
    setModalForm({
      formula_name: g.formula_name,
      product_name: g.product_name,
      lines: g.lines.map((l) => ({ id: l.id, raw_item_name: l.raw_item_name, qty: l.qty, unit: l.unit })),
    });
    setIsExisting(true);
    setError('');
    setModalOpen(true);
  };

  const addModalRow = () => setModalForm((f) => ({ ...f, lines: [...f.lines, { raw_item_name: '', qty: 1, unit: 'PCS' }] }));

  const updateModalRow = (idx, field, value) => {
    setModalForm((f) => {
      const lines = [...f.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      return { ...f, lines };
    });
  };

  const removeModalRow = (idx) => {
    const line = modalForm.lines[idx];
    if (line.id) {
      if (!confirm('Remove this raw material line from the formula?')) return;
      run(async () => {
        await del(`/production-formulas/${line.id}`);
        setModalForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
        load();
      });
    } else {
      setModalForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
    }
  };

  const saveModal = (e) => {
    e.preventDefault();
    const rows = modalForm.lines.filter((l) => l.raw_item_name);
    if (!modalForm.formula_name || !modalForm.product_name) {
      setError('Formula Name and Finished Product are both required.');
      return;
    }
    if (rows.length === 0) {
      setError('Add at least one raw material line.');
      return;
    }
    run(async () => {
      // One POST per line — the backend keys each BOM row by
      // formula_name + product_name, and updates in place when an id
      // is present (existing line) or inserts a new one otherwise.
      for (const line of rows) {
        await post('/production-formulas', {
          id: line.id,
          formula_name: modalForm.formula_name,
          product_name: modalForm.product_name,
          raw_item_name: line.raw_item_name,
          qty: line.qty,
          unit: line.unit,
        });
      }
      setModalOpen(false);
      load();
    });
  };

  const removeFormula = (formulaName, productName) => {
    if (!confirm(`Delete the whole "${formulaName}" formula (all its raw material lines)?`)) return;
    run(async () => {
      const qs = new URLSearchParams({ formula_name: formulaName, product_name: productName });
      await del(`/production-formulas/by-product?${qs}`);
      load();
    });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ Add Formula</button>
      </div>
      <ErrorBanner message={!modalOpen ? error : ''} />

      <div className="actions" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="Search formula or product name"
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      {visibleFormulas.length === 0 ? <EmptyState text="No formulas yet." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Formula Name</th><th>Finished Product</th><th>Raw Material Lines</th><th></th></tr></thead>
            <tbody>
              {visibleFormulas.map((g) => (
                <tr key={`${g.formula_name}::${g.product_name}`}>
                  <td>
                    <a onClick={() => openModify(g)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                      <b>{g.formula_name}</b>
                    </a>
                  </td>
                  <td>{g.product_name}</td>
                  <td>{g.lines.length}</td>
                  <td><button className="btn" onClick={() => setPreviewFormula(g)}>Preview Items</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewFormula && (
        <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setPreviewFormula(null); }}>
          <div className="modalbox" style={{ maxWidth: 760 }}>
            <div className="pageHeader">
              <div><h2 style={{ margin: 0 }}>Formula Preview</h2><p className="muted">{previewFormula.formula_name} • {previewFormula.product_name}</p></div>
              <button className="btn" onClick={() => setPreviewFormula(null)}>Close</button>
            </div>
            <div className="tablewrap" style={{ marginTop: 14 }}>
              <table className="table">
                <thead><tr><th>#</th><th>Raw Material</th><th>Qty</th><th>Unit</th></tr></thead>
                <tbody>{(previewFormula.lines || []).map((l, i) => (
                  <tr key={l.id || i}><td>{i + 1}</td><td><b>{l.raw_item_name}</b></td><td>{l.qty}</td><td>{l.unit}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card" style={{ marginTop: 12, background: '#f8fafc' }}>
              <b>Total formula lines:</b> {previewFormula.lines?.length || 0}
            </div>
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveModal} style={{ maxWidth: 720 }}>
            <h2>{isExisting ? 'Modify Production Formula' : 'New Production Formula'}</h2>
            <ErrorBanner message={error} />

            <div className="formgrid">
              <Field label="Formula Name" value={modalForm.formula_name} readOnly={isExisting}
                     onChange={(v) => setModalForm({ ...modalForm, formula_name: v })} required />
              <Field label="Finished Product" type="select" value={modalForm.product_name} readOnly={isExisting}
                     options={data.finished_products.map((p) => p.name)}
                     onChange={(v) => setModalForm({ ...modalForm, product_name: v })} required />
            </div>
            {isExisting && (
              <p className="muted" style={{ marginTop: -4 }}>
                Formula Name and Finished Product can't be changed here — delete and re-create the
                formula if you need to rename it.
              </p>
            )}

            <div style={{ marginTop: 14 }}>
              <b style={{ fontSize: 13 }}>Raw Material Lines</b>
              <div className="tablewrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead><tr><th>Raw Material</th><th>Qty</th><th>Unit</th><th></th></tr></thead>
                  <tbody>
                    {modalForm.lines.map((line, idx) => (
                      <tr key={line.id ?? `new-${idx}`}>
                        <td>
                          <select value={line.raw_item_name} onChange={(e) => updateModalRow(idx, 'raw_item_name', e.target.value)} required>
                            <option value="">Select…</option>
                            {data.raw_materials.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                          </select>
                        </td>
                        <td><input type="number" value={line.qty} onChange={(e) => updateModalRow(idx, 'qty', e.target.value)} style={{ width: 80 }} /></td>
                        <td><input value={line.unit} onChange={(e) => updateModalRow(idx, 'unit', e.target.value)} style={{ width: 80 }} /></td>
                        <td><button type="button" className="btn danger" onClick={() => removeModalRow(idx)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={addModalRow}>+ Add Row</button>
            </div>

            <div className="actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              {isExisting ? (
                <button type="button" className="btn danger" disabled={busy}
                        onClick={() => { removeFormula(modalForm.formula_name, modalForm.product_name); setModalOpen(false); }}>
                  Delete Formula
                </button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

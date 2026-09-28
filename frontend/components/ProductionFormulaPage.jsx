'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';

const blankLine = () => ({ raw_item_name: '', qty: 1, unit: 'PCS' });

export function ProductionFormulaPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [isExisting, setIsExisting] = useState(false);
  const [modalForm, setModalForm] = useState(null);
  const [previewFormula, setPreviewFormula] = useState(null);
  const [copySrc, setCopySrc] = useState(null);
  const [copyForm, setCopyForm] = useState({ product_name: '', formula_name: '' });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/production-formulas').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Raw material -> unit jo pehle kisi formula me use hua ho (naya row add karte waqt unit khud bhar jaye).
  const unitByRaw = useMemo(() => {
    const m = {};
    (data?.rows || []).forEach((r) => { if (r.raw_item_name && r.unit && !m[r.raw_item_name]) m[r.raw_item_name] = r.unit; });
    return m;
  }, [data]);
  const rawNames = useMemo(() => new Set((data?.raw_materials || []).map((p) => p.name)), [data]);

  if (!data) return (
    <div className="card">
      {error ? (
        <>
          <b>Production Formula load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(); }}>Retry</button>
        </>
      ) : 'Loading…'}
    </div>
  );

  // Search: formula, product ya raw material naam se.
  const q = search.trim().toLowerCase();
  const visibleFormulas = q
    ? data.grouped.filter((g) =>
        String(g.formula_name || '').toLowerCase().includes(q) ||
        String(g.product_name || '').toLowerCase().includes(q) ||
        g.lines.some((l) => String(l.raw_item_name || '').toLowerCase().includes(q)))
    : data.grouped;

  const openNew = () => {
    setModalForm({ formula_name: '', product_name: '', lines: [blankLine()] });
    setIsExisting(false); setError(''); setModalOpen(true);
  };

  const openModify = (g) => {
    setModalForm({
      formula_name: g.formula_name || g.product_name,
      orig_formula_name: g.formula_name || '',
      orig_product_name: g.product_name,
      orig_ids: g.lines.map((l) => l.id).filter(Boolean),
      product_name: g.product_name,
      lines: g.lines.map((l) => ({ id: l.id, raw_item_name: l.raw_item_name, qty: l.qty, unit: l.unit })),
    });
    setIsExisting(true); setError(''); setModalOpen(true);
  };

  // Ek jaisa doosra model: purane formula ki lines copy karke naya formula (product naya chunna hoga).
  const openCopy = (g) => {
    setCopySrc(g);
    setCopyForm({ product_name: g.product_name, formula_name: '' });
    setError('');
  };

  const doCopy = (e) => {
    e.preventDefault();
    const name = copyForm.formula_name.trim();
    if (!copyForm.product_name) { setError('Kis model ke liye copy karna hai wo select karein.'); return; }
    if (!name) { setError('Naye formula ka naam likhein.'); return; }
    if (data.grouped.some((g) => g.formula_name === name && g.product_name === copyForm.product_name)) {
      setError('Is model me is naam ka formula pehle se hai. Doosra naam likhein.'); return;
    }
    run(async () => {
      await post('/production-formulas/save', {
        formula_name: name,
        product_name: copyForm.product_name,
        lines: copySrc.lines.map((l) => ({ raw_item_name: l.raw_item_name, qty: l.qty, unit: l.unit })),
      });
      setCopySrc(null);
      load();
    });
  };

  const copyFromExisting = (key) => {
    if (!key) return;
    const g = data.grouped.find((x) => `${x.formula_name}::${x.product_name}` === key);
    if (!g) return;
    setModalForm((f) => ({ ...f, lines: g.lines.map((l) => ({ raw_item_name: l.raw_item_name, qty: l.qty, unit: l.unit })) }));
  };

  const addModalRow = () => {
    setModalForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
    setTimeout(() => {
      const els = document.querySelectorAll('.pfRawInput');
      els[els.length - 1]?.focus();
    }, 50);
  };

  const updateModalRow = (idx, field, value) => {
    setModalForm((f) => {
      const lines = [...f.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      // Raw material chunte hi unit khud aa jaye (agar pehle kahin use hua ho).
      if (field === 'raw_item_name' && unitByRaw[value]) lines[idx].unit = unitByRaw[value];
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
    if (!modalForm.product_name) { setError('Finished Product select karein.'); return; }
    // Formula Name khali ho to product ka naam hi formula name ban jayega.
    const formulaName = (modalForm.formula_name || '').trim() || modalForm.product_name;
    const renaming = isExisting && (formulaName !== (modalForm.orig_formula_name || modalForm.orig_product_name) || modalForm.product_name !== modalForm.orig_product_name);
    if (renaming && data.grouped.some((g) => g.formula_name === formulaName && g.product_name === modalForm.product_name)) {
      setError('Is model me is naam ka formula pehle se hai. Doosra naam likhein.'); return;
    }
    const rows = modalForm.lines.filter((l) => l.raw_item_name);
    if (rows.length === 0) { setError('Kam se kam ek raw material line add karein.'); return; }
    const bad = rows.find((l) => !rawNames.has(l.raw_item_name));
    if (bad) { setError(`"${bad.raw_item_name}" raw material list me nahi hai. List me se hi chunein.`); return; }
    const seen = new Set();
    for (const l of rows) {
      if (seen.has(l.raw_item_name)) { setError(`"${l.raw_item_name}" do baar aa gaya hai. Ek hi line rakhein.`); return; }
      seen.add(l.raw_item_name);
    }
    if (rows.some((l) => !(Number(l.qty) > 0))) { setError('Har line ki Qty 0 se zyada honi chahiye.'); return; }
    if (!isExisting && data.grouped.some((g) => g.formula_name === formulaName && g.product_name === modalForm.product_name)) {
      setError('Is product ka is naam ka formula pehle se hai. Use list se kholkar modify karein.'); return;
    }
    run(async () => {
      if (renaming) {
        await post('/production-formulas/rename', { ids: modalForm.orig_ids, old_product_name: modalForm.orig_product_name, new_product_name: modalForm.product_name, old_formula_name: modalForm.orig_formula_name, new_formula_name: formulaName });
      }
      // Poora formula ek hi request me save hota hai (id wali lines update, nayi lines insert).
      await post('/production-formulas/save', {
        formula_name: formulaName,
        product_name: modalForm.product_name,
        lines: rows.map((l) => ({ id: l.id, raw_item_name: l.raw_item_name, qty: l.qty, unit: l.unit })),
      });
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
      <div className="actions" style={{ marginBottom: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={openNew}>+ Add Formula</button>
        <input className="input" placeholder="Search product, formula ya raw material…"
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
      </div>
      <ErrorBanner message={!modalOpen ? error : ''} />

      {visibleFormulas.length === 0 ? <EmptyState text="No formulas found." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Finished Product</th><th>Formula Name</th><th>Raw Material Lines</th><th></th></tr></thead>
            <tbody>
              {visibleFormulas.map((g) => (
                <tr key={`${g.formula_name}::${g.product_name}`}>
                  <td><b>{g.product_name}</b>{data.grouped.filter((x) => x.product_name === g.product_name).length > 1 && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>({data.grouped.filter((x) => x.product_name === g.product_name).length} formulas)</span>}</td>
                  <td><b>{g.formula_name || g.product_name}</b></td>
                  <td>{g.lines.length}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn" onClick={() => setPreviewFormula(g)}>Preview</button>
                      <button className="btn primary" onClick={() => openModify(g)}>Edit</button>
                      <button className="btn" title="Is formula ko copy karke naya formula (naam + model chunkar) banao" onClick={() => openCopy(g)}>Copy</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewFormula && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewFormula(null); }}>
          <div className="modalbox" style={{ width: 'min(960px, 96vw)', maxWidth: 'none' }}>
            <div className="pageHeader">
              <div><h2 style={{ margin: 0 }}>Formula Preview</h2><p className="muted">{previewFormula.product_name}{previewFormula.formula_name ? ` • ${previewFormula.formula_name}` : ''}</p></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={() => { const g = previewFormula; setPreviewFormula(null); openModify(g); }}>Edit</button>
                <button className="btn" onClick={() => setPreviewFormula(null)}>Close</button>
              </div>
            </div>
            <div className="tablewrap" style={{ marginTop: 14, maxHeight: '55vh', overflow: 'auto' }}>
              <table className="table">
                <thead><tr><th>#</th><th>Raw Material</th><th>Qty</th><th>Unit</th></tr></thead>
                <tbody>{(previewFormula.lines || []).map((l, i) => (
                  <tr key={l.id || i}><td>{i + 1}</td><td><b>{l.raw_item_name}</b></td><td>{l.qty}</td><td>{l.unit}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="muted" style={{ marginTop: 10 }}><b>Total formula lines:</b> {previewFormula.lines?.length || 0}</div>
          </div>
        </div>
      )}

      {copySrc && (
        <div className="modal">
          <form className="modalbox" onSubmit={doCopy} style={{ width: 'min(640px, 96vw)', maxWidth: 'none' }}>
            <h2>Copy Formula</h2>
            <p className="muted">Source: <b>{copySrc.product_name}</b>{copySrc.formula_name ? ` • ${copySrc.formula_name}` : ''} ({copySrc.lines.length} lines)</p>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Naye Formula ka Naam" value={copyForm.formula_name} onChange={(v) => setCopyForm({ ...copyForm, formula_name: v })} required />
              <Field label="Kis Model (Finished Product) ke liye" type="select" value={copyForm.product_name}
                     options={data.finished_products.map((p) => p.name)}
                     onChange={(v) => setCopyForm({ ...copyForm, product_name: v })} required />
            </div>
            <p className="muted" style={{ fontSize: 12 }}>Saari raw material lines copy ho jayengi. Baad me “Edit” se qty ya items badal sakte hain.</p>
            <div className="actions" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => { setCopySrc(null); setError(''); }}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Copying…' : 'Copy Formula'}</button>
            </div>
          </form>
        </div>
      )}

      {modalOpen && (
        <div className="modal">
          <form className="modalbox" onSubmit={saveModal} style={{ width: 'min(1180px, 96vw)', maxWidth: 'none' }}>
            <h2>{isExisting ? 'Edit Production Formula' : 'New Production Formula'}</h2>
            <ErrorBanner message={error} />

            <div className="formgrid">
              <Field label={isExisting ? 'Finished Product (badal sakte hain)' : 'Finished Product'} type="select" value={modalForm.product_name}
                     options={[...new Set([...(modalForm.product_name ? [modalForm.product_name] : []), ...data.finished_products.map((p) => p.name)])]}
                     onChange={(v) => setModalForm({ ...modalForm, product_name: v })} required />
              <Field label={isExisting ? 'Formula Name (badal sakte hain)' : 'Formula Name (khali chhodo = product ka naam)'} value={modalForm.formula_name}
                     onChange={(v) => setModalForm({ ...modalForm, formula_name: v })} />
            </div>
            {isExisting && (
              <p className="muted" style={{ marginTop: -4 }}>
                Formula Name aur Finished Product dono badal sakte hain — Save par is formula ki saari lines naye naam / model par chali jayengi. Ek hi formula do models par chahiye to “Copy” use karein.
              </p>
            )}

            {!isExisting && (
              <div style={{ marginTop: 10 }}>
                <label className="muted" style={{ fontSize: 12 }}>Kisi purane formula se lines copy karein (optional)</label>
                <select className="input" defaultValue="" onChange={(e) => { copyFromExisting(e.target.value); e.target.value = ''; }}>
                  <option value="">Select formula to copy…</option>
                  {data.grouped.map((g) => <option key={`${g.formula_name}::${g.product_name}`} value={`${g.formula_name}::${g.product_name}`}>{g.product_name} ({g.lines.length} lines)</option>)}
                </select>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <b style={{ fontSize: 13 }}>Raw Material Lines ({modalForm.lines.filter((l) => l.raw_item_name).length})</b>
              <datalist id="pfRawList">{data.raw_materials.map((p) => <option key={p.name} value={p.name} />)}</datalist>
              <div className="tablewrap" style={{ marginTop: 8, maxHeight: '50vh', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th style={{ width: 36 }}>#</th><th>Raw Material (type karke search karein)</th><th>Qty</th><th>Unit</th><th></th></tr></thead>
                  <tbody>
                    {modalForm.lines.map((line, idx) => (
                      <tr key={line.id ?? `new-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>
                          <input className="pfRawInput" list="pfRawList" style={{ width: '100%', minWidth: 320 }}
                                 placeholder="Raw material likhein…" value={line.raw_item_name}
                                 onChange={(e) => updateModalRow(idx, 'raw_item_name', e.target.value)}
                                 onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
                        </td>
                        <td><input type="number" min="0" step="any" value={line.qty} onChange={(e) => updateModalRow(idx, 'qty', e.target.value)} style={{ width: 100 }}
                                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModalRow(); } }} /></td>
                        <td><input value={line.unit} onChange={(e) => updateModalRow(idx, 'unit', e.target.value)} style={{ width: 90 }} /></td>
                        <td><button type="button" className="btn danger" onClick={() => removeModalRow(idx)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={addModalRow}>+ Add Row</button>
              <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>Qty me Enter dabane par nayi row khulti hai.</span>
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

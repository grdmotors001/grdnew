'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);
const sectionTitle = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' };

export function ProductionVoucherPage() {
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [formulas, setFormulas] = useState([]);
  const [colours, setColours] = useState([]);
  const [batteryMakers, setBatteryMakers] = useState([]);
  const [mechanics, setMechanics] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ date: today(), quantity: 1 });
  const [bomPreview, setBomPreview] = useState(null);      // working list (editable)
  const [formulaLines, setFormulaLines] = useState(null);    // formula ki original lines (compare / reset ke liye)
  const [rawMaterials, setRawMaterials] = useState([]);
  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { busy, error, setError, run } = useAsyncAction();

  // Only "Finished Product" (fro === 'F') items belong in the Production
  // Voucher's product picker — Product Master also holds Raw Materials
  // (fro === 'R'), which were leaking into this dropdown before.
  const finishedProducts = products.filter((p) => p.fro !== 'R');
  // A finished product can have more than one named formula/variant (e.g.
  // "Formula A" / "Formula B") — list all formulas registered for the
  // chosen product so the user picks which BOM gets auto-copied.
  const formulasForProduct = formulas.filter((g) => g.product_name === form.product_name);
  const batteryNos = [1, 2, 3, 4, 5].map((n) => form[`battery_no${n}`] || '');
  const batteryCount = batteryNos.filter((v) => String(v).trim()).length;

  // ---- Formula items me kami / zyadati ----
  const lk = (n) => String(n || '').trim().toLowerCase();
  const normLine = (l) => ({ raw_item_name: String(l.raw_item_name || l.item_name || '').trim(), unit: l.unit || 'PCS', qty: Number(l.qty) || 0 });
  const sig = (a) => JSON.stringify((a || []).map((l) => [lk(l.raw_item_name), Number(l.qty) || 0]).sort());
  const bomModified = !!bomPreview && !!formulaLines && sig(bomPreview) !== sig(formulaLines);
  const formulaQty = (name) => { const f = (formulaLines || []).find((x) => lk(x.raw_item_name) === lk(name)); return f ? Number(f.qty) || 0 : null; };
  const setLineQty = (i, v) => setBomPreview((a) => a.map((l, j) => (j === i ? { ...l, qty: v } : l)));
  const removeLine = (i) => setBomPreview((a) => a.filter((_, j) => j !== i));
  const resetBom = () => setBomPreview((formulaLines || []).map((l) => ({ ...l })));
  const addLine = () => {
    const name = String(addName || '').trim();
    const q = Number(addQty);
    if (!name) { setError('Add karne ke liye Raw Material select karein.'); return; }
    if (!(q > 0)) { setError('Qty 0 se zyada honi chahiye.'); return; }
    if ((bomPreview || []).some((l) => lk(l.raw_item_name) === lk(name))) { setError(`"${name}" list me pehle se hai - uski Qty badal lein.`); return; }
    setError('');
    setBomPreview((a) => [...(a || []), { raw_item_name: name, unit: 'PCS', qty: q }]);
    setAddName(''); setAddQty('1');
  };

  // 17,000+ production vouchers (and 500,000+ BOM item rows total) exist
  // in production -- fetch one page at a time (backend paginates and no
  // longer sends full item lists in the list view) instead of everything
  // at once, which used to crash the page.
  const load = (p = page, s = search) => {
    const params = new URLSearchParams({ page: p, per_page: 50 });
    if (s) params.set('search', s);
    get(`/production-vouchers?${params}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load(1, search);
    get('/products?fro=F&category=FINISHED&page=1&per_page=1000').then((d) => setProducts(d.products || []));
    get('/production-formulas').then((d) => { setFormulas(d.grouped || []); setRawMaterials((d.raw_materials || []).map((x) => x.name).filter(Boolean)); });
    get('/masters/colour').then((d) => setColours(d.masters || d || [])).catch(() => {});
    get('/masters/battery-maker').then((d) => setBatteryMakers(d.masters || d || [])).catch(() => {});
    get('/masters/mechanic').then((d) => setMechanics(d.masters || d || [])).catch(() => {});
  }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const rows = data?.vouchers || [];

  const openNew = () => { setEditingId(null); setForm({ date: today(), quantity: 1, formula_name: '', battery_no1: '', battery_no2: '', battery_no3: '', battery_no4: '', battery_no5: '' }); setBomPreview(null); setFormulaLines(null); setOpen(true); };
  const openEdit = async (id) => {
    try {
      const d = await get(`/production-vouchers/${id}`);
      const v = d.voucher || d;
      setEditingId(id);
      setForm(v);
      setBomPreview(null); setFormulaLines(null);
      setOpen(true);
      // Formula ki original lines + (agar is voucher par pehle se change save hua ho to) wahi list dikhao.
      let base = [];
      try { base = await fetchFormulaLines(v.product_name, v.formula_name); } catch (e) { /* formula na mile to bhi edit chale */ }
      setFormulaLines(base);
      const saved = Array.isArray(v.bom_lines) && v.bom_lines.length ? v.bom_lines.map(normLine) : null;
      setBomPreview(saved || base.map((l) => ({ ...l })));
    } catch (e) { setError(e.message); }
  };

  // Model select karte hi (aur Date badalte hi) Chassis / Motor / Controller apne aap generate hote hain.
  // Motor & Controller = us model ka pichhla number + 1 (backend nikalta hai). Button se dobara bhi kar sakte hain.
  const generateCode = (productName = form.product_name, dateStr = form.date) => {
    if (!productName) { setError('Choose a product first.'); return Promise.resolve(); }
    return run(async () => {
      const q = new URLSearchParams({ product: productName, date: dateStr || today() });
      const gen = await get(`/production-vouchers/generate-code?${q}`);
      setForm((f) => (f.product_name === productName
        ? { ...f, chassis_no: gen.chassis_no, motor_no: gen.motor_no, controller_no: gen.controller_no }
        : f));
      if (gen.wrapped) {
        setError('Note: serial limit ke baad chassis serial dobara 001 se shuru hua (pehle se bane numbers skip kiye gaye).');
      }
      if (gen.missing_item_code) {
        setError('Note: this product has no Chassis Item Code set in Product Master — used a fallback prefix.');
      }
    }).catch(() => {});
  };

  // Mechanic ka naam: machnic ya koi bhi mechanic jaisi column (purane imported data me alag naam ho sakta hai).
  const mechanicOf = (r) => {
    const direct = r.machnic || r.mechanic || r.mechanic_name || r.mechnic;
    if (direct) return direct;
    const k = Object.keys(r).find((x) => /mach?e?nic|mechanic/i.test(x) && String(r[x] ?? '').trim() !== '');
    return k ? r[k] : '';
  };
  const productByName = (name) => products.find((p) => String(p.name) === String(name));
  const chassisLenFor = (name) => {
    const p = productByName(name) || {};
    return Number(p.chassis_length_digits ?? p.chassis_length ?? p.chassis_no_length ?? 0) || 0;
  };
  const chassisLen = chassisLenFor(form.product_name);
  const chassisNow = String(form.chassis_no || '').trim();

  const fetchFormulaLines = async (productName, formulaName) => {
    const q = new URLSearchParams({ product_name: productName });
    if (formulaName) q.set('formula_name', formulaName);
    const lines = await get(`/production-formulas/lines?${q}`);
    const arr = Array.isArray(lines) ? lines : (lines.lines || []);
    return arr.map(normLine);
  };
  const previewBom = async (productName = form.product_name, formulaName = form.formula_name) => {
    if (!productName) { setError('Choose a product first.'); return; }
    try {
      const base = await fetchFormulaLines(productName, formulaName);
      setFormulaLines(base);
      setBomPreview(base.map((l) => ({ ...l })));
    } catch (e) { setError(e.message); }
  };

  const save = (e) => {
    e.preventDefault();
    const ch = String(form.chassis_no || '').trim();
    if (!ch) { setError('Chassis No. zaroori hai.'); return; }
    if (chassisLen && ch.length !== chassisLen) { setError(`Chassis No. ${chassisLen} character ka hona chahiye (abhi ${ch.length}). Product Master me "Full Chassis No. Length" ${chassisLen} set hai.`); return; }
    if (!String(form.colour || '').trim()) { setError('Colour select karna zaroori hai.'); return; }
    if (!String(form.machnic || '').trim()) { setError('Mechanic select karna zaroori hai.'); return; }
    if (formulasForProduct.length > 0 && !form.formula_name) { setError('Formula Name select karein — is model ke formula ke hisaab se raw material stock se kategi.'); return; }
    // Formula items me change hua ho to final list bhejo (null = formula jaisa hi).
    let bomPayload = null;
    if (bomModified) {
      if (!bomPreview.length) { setError('Kam se kam ek raw material line chahiye.'); return; }
      const seen = new Set();
      for (const l of bomPreview) {
        const k = lk(l.raw_item_name);
        if (!k) { setError('Raw Material line me item ka naam khali hai.'); return; }
        if (seen.has(k)) { setError(`"${l.raw_item_name}" list me do baar hai.`); return; }
        seen.add(k);
        if (!(Number(l.qty) > 0)) { setError(`"${l.raw_item_name}" ki Qty 0 se zyada honi chahiye (item hatana ho to ✕ dabayein).`); return; }
      }
      bomPayload = bomPreview.map((l) => ({ raw_item_name: l.raw_item_name, unit: l.unit || 'PCS', qty: Number(l.qty) }));
    }
    run(async () => {
      // Duplicate chassis: same chassis no. pehle se kisi voucher me ho to save nahi hoga.
      const dq = await get(`/production-vouchers?${new URLSearchParams({ search: ch, page: 1, per_page: 50 })}`, { timeoutMs: 90000 });
      const dup = (dq.vouchers || []).find((v) => String(v.id) !== String(editingId || '')
        && String(v.chassis_no || '').trim().toLowerCase() === ch.toLowerCase());
      if (dup) throw new Error(`Chassis No. "${ch}" pehle se Vou. No. ${dup.vou_no || '-'} me bana hua hai. Duplicate chassis nahi ban sakta.`);
      const payload = { ...form, bom_lines: bomPayload };
      if (editingId) await put(`/production-vouchers/${editingId}`, payload, { timeoutMs: 120000 });
      else await post('/production-vouchers', payload, { timeoutMs: 120000 });
      setOpen(false);
      load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this Production Voucher? The chassis record will also be removed if still in Manufacturing.')) return;
    run(async () => { await del(`/production-vouchers/${id}`); load(); });
  };

  const cols = '24px minmax(0,1fr) 42px 74px 58px 30px';

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Production Voucher</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />

      <form onSubmit={runSearch} className="actions" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="Search vou. no. or chassis no."
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn" type="submit">Search</button>
        {search && (
          <button type="button" className="btn" onClick={() => { setSearch(''); setPage(1); load(1, ''); }}>
            Clear
          </button>
        )}
      </form>

      {!data ? <div className="card">Loading…</div> : rows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Model Name</th><th>Formula Name</th><th>Chassis No.</th><th>Motor No.</th><th>Colour</th><th>Mechanic</th><th>Raw Material Lines</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.product_name}</td><td>{r.formula_name || '—'}</td>
                  <td><b>{r.chassis_no}</b></td><td>{r.motor_no}</td><td>{r.colour}</td><td>{mechanicOf(r)}</td>
                  <td>{r.item_count}</td>
                  <td>
                    <button className="btn" onClick={() => openEdit(r.id)}>Edit</button>
                    <button className="btn danger" onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.total_pages > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="btn" disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            Page {data.page} of {data.total_pages} ({data.total.toLocaleString()} total)
          </span>
          <button className="btn" disabled={page >= data.total_pages} onClick={() => goToPage(page + 1)}>Next →</button>
        </div>
      )}

      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save} style={{ width: 'min(1360px, 100%)', maxWidth: 1360, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ margin: 0 }}>{editingId ? 'Edit Production Voucher' : 'New Production Voucher'}</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Raw material is deducted from stock as per the selected formula.</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, .85fr)', minHeight: 620 }}>
              <div className="pvForm" style={{ padding: '16px 24px', borderRight: '1px solid var(--line)', overflowY: 'auto', maxHeight: '72vh' }}>
                <ErrorBanner message={error} />

              <div style={sectionTitle}>Product</div>
              <div className="formgrid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                <Field label="Finished Product" type="select" value={form.product_name}
                       options={finishedProducts.map((p) => p.name)}
                       onChange={(v) => {
                         // If this product has exactly one formula, pre-select it —
                         // otherwise leave it for the user to choose below.
                         const matches = formulas.filter((g) => g.product_name === v);
                         const autoFormula = matches.length === 1 ? matches[0].formula_name : '';
                         setForm({ ...form, product_name: v, formula_name: autoFormula });
                         setBomPreview(null);
                         if (v) previewBom(v, autoFormula);
                         if (v && !editingId) generateCode(v, form.date);
                       }} required />
                <Field label="Formula Name" type="select" value={form.formula_name}
                       options={formulasForProduct.map((g) => g.formula_name)}
                       onChange={(v) => { setForm({ ...form, formula_name: v }); previewBom(form.product_name, v); }} />
                <Field label="Date" type="date" value={form.date} onChange={(v) => {
                  setForm({ ...form, date: v });
                  // Date badalne par month/year code badal jaata hai -> chassis dobara generate.
                  if (!editingId && form.product_name && /^\d{4}-\d{2}-\d{2}$/.test(v)) generateCode(form.product_name, v);
                }} />
              </div>
              {form.product_name && formulasForProduct.length === 0 && (
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  No formula set up for this product yet — set one up in Production Formula.
                </p>
              )}

              <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>Vehicle Numbers</span>
                <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 12, textTransform: 'none', letterSpacing: 0, fontWeight: 600, position: 'static', flexShrink: 0 }}
                        onClick={() => generateCode()} disabled={busy || !form.product_name}>↻ Regenerate Chassis / Motor / Controller No.</button>
              </div>
              <div className="formgrid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                <div>
                  <Field label="Chassis No." value={form.chassis_no} onChange={(v) => setForm({ ...form, chassis_no: v })} required />
                  {chassisLen > 0 && (
                    <div style={{ fontSize: 11, marginTop: 4, color: chassisNow.length === chassisLen ? 'var(--green)' : '#b42318' }}>
                      Length: {chassisNow.length} / {chassisLen}
                    </div>
                  )}
                </div>
                <Field label="Motor No." value={form.motor_no} onChange={(v) => setForm({ ...form, motor_no: v })} />
                <Field label="Controller No." value={form.controller_no} onChange={(v) => setForm({ ...form, controller_no: v })} />
                <Field label="Differential No." value={form.differential_no} onChange={(v) => setForm({ ...form, differential_no: v })} />
              </div>

              <div style={sectionTitle}>Colour, Battery &amp; Mechanic</div>
              <div className="formgrid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {/* Only the colour NAME is shown; the code is still saved silently. */}
                <Field label="Colour *" type="select" value={form.colour || ''}
                       options={colours.map((p) => ({ value: p.name, label: p.name }))}
                       onChange={(v) => {
                         const x = colours.find((p) => String(p.name) === String(v));
                         setForm({ ...form, colour: v, colour_code: x?.code || (v ? form.colour_code : '') });
                       }} required />
                <Field label="Mechanic *" type="select" value={form.machnic || ''}
                       options={mechanics.map((p) => ({ value: p.name, label: p.name }))}
                       onChange={(v) => setForm({ ...form, machnic: v })} required />
                <Field label="Battery Maker" type="select" value={form.battery_maker || ''}
                       options={batteryMakers.map((p) => ({ value: p.name, label: p.name }))}
                       onChange={(v) => setForm({ ...form, battery_maker: v })} />
              </div>

              <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'rgba(180,80,35,.05)' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Battery (Max 5)</div>
                <div className="formgrid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Field key={n} label={`Battery No. ${n}`} value={form[`battery_no${n}`] || ''}
                           onChange={(v) => setForm({ ...form, [`battery_no${n}`]: v })} />
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Actual battery quantity: <b>{batteryCount || 0}</b> / 5
                </div>
              </div>

              <Field label="Other" value={form.other} onChange={(v) => setForm({ ...form, other: v })} />
              </div>

              <aside style={{ padding: 16, background: 'rgba(180,80,35,.035)', overflowY: 'auto', maxHeight: '72vh' }}>
                <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--modal-bg)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                      <div className="muted" style={{ fontSize: 10 }}>Total Items</div>
                      <b style={{ fontSize: 14 }}>{bomPreview?.length || 0}</b>
                    </div>
                    <div style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                      <div className="muted" style={{ fontSize: 10 }}>Battery Count</div>
                      <b style={{ fontSize: 14 }}>{batteryCount} / 5</b>
                    </div>
                  </div>

                  {!bomPreview ? (
                    <div className="muted" style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
                      Product/Formulation select karte hi raw material preview yahan dikhega.
                    </div>
                  ) : bomPreview.length === 0 ? (
                    <div className="muted" style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
                      No BOM set up for this product yet.
                    </div>
                  ) : (
                    <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, padding: '8px 10px', background: 'rgba(0,0,0,.03)', fontSize: 10, fontWeight: 800 }}>
                        <span>#</span><span>Item Name</span><span>Unit</span><span style={{ textAlign: 'right' }}>Qty / Vehicle</span><span style={{ textAlign: 'right' }}>Total</span><span></span>
                      </div>
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        {bomPreview.map((l, i) => {
                          const fq = formulaQty(l.raw_item_name);
                          const added = formulaLines && fq === null;
                          const changed = !added && fq !== null && Number(l.qty) !== fq;
                          return (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, alignItems: 'center', padding: '6px 10px', borderTop: '1px solid var(--line)', fontSize: 11, background: added ? 'rgba(0,160,80,.08)' : changed ? 'rgba(255,170,0,.12)' : undefined }}>
                              <span className="muted">{i + 1}</span>
                              <span>{l.raw_item_name}{added && <b style={{ color: 'var(--green)', marginLeft: 6, fontSize: 9 }}>NEW</b>}{changed && <span className="muted" style={{ marginLeft: 6, fontSize: 9 }}>(formula: {fq})</span>}</span>
                              <span>{l.unit || '—'}</span>
                              <input className="input" type="number" min="0" step="any" value={l.qty} onChange={(e) => setLineQty(i, e.target.value)} style={{ padding: '4px 6px', fontSize: 11, textAlign: 'right', width: '100%' }} />
                              <b style={{ textAlign: 'right' }}>{Math.round((Number(l.qty) || 0) * Number(form.quantity || 1) * 10000) / 10000}</b>
                              <button type="button" className="btn danger" title="Is item ko hatao" onClick={() => removeLine(i)} style={{ padding: '2px 6px', fontSize: 11 }}>✕</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {bomPreview && (
                    <div style={{ marginTop: 10, padding: 10, border: '1px dashed var(--line)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>+ Item add karein</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 70px auto', gap: 6 }}>
                        <select className="input" value={addName} onChange={(e) => setAddName(e.target.value)} style={{ fontSize: 11 }}>
                          <option value="">Raw Material select karein</option>
                          {rawMaterials.filter((n) => !(bomPreview || []).some((l) => lk(l.raw_item_name) === lk(n))).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <input className="input" type="number" min="0" step="any" value={addQty} onChange={(e) => setAddQty(e.target.value)} style={{ fontSize: 11, textAlign: 'right' }} />
                        <button type="button" className="btn" onClick={addLine} style={{ fontSize: 11 }}>Add</button>
                      </div>
                      {bomModified && (
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11 }}>
                          <span style={{ color: '#b45309' }}><b>Formula se alag</b> - stock isi list ke hisaab se katega.</span>
                          <button type="button" className="btn" onClick={resetBom} style={{ fontSize: 11 }}>Formula par wapas</button>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,120,220,.07)', fontSize: 11 }}>
                    <b>Battery note:</b> battery quantity can be 1 to 5 depending on actual fitting. Enter Battery No. in the left section.
                  </div>
                </div>
              </aside>
            </div>

            <div className="actions" style={{ padding: '12px 24px', borderTop: '1px solid var(--line)', justifyContent: 'flex-end', background: 'var(--modal-bg)' }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

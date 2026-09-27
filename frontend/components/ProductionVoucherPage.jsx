'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);

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
  const [bomPreview, setBomPreview] = useState(null);
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
    get('/products?fro=F&page=1&per_page=1000').then((d) => setProducts(d.products || []));
    get('/production-formulas').then((d) => setFormulas(d.grouped || []));
    get('/masters/colour').then((d) => setColours(d.masters || d || [])).catch(() => {});
    get('/masters/battery-maker').then((d) => setBatteryMakers(d.masters || d || [])).catch(() => {});
    get('/masters/mechanic').then((d) => setMechanics(d.masters || d || [])).catch(() => {});
  }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const rows = data?.vouchers || [];

  const openNew = () => { setEditingId(null); setForm({ date: today(), quantity: 1, formula_name: '' }); setBomPreview(null); setOpen(true); };
  const openEdit = async (id) => {
    try {
      const d = await get(`/production-vouchers/${id}`);
      setEditingId(id);
      setForm(d.voucher || d);
      setBomPreview(null);
      setOpen(true);
    } catch (e) { setError(e.message); }
  };

  const generateCode = () => {
    if (!form.product_name) { setError('Choose a product first.'); return; }
    run(async () => {
      const q = new URLSearchParams({ product: form.product_name, date: form.date || today() });
      const gen = await get(`/production-vouchers/generate-code?${q}`);
      setForm((f) => ({ ...f, chassis_no: gen.chassis_no, motor_no: gen.motor_no, controller_no: gen.controller_no }));
      if (gen.missing_item_code) {
        setError('Note: this product has no Chassis Item Code set in Product Master — used a fallback prefix.');
      }
    });
  };

  const previewBom = async (productName = form.product_name, formulaName = form.formula_name) => {
    if (!productName) { setError('Choose a product first.'); return; }
    try {
      const q = new URLSearchParams({ product_name: productName });
      if (formulaName) q.set('formula_name', formulaName);
      const lines = await get(`/production-formulas/lines?${q}`);
      setBomPreview(Array.isArray(lines) ? lines : (lines.lines || []));
      if (!Array.isArray(lines) && !lines.lines) setError('BOM preview response is invalid.');
    } catch (e) { setError(e.message); }
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (editingId) await put(`/production-vouchers/${editingId}`, form);
      else await post('/production-vouchers', form);
      setOpen(false);
      load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this Production Voucher? The chassis record will also be removed if still in Manufacturing.')) return;
    run(async () => { await del(`/production-vouchers/${id}`); load(); });
  };

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
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Model Name</th><th>Chassis No.</th><th>Motor No.</th><th>Colour</th><th>Raw Material Lines</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.product_name}</td>
                  <td><b>{r.chassis_no}</b></td><td>{r.motor_no}</td><td>{r.colour}</td>
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
          <form className="modalbox" onSubmit={save} style={{ maxWidth: 720 }}>
            <h2>{editingId ? "Edit Production Voucher" : "New Production Voucher"}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
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
                     }} required />
              <Field label="Formula Name" type="select" value={form.formula_name}
                     options={formulasForProduct.map((g) => g.formula_name)}
                     onChange={(v) => { setForm({ ...form, formula_name: v }); previewBom(form.product_name, v); }} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Vou. No." value={form.vou_no} onChange={(v) => setForm({ ...form, vou_no: v })} />
              <Field label="Quantity" type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
            </div>

            {form.product_name && formulasForProduct.length === 0 && (
              <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
                No formula set up for this product yet — set one up in Production Formula.
              </p>
            )}

            <div className="actions" style={{ margin: '12px 0' }}>
              <button type="button" className="btn" onClick={generateCode} disabled={busy}>Generate Chassis/Motor/Controller No.</button>
              <button type="button" className="btn" onClick={() => previewBom()}>Preview BOM to be Auto-Copied</button>
            </div>

            <div className="formgrid">
              <Field label="Chassis No." value={form.chassis_no} onChange={(v) => setForm({ ...form, chassis_no: v })} required />
              <Field label="Motor No." value={form.motor_no} onChange={(v) => setForm({ ...form, motor_no: v })} />
              <Field label="Controller No." value={form.controller_no} onChange={(v) => setForm({ ...form, controller_no: v })} />
              <Field label="Differential No." value={form.differential_no} onChange={(v) => setForm({ ...form, differential_no: v })} />
              <Field label="Colour" type="select" value={form.colour || ''}
                     options={colours.map((p) => ({ value: p.name, label: p.code ? `${p.code} — ${p.name}` : p.name }))}
                     onChange={(v) => {
                       const x = colours.find((p) => String(p.name) === String(v));
                       setForm({ ...form, colour: v, colour_code: x?.code || form.colour_code });
                     }} />
              <Field label="Colour Code" value={form.colour_code} onChange={(v) => setForm({ ...form, colour_code: v })} />
              <Field label="Battery Maker" type="select" value={form.battery_maker || ''}
                     options={batteryMakers.map((p) => ({ value: p.name, label: p.name }))}
                     onChange={(v) => setForm({ ...form, battery_maker: v })} />
              <Field label="Battery No. 1" value={form.battery_no1} onChange={(v) => setForm({ ...form, battery_no1: v })} />
              <Field label="Mechanic" type="select" value={form.machnic || ''}
                     options={mechanics.map((p) => ({ value: p.name, label: p.name }))}
                     onChange={(v) => setForm({ ...form, machnic: v })} />
              <Field label="Other" value={form.other} onChange={(v) => setForm({ ...form, other: v })} />
            </div>

            {bomPreview && (
              <div style={{ marginTop: 14 }}>
                <b style={{ fontSize: 13 }}>Will auto-copy from Production Formula (leave item lines blank to use this):</b>
                {bomPreview.length === 0 ? (
                  <p className="muted">No BOM set up for this product yet — set one up in Production Formula.</p>
                ) : (
                  <ul style={{ fontSize: 13, marginTop: 6 }}>
                    {bomPreview.map((l) => <li key={l.id}>{l.raw_item_name} — {l.qty} {l.unit}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { get, post, del, getToken } from '../lib/api';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';

// Re-encodes the chosen image as a JPEG in the browser before upload, so the
// bytes saved on the server always match the .jpg extension that the
// Delivery Challan / Invoice print views look for (see PrintDocs.jsx).
function toJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob); else reject(new Error('Image could not be processed.'));
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a valid image.')); };
    img.src = url;
  });
}

// Uploads a finished-good logo, saved server-side as public/UMRN/<code>.jpg.
function LogoUploadField({ umrnCode }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const [version, setVersion] = useState(0);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const code = (umrnCode || '').trim();
    if (!code) {
      setOk(false);
      setMsg('Pehle UMRN Code bharo, uske baad hi logo upload hoga.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const jpeg = await toJpeg(file);
      const fd = new FormData();
      fd.append('umrn_code', code);
      fd.append('file', jpeg, `${code}.jpg`);
      const token = getToken();
      const r = await fetch('/api/logo-upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      setOk(true);
      setMsg('Logo upload ho gaya ✓');
      setVersion((v) => v + 1);
    } catch (err) {
      setOk(false);
      setMsg(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const code = (umrnCode || '').trim();

  return (
    <div className="field">
      <label>Finished Good Logo</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {code && (
          <img
            key={version}
            src={`/UMRN/${code}.jpg?v=${version}`}
            alt=""
            style={{ width: 40, height: 40, objectFit: 'contain', border: '1px solid #e4e7ec', borderRadius: 6, background: '#fff' }}
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        )}
        <input type="file" accept="image/*" onChange={handleFile} disabled={busy} />
      </div>
      {busy && <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>Uploading…</div>}
      {msg && <div style={{ fontSize: 12, color: ok ? '#12b76a' : '#d92d2d', marginTop: 4 }}>{msg}</div>}
      <div style={{ fontSize: 11, color: '#98a2b3', marginTop: 4 }}>
        Saved as public/UMRN/{code || '<UMRN Code>'}.jpg — Delivery Challan &amp; Invoice prints pick it up automatically.
      </div>
    </div>
  );
}

export function DealerPage() {
  const [dealers, setDealers] = useState([]);
  const [search, setSearch] = useState('');
  const [suggestedCode, setSuggestedCode] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/dealers').then((d) => { setDealers(d.dealers); setSuggestedCode(d.suggested_code); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const filteredDealers = dealers.filter((d) => {
 const q = search.trim().toLowerCase();
 if (!q) return true;
 return [d.code, d.name, d.mobile, d.gst_no, d.login_id].join(' ').toLowerCase().includes(q);
 });

 const openNew = () => { setEditingId(null); setForm({ code: suggestedCode, state_code: '07', registration_type: 'registered' }); setOpen(true); };
  const openEdit = (d) => { setEditingId(d.id); setForm({ ...d }); setOpen(true); };

  const save = (e) => {
    e.preventDefault();
    run(async () => { await post('/dealers', { ...form, id: editingId || undefined }); setOpen(false); setEditingId(null); load(); });
  };

  const remove = (id) => {
    if (!confirm('Delete this dealer? This cannot be undone.')) return;
    run(async () => { await del(`/dealers/${id}`); setOpen(false); setEditingId(null); load(); });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <div className="actions"><input className="input" placeholder="Search dealer name, code, mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />{search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}<button className="btn primary" onClick={openNew}>+ Add Dealer</button></div>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {dealers.length === 0 ? <EmptyState /> : filteredDealers.length === 0 ? <EmptyState text="No dealers match your search." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>Mobile</th><th>GSTIN</th><th>Type</th><th>State</th><th>Login ID</th><th>Blocked</th></tr></thead>
            <tbody>
              {filteredDealers.map((d) => (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td>
                    <a onClick={() => openEdit(d)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                      {d.name}
                    </a>
                  </td>
                  <td>{d.mobile}</td><td>{d.gst_no}</td><td>{d.registration_type === "unregistered" ? "Unregistered" : "Registered"}</td>
                  <td>{d.state} {d.state_code ? `(${d.state_code})` : ''}</td>
                  <td>{d.login_id}</td><td>{d.blocked ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>{editingId ? 'Edit Dealer' : 'Add Dealer'}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Dealer Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Address Line 1" value={form.address1} onChange={(v) => setForm({ ...form, address1: v })} />
              <Field label="Address Line 2" value={form.address2} onChange={(v) => setForm({ ...form, address2: v })} />
              <Field label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
              <Field label="GSTIN" value={form.gst_no} onChange={(v) => setForm({ ...form, gst_no: v })} />
              <Field label="Dealer Type" type="select" value={form.registration_type || "registered"} onChange={(v) => setForm({ ...form, registration_type: v })} options={[["registered","Registered"],["unregistered","Unregistered"]]} />
              <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
              <Field label="State Code" value={form.state_code} onChange={(v) => setForm({ ...form, state_code: v })} />
              <Field label="PAN" value={form.pan} onChange={(v) => setForm({ ...form, pan: v })} />
              <Field label="Bank Name" value={form.bank_name} onChange={(v) => setForm({ ...form, bank_name: v })} />
              <Field label="Bank Account No." value={form.bank_account_no} onChange={(v) => setForm({ ...form, bank_account_no: v })} />
              <Field label="Bank IFSC" value={form.bank_ifsc} onChange={(v) => setForm({ ...form, bank_ifsc: v })} />
              <Field label="Salesman" value={form.salesman} onChange={(v) => setForm({ ...form, salesman: v })} />
              <Field label="Blocked" type="checkbox" value={form.blocked} onChange={(v) => setForm({ ...form, blocked: v })} />\n              <Field label="Allow Purchase / Customer Invoice" type="checkbox" value={form.purchase_access} onChange={(v) => setForm({ ...form, purchase_access: v })} />
              <Field label="Dealer Login ID" value={form.login_id} onChange={(v) => setForm({ ...form, login_id: v })} />
              <Field label="Dealer Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              {editingId ? (
                <button type="button" className="btn danger" disabled={busy} onClick={() => remove(editingId)}>Delete</button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => { setOpen(false); setEditingId(null); }}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// Small table-cell indicator: shows whether a finished product's UMRN logo
// file actually exists on disk (tries loading it and reacts to onError),
// with a tiny inline preview thumbnail when it does.
function LogoStatusCell({ umrnCode, fro }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (fro !== 'F') return <span className="muted">—</span>;
  const code = (umrnCode || '').trim();
  if (!code) return <span className="pill d">No UMRN</span>;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {!failed && (
        <img
          src={`/UMRN/${code}.jpg`}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ width: 26, height: 26, objectFit: 'contain', border: '1px solid #e4e7ec', borderRadius: 5, background: '#fff', display: loaded ? 'block' : 'none' }}
        />
      )}
      {failed ? (
        <span className="pill d">No Logo</span>
      ) : loaded ? (
        <span className="pill t">Uploaded</span>
      ) : (
        <span className="muted">Checking…</span>
      )}
    </div>
  );
}

export function ProductPage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ unit: 'PCS', fro: 'F', fuel_type: 'Battery/Electric', gst_rate: 5 });
  const { busy, error, setError, run } = useAsyncAction();

  const load = (p = page) => {
    const params = new URLSearchParams({ page: p, per_page: 50 });
    if (typeFilter !== 'ALL') params.set('fro', typeFilter);
    if (search.trim()) params.set('search', search.trim());
    get(`/products?${params}`).then((d) => { setRows(d.products || []); setMeta(d); }).catch((e) => setError(e.message));
  };
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1); }, 250);
    return () => clearTimeout(t);
  }, [typeFilter, search]);

  const filtered = rows;

  const openNew = () => {
    setEditingId(null);
    setForm({ unit: 'PCS', fro: 'F', fuel_type: 'Battery/Electric', gst_rate: 5 });
    setOpen(true);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setForm({ ...p });
    setOpen(true);
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => { await post('/products', { ...form, id: editingId || undefined }); setOpen(false); load(1); });
  };

  const remove = (id) => {
    if (!confirm('Delete this product?')) return;
    run(async () => { await del(`/products/${id}`); setOpen(false); setEditingId(null); load(page); });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ Add Product</button>
        <button className={'btn' + (typeFilter === 'ALL' ? ' primary' : '')} onClick={() => setTypeFilter('ALL')}>All</button>
        <button className={'btn' + (typeFilter === 'F' ? ' primary' : '')} onClick={() => setTypeFilter('F')}>Finished</button>
        <button className={'btn' + (typeFilter === 'R' ? ' primary' : '')} onClick={() => setTypeFilter('R')}>Raw Material</button>
        <input className="input" placeholder="Search by name, code, HSN or chassis item code"
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 340 }} />
        {search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {filtered.length === 0 ? <EmptyState text={search ? 'No products match your search.' : undefined} /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Unit</th><th>GST %</th><th>HSN</th><th>Chassis Item Code</th><th>Logo</th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>
                    <a onClick={() => openEdit(p)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                      {p.name}
                    </a>
                  </td>
                  <td>{p.fro === 'F' ? 'Finished' : 'Raw Material'}</td>
                  <td>{p.unit}</td><td>{p.gst_rate}</td><td>{p.hsn_code}</td><td>{p.chassis_item_code}</td>
                  <td><LogoStatusCell umrnCode={p.umrn_code} fro={p.fro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>{editingId ? 'Edit Product' : 'Add Product'}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Type" type="select" value={form.fro}
                     options={[{ value: 'F', label: 'Finished Product' }, { value: 'R', label: 'Raw Material' }]}
                     onChange={(v) => setForm({ ...form, fro: v })} />
              <Field label="Unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
              <Field label="GST Rate %" type="number" value={form.gst_rate} onChange={(v) => setForm({ ...form, gst_rate: v })} />
              <Field label="HSN Code" value={form.hsn_code} onChange={(v) => setForm({ ...form, hsn_code: v })} />
              {form.fro === 'F' && (
                <>
                  <Field label="Chassis First Fix" value={form.chassis_first_fix ?? form.chassis_item_code ?? ''}
                         onChange={(v) => setForm({ ...form, chassis_first_fix: v, chassis_item_code: v })} />
                  <Field label="After Month & Year Fix" value={form.chassis_after_month_year_fix ?? ''}
                         onChange={(v) => setForm({ ...form, chassis_after_month_year_fix: v })} />
                  <Field label="Full Chassis No. Length" type="number" min="1" max="30" value={form.chassis_length_digits ?? 17}
                         onChange={(v) => setForm({ ...form, chassis_length_digits: v })} />
                </>
              )}
              <Field label="Type Approval No. (Form-22)" value={form.type_approval_no} onChange={(v) => setForm({ ...form, type_approval_no: v })} />
              <Field label="Fuel Type" value={form.fuel_type} onChange={(v) => setForm({ ...form, fuel_type: v })} />
              <Field label="UMRN Code" value={form.umrn_code} onChange={(v) => setForm({ ...form, umrn_code: v })} />
              {form.fro === 'F' && <LogoUploadField umrnCode={form.umrn_code} />}
              <Field label="Horn (dB)" value={form.horn_db} onChange={(v) => setForm({ ...form, horn_db: v })} />
              <Field label="Pass-by Noise (dB)" value={form.pass_by_db} onChange={(v) => setForm({ ...form, pass_by_db: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              {editingId ? (
                <button type="button" className="btn danger" disabled={busy} onClick={() => remove(editingId)}>Delete</button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => { setOpen(false); setEditingId(null); }}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

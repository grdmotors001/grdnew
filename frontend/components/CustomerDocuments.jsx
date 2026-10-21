'use client';

// Customer documents: upload / view / delete.
// - Dealer (showroom/branch) panel: Aadhaar, PAN, Photo, Record, DL, PCC
// - Admin Customer Expense Ledger: dealer wale 6 + Disclaimer, Cash Receipt, RC, Insurance, Description, Others
// Files /api/backend/customer-documents se jaati / aati hain (server par permission + dealer scope check hota hai).

import { useCallback, useEffect, useState } from 'react';
import { get, del, getToken, clearGetCache } from '../lib/api';

export const DEALER_DOC_GROUPS = [
  { types: [['aadhar', 'Aadhaar'], ['pan', 'PAN'], ['photo', 'Photo'], ['record', 'Record'], ['dl', 'DL'], ['pcc', 'PCC']] },
];

export const ADMIN_DOC_GROUPS = [
  { title: 'Customer documents (dealer uploads)', types: DEALER_DOC_GROUPS[0].types },
  { title: 'Office papers', types: [['disclaimer', 'Disclaimer'], ['cash_receipt', 'Cash Receipt'], ['rc', 'RC'], ['insurance', 'Insurance'], ['description', 'Description'], ['others', 'Others']] },
];

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 4 * 1024 * 1024;

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtDate = (v) => {
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Phone ki badi photo ko ~1800px JPEG bana do, taaki 4 MB limit me aaye aur jaldi upload ho.
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
    if (blob && (scale < 1 || blob.size < file.size)) {
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
  } catch { /* original file hi bhej do */ }
  return file;
}

async function readError(r, fallback) {
  const d = await r.json().catch(() => ({}));
  return d?.error || fallback + ' (' + r.status + ')';
}

function Preview({ doc, onClose }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true, made = '';
    fetch('/api/backend/customer-documents/' + doc.id, { headers: { Authorization: 'Bearer ' + getToken() }, cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(await readError(r, 'Could not open file')); return r.blob(); })
      .then((b) => { if (!alive) return; made = URL.createObjectURL(b); setUrl(made); })
      .catch((e) => { if (alive) setErr(e.message || 'Could not open file'); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [doc.id]);

  const isPdf = doc.mime === 'application/pdf';
  return (
    <div className="modal" style={{ zIndex: 10002 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalbox" style={{ maxWidth: 980, width: '96%', maxHeight: '94vh', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ wordBreak: 'break-all' }}>{doc.file_name}</b>
          <div style={{ display: 'flex', gap: 8 }}>
            {url && <a className="btn" href={url} download={doc.file_name} style={{ textDecoration: 'none' }}>Download</a>}
            {url && <a className="btn" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in new tab</a>}
            <button type="button" className="btn" onClick={onClose}>✕</button>
          </div>
        </div>
        {err && <div className="error">{err}</div>}
        {!url && !err && <div className="muted">Loading…</div>}
        {url && (isPdf
          ? <iframe title={doc.file_name} src={url} style={{ width: '100%', height: '78vh', border: '1px solid var(--line)', borderRadius: 8 }} />
          : <div style={{ overflow: 'auto', textAlign: 'center' }}><img src={url} alt={doc.file_name} style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 8 }} /></div>)}
      </div>
    </div>
  );
}

export function CustomerDocumentsPanel({ groups = DEALER_DOC_GROUPS, query, scope = 'dealer' }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);

  const qs = new URLSearchParams();
  if (query?.customer_id) qs.set('customer_id', String(query.customer_id));
  if (query?.invoice_id) qs.set('invoice_id', String(query.invoice_id));
  const qsText = qs.toString();

  const load = useCallback(async () => {
    try {
      const d = await get('/customer-documents?' + qsText, { noClientCache: true });
      setDocs(d.documents || []);
    } catch (e) {
      setError(e.message || 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, [qsText]);

  useEffect(() => { setLoading(true); setError(''); load(); }, [load]);

  const upload = async (type, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError(''); setBusy(type);
    const problems = [];
    for (const original of files) {
      try {
        const type0 = (original.type || '').toLowerCase();
        if (!OK_TYPES.includes(type0)) throw new Error(original.name + ': only JPG, PNG, WEBP or PDF allowed.');
        const file = await prepare(original);
        if (file.size > MAX_BYTES) throw new Error(original.name + ': file is larger than 4 MB.');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('doc_type', type);
        if (query?.customer_id) fd.append('customer_id', String(query.customer_id));
        if (query?.invoice_id) fd.append('invoice_id', String(query.invoice_id));
        const r = await fetch('/api/backend/customer-documents', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd });
        if (!r.ok) throw new Error(original.name + ': ' + await readError(r, 'Upload failed'));
      } catch (e) {
        problems.push(e.message || 'Upload failed');
      }
    }
    clearGetCache();
    await load();
    setBusy('');
    if (problems.length) setError(problems.join('  '));
  };

  const remove = async (doc) => {
    if (!window.confirm('Delete "' + doc.file_name + '"?')) return;
    setError('');
    try { await del('/customer-documents/' + doc.id); await load(); }
    catch (e) { setError(e.message || 'Could not delete'); }
  };

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading documents…</div>}
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: gi ? 18 : 6 }}>
          {g.title && <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{g.title}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
            {g.types.map(([key, label]) => {
              const list = docs.filter((d) => d.doc_type === key);
              return (
                <div key={key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <b>{label}{list.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {list.length}</span>}</b>
                    <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer', padding: '5px 10px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>
                      {busy === key ? 'Uploading…' : (list.length ? '+ Add' : 'Upload')}
                      <input type="file" multiple accept="image/*,application/pdf" disabled={!!busy} style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files; upload(key, f).finally(() => { e.target.value = ''; }); }} />
                    </label>
                  </div>
                  {list.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Not uploaded yet</div>}
                  {list.map((d) => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.file_name}>{d.file_name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{fmtSize(d.size)} · {fmtDate(d.created_at)}{scope === 'staff' && d.uploaded_scope === 'dealer' ? ' · dealer' : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                        <button type="button" className="btn" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setPreview(d)}>View</button>
                        {(scope === 'staff' || d.uploaded_scope === 'dealer') && <button type="button" className="btn danger" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => remove(d)}>Delete</button>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>JPG / PNG / WEBP / PDF · photos automatically compress hoti hain · max 4 MB per file.</div>
      {preview && <Preview doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export function CustomerDocumentsModal({ title, subtitle, onClose, ...panel }) {
  return (
    <div className="modal" style={{ zIndex: 10001 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalbox" style={{ maxWidth: 960, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>{title || 'Documents'}</h2>
            {subtitle && <p className="muted" style={{ margin: '4px 0 0' }}>{subtitle}</p>}
          </div>
          <button type="button" className="btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <CustomerDocumentsPanel {...panel} />
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

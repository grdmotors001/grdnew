'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { ErrorBanner, Field, EmptyState } from './ui';
import { formatDate } from '../lib/date';
import { Overlay } from './PrintDocs';

// Manual Challan (Factory handover slip) — haath se bharne wale slip ka digital form + Print Preview.
// Old Rickshaw Challan Voucher page par chalta hai. Inventory / stock se juda nahi: sirf record + print.
const today = () => new Date().toISOString().slice(0, 10);
const OK = [{ value: 'OK', label: 'OK' }, { value: 'NO', label: 'NO' }, { value: 'N/A', label: 'N/A' }];
const blank = (sno = '', sp_no = '') => ({
  id: null, sno, sp_no, date: today(), dealer_id: '', dealer_name: '', chassis_no: '', vehicle_no: '', model_name: '',
  toolkit: 'OK', keys: 'OK', charger: 'OK', colour: '', mat: 'OK', stepney: 'OK', battery: '',
  extra_items: '', contact_name: '', contact_mobile: '', remarks: '',
});
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '');

const SLIP_CSS = `
.gp{font-family:Arial,Helvetica,sans-serif;color:#111;border:4px solid #004a98;background:#fff;width:100%;max-width:520px;margin:0 auto;box-sizing:border-box}
.gp .top{background:#004a98;color:#fff;text-align:center;font-weight:900;font-size:44px;letter-spacing:1px;line-height:1.15;padding:6px 0 8px}
.gp .bd{padding:14px 18px 16px}
.gp .r{display:flex;gap:22px;align-items:flex-end;margin:0 0 26px}
.gp .c{flex:1;display:flex;align-items:flex-end;gap:6px;min-width:0}
.gp .l{font-weight:800;font-size:17px;white-space:nowrap}
.gp .v{flex:1;border-bottom:2px dotted #111;min-height:24px;padding:0 4px 1px;font-size:16px;font-weight:700;color:#0b2a8a;word-break:break-word}
.gp .sno{font-size:24px;font-weight:800;color:#111}
.gp .rm{display:flex;border:2px solid #004a98;border-radius:8px;min-height:190px;margin-top:6px}
.gp .rm .a{flex:1.1;padding:8px 10px;font-size:14px;font-weight:700;border-right:2px solid #004a98}
.gp .rm .a b{font-size:17px}
.gp .rm .a div{font-weight:600;color:#0b2a8a;margin-top:4px;white-space:pre-wrap;word-break:break-word}
.gp .rm .z{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:8px 10px;text-align:center}
.gp .ct{font-size:14px;font-weight:700;color:#0b2a8a;margin-bottom:auto;align-self:flex-start}
.gp .sg{width:100%;border-top:2px dotted #111;margin-top:10px;padding-top:4px;font-weight:800;font-size:17px}
@media print{.gp{max-width:140mm}}
`;

function Row({ items }) {
  return (
    <div className="r">
      {items.map(([label, value]) => (
        <div className="c" key={label}>
          <span className={'l'}>{label} :</span>
          <span className={'v' + (label === 'S. No.' ? ' sno' : '')}>{value || ''}</span>
        </div>
      ))}
    </div>
  );
}

// Gate Pass layout (factory slip jaisa): blue header, dotted lines, neeche Remarks + Signature box.
export function ManualChallanSlip({ c }) {
  const remarks = [c.extra_items ? 'Other: ' + c.extra_items : '', c.remarks].filter(Boolean).join('\n');
  return (
    <div className="gp">
      <style>{SLIP_CSS}</style>
      <div className="top">GATE PASS</div>
      <div className="bd">
        <Row items={[['S. No.', c.sno], ['Date', fmt(c.date)]]} />
        <Row items={[['Dealer Name', c.dealer_name]]} />
        <Row items={[['Chassis No.', c.chassis_no]]} />
        <Row items={[['Vehicle No.', c.vehicle_no]]} />
        <Row items={[['Toll Kit', c.toolkit], ['Keys', c.keys]]} />
        <Row items={[['Charger', c.charger], ['Colour', c.colour]]} />
        <Row items={[['Mat', c.mat], ['Stepney', c.stepney]]} />
        <Row items={[['Battery', c.battery]]} />
        <div className="rm">
          <div className="a"><b>Remarks :</b><div>{remarks}</div></div>
          <div className="z">
            <div className="ct">{c.contact_name}{c.contact_name && c.contact_mobile ? <br /> : null}{c.contact_mobile}</div>
            <div className="sg">Signature</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ManualChallanPreview({ c, company, onClose }) {
  return (
    <Overlay onClose={onClose} title={'Gate Pass — S. No. ' + (c.sno || '')}>
      <ManualChallanSlip c={c} />
    </Overlay>
  );
}

export function ManualChallanSection({ openSignal = 0 }) {
  const [data, setData] = useState({ rows: [], dealers: [], next_sno: '', next_sp_no: '', company: {} });
  const [form, setForm] = useState(blank());
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const load = async (s = search) => {
    try {
      setError('');
      const q = s.trim() ? '?search=' + encodeURIComponent(s.trim()) : '';
      setData(await get('/manual-challans' + q));
    } catch (e) { setError(e.message || 'Manual challan load nahi hua.'); }
  };
  useEffect(() => { load(''); }, []);
  useEffect(() => { const t = setTimeout(() => load(search), 300); return () => clearTimeout(t); }, [search]);

  const setF = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const pickDealer = (name) => {
    const d = (data.dealers || []).find((x) => String(x.name).trim().toLowerCase() === String(name).trim().toLowerCase());
    setForm((x) => ({ ...x, dealer_name: name, dealer_id: d ? d.id : '' }));
  };
  useEffect(() => { if (openSignal > 0) openNew(); }, [openSignal]);
  const openNew = () => { setForm(blank(data.next_sno, data.next_sp_no)); setError(''); setOpen(true); };
  const openEdit = (r) => { setForm({ ...blank(), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])) }); setError(''); setOpen(true); };

  const save = async (e, thenPreview = false) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post('/manual-challans', form);
      setOpen(false);
      await load();
      if (r && r.stock_linked === false && form.vehicle_no) setError('Challan save ho gaya, par gaadi dealer ke stock se nahi judi: Dealer ko list me se chuno (naam bilkul master jaisa) aur dobara Save karo.');
      if (thenPreview && r?.challan) setPreview(r.challan);
    } catch (err) { setError(err.message || 'Save nahi hua.'); }
    finally { setBusy(false); }
  };
  const toggleCancel = async (r) => {
    if (!confirm((r.cancelled ? 'Un-cancel' : 'Cancel') + ' S. No. ' + r.sno + '?')) return;
    try { await post('/manual-challans/' + r.id, {}); load(); } catch (err) { setError(err.message); }
  };
  const remove = async (r) => {
    if (!confirm('S. No. ' + r.sno + ' permanently delete karna hai?')) return;
    try { await del('/manual-challans/' + r.id); load(); } catch (err) { setError(err.message); }
  };

  const rows = data.rows || [];
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>New Rickshaw — Manual Challan (Gate Pass)</h3>
          <div className="muted">Factory se nayi gaadi nikalne par jo slip haath se bharte the. Upar "+ New Voucher" dabake banao, yahan list, Preview aur Print milega.</div>
        </div>
        <div className="actions">
          <input className="input" type="search" placeholder="S.No / SP No / dealer / chassis / vehicle no…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
        </div>
      </div>
      {!open && <ErrorBanner message={error} />}
      {!rows.length ? <EmptyState text="Abhi koi Manual Challan nahi bana." /> : (
        <div className="tablewrap"><table className="table">
          <thead><tr><th>S. No.</th><th>SP No.</th><th>Date</th><th>Dealer</th><th>Chassis No.</th><th>Vehicle No.</th><th>Battery</th><th>Mobile</th><th>Dealer Stock</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={r.cancelled ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
              <td><b>{r.sno}</b></td><td><b>{r.sp_no || '—'}</b></td><td>{formatDate(r.date)}</td><td>{r.dealer_name}</td><td>{r.chassis_no || '—'}</td>
              <td>{r.vehicle_no || '—'}</td><td>{r.battery || '—'}</td><td>{r.contact_mobile || '—'}</td>
              <td>{r.old_rickshaw_id ? '✓ Dealer stock me hai' : '—'}</td>
              <td>{r.cancelled ? 'CANCELLED' : 'ACTIVE'}</td>
              <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setPreview(r)}>Preview / Print</button>
                <button className="btn" onClick={() => openEdit(r)}>Edit</button>
                <button className="btn" onClick={() => toggleCancel(r)}>{r.cancelled ? 'Un-cancel' : 'Cancel'}</button>
                <button className="btn danger" onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {open && (
        <div className="modal"><form className="modalbox" style={{ maxWidth: 900 }} onSubmit={(e) => save(e, false)}>
          <h2>{form.id ? 'Edit Manual Challan' : 'New Manual Challan'}</h2>
          <ErrorBanner message={error} />
          <div className="formgrid">
            <Field label="S. No. (slip book wala number)" value={form.sno} onChange={(v) => setF('sno', v)} />
            <Field label="SP No. (auto — chaaho to badlo, jaise SP-22/2101)" value={form.sp_no} onChange={(v) => setF('sp_no', v)} />
            <Field label="Date" type="date" value={form.date} onChange={(v) => setF('date', v)} required />
            <Field label="Dealer Name" type="combo" value={form.dealer_name} options={(data.dealers || []).map((d) => ({ value: d.name, label: d.name }))} onChange={pickDealer} required />
            <Field label="Chassis No." value={form.chassis_no} onChange={(v) => setF('chassis_no', v)} />
            <Field label="Vehicle No." value={form.vehicle_no} onChange={(v) => setF('vehicle_no', v)} />
            <Field label="Model (optional)" value={form.model_name} onChange={(v) => setF('model_name', v)} />
            <Field label="Toll Kit" type="combo" value={form.toolkit} options={OK} onChange={(v) => setF('toolkit', v)} />
            <Field label="Keys" type="combo" value={form.keys} options={OK} onChange={(v) => setF('keys', v)} />
            <Field label="Charger" type="combo" value={form.charger} options={OK} onChange={(v) => setF('charger', v)} />
            <Field label="Colour" value={form.colour} onChange={(v) => setF('colour', v)} />
            <Field label="Mat" type="combo" value={form.mat} options={OK} onChange={(v) => setF('mat', v)} />
            <Field label="Stepney" type="combo" value={form.stepney} options={OK} onChange={(v) => setF('stepney', v)} />
            <Field label="Battery" value={form.battery} onChange={(v) => setF('battery', v)} />
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Other Fitments (jaise: Jack OK, Side mirror OK, Wheel cover OK)" value={form.extra_items} onChange={(v) => setF('extra_items', v)} />
            </div>
            <Field label="Name (slip ke neeche)" value={form.contact_name} onChange={(v) => setF('contact_name', v)} />
            <Field label="Mobile No." value={form.contact_mobile} onChange={(v) => setF('contact_mobile', v)} />
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Remarks" value={form.remarks} onChange={(v) => setF('remarks', v)} />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={(e) => save(e, true)}>Save &amp; Preview</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form></div>
      )}

      {preview && <ManualChallanPreview c={preview} company={data.company} onClose={() => setPreview(null)} />}
    </div>
  );
}

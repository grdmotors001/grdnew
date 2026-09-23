'use client';
import { useState } from 'react';
import { post } from '../lib/api';
import { SIMPLE_MASTERS } from '../lib/menu';
import { Field, ErrorBanner, useAsyncAction } from './ui';

const CATEGORIES = Object.entries(SIMPLE_MASTERS).map(([kind, meta]) => [kind, meta.label]);
export function QuickMasterPage({ setActive }) {
  const [kind, setKind] = useState('');
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(null);
  const { busy, error, run } = useAsyncAction();
  const meta = kind ? SIMPLE_MASTERS[kind] : null;
  const chooseKind = (k) => { setKind(k); setForm({}); setSaved(null); };
  const save = (e) => { e.preventDefault(); run(async () => { const row = await post(`/masters/${kind}`, form); setSaved(row); setForm({}); }); };
  return <div className="card"><h2 style={{ marginTop: 0 }}>Add Master</h2><p className="muted" style={{ marginTop: -6 }}>Pehle category chuno ki yeh naam kis master ka hissa hai, phir uska form khul jayega.</p><div className="formgrid" style={{ marginBottom: kind ? 18 : 0 }}><Field label="Category — which master does this belong to?" type="select" value={kind} options={[{ value: '', label: 'Select category…' }, ...CATEGORIES.map(([k, l]) => ({ value: k, label: l }))]} onChange={chooseKind} /></div>{kind && <form onSubmit={save}><h3 style={{ marginBottom: 10 }}>{meta.label}</h3><ErrorBanner message={error} />{saved && <div className="card" style={{ marginBottom: 12 }}><b>{meta.label} "{saved.name}" saved.</b>{' '}<a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setActive?.(kind)}>Open {meta.label} list</a></div>}<div className="formgrid">{meta.fields.map(([f, l, type]) => <Field key={f} label={l} type={type} value={form[f]} onChange={(v) => setForm({ ...form, [f]: v })} required={f === 'name'} />)}</div><div className="actions" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : `Save ${meta.label}`}</button><button type="button" className="btn" onClick={() => chooseKind('')}>Change Category</button></div></form>}</div>;
}

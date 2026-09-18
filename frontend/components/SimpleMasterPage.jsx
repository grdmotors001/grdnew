'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { SIMPLE_MASTERS } from '../lib/menu';
import { Field, Card, ErrorBanner, EmptyState, useAsyncAction } from './ui';

export function SimpleMasterPage({ kind }) {
  const meta = SIMPLE_MASTERS[kind] || { label: kind, fields: [['name', 'Name', 'text']] };
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get(`/masters/${kind}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); setSearch(''); }, [kind]);

  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return meta.fields.some(([f]) => String(r[f] ?? '').toLowerCase().includes(q));
  });

  const openNew = () => { setEditingId(null); setForm({}); setOpen(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ ...r }); setOpen(true); };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (editingId) await put(`/masters/${kind}/${editingId}`, form);
      else await post(`/masters/${kind}`, form);
      setForm({});
      setEditingId(null);
      setOpen(false);
      load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this record?')) return;
    run(async () => {
      await del(`/masters/${kind}/${id}`);
      setOpen(false);
      setEditingId(null);
      load();
    });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ Add {meta.label}</button>
        {rows.length > 0 && <><input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />{search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}</>}
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {rows.length === 0 ? <EmptyState /> : filteredRows.length === 0 ? <EmptyState text="No records match your search." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>{meta.fields.map(([f, l]) => <th key={f}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  {meta.fields.map(([f], i) => (
                    <td key={f}>
                      {i === 0 ? (
                        <a onClick={() => openEdit(r)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                          {String(r[f] ?? '')}
                        </a>
                      ) : f === 'is_default' ? (r[f] ? 'Yes' : '') : String(r[f] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>{editingId ? `Edit ${meta.label}` : `Add ${meta.label}`}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              {meta.fields.map(([f, l, type]) => (
                <Field key={f} label={l} type={type} value={form[f]} onChange={(v) => setForm({ ...form, [f]: v })} required={f === 'name'} />
              ))}
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

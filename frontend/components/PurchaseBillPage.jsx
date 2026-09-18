'use client';
import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({ item_name: '', hsn_code: '', qty: 1, rate: 0, gst_rate: 18 });

export function PurchaseBillPage() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [form, setForm] = useState({ date: today(), party_state_code: '07', items: [blankItem()] });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/purchase-bills').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const filteredRows = rows.filter((b) => {
    if (search && !(b.party_name || '').toLowerCase().includes(search.toLowerCase()) && !(b.bill_no || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    return true;
  });

  const openNew = () => { setForm({ date: today(), party_state_code: '07', items: [blankItem()] }); setOpen(true); };
  const openEdit = (b, e) => {
    e.stopPropagation();
    setForm({
      id: b.id, bill_no: b.bill_no, date: b.date, party_name: b.party_name,
      party_gst_no: b.party_gst_no, party_state_code: b.party_state_code, remarks: b.remarks,
      items: b.items.map((it) => ({ item_name: it.item_name, hsn_code: it.hsn_code, qty: it.qty, rate: it.rate, gst_rate: it.gst_rate })),
    });
    setOpen(true);
  };

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, blankItem()] });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (form.id) await put(`/purchase-bills/${form.id}`, form);
      else await post('/purchase-bills', form);
      setOpen(false);
      load();
    });
  };

  const remove = (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this Purchase Bill?')) return;
    run(async () => { await del(`/purchase-bills/${id}`); load(); });
  };

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <Field label="Search (Party / Bill No.)" value={search} onChange={setSearch} />
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={openNew}>+ New Purchase Bill</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {filteredRows.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th></th><th>Party</th><th>Date</th><th>Bill No.</th><th>Taxable</th><th>Tax</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {filteredRows.map((b) => {
                const isOpen = expanded.has(b.id);
                return (
                  <React.Fragment key={b.id}>
                    <tr onClick={() => toggleExpanded(b.id)} style={{ cursor: 'pointer' }} title="Click to view items">
                      <td style={{ width: 20 }}>{isOpen ? '▾' : '▸'}</td>
                      <td><b>{b.party_name}</b></td>
                      <td>{formatDate(b.date)}</td>
                      <td>{b.bill_no || '.'}</td>
                      <td><Money value={b.taxable_total} /></td>
                      <td><Money value={b.tax_total} /></td>
                      <td><b><Money value={b.bill_total} /></b></td>
                      <td>
                        <button className="btn" style={{ marginRight: 6 }} onClick={(e) => openEdit(b, e)}>Edit</button>
                        <button className="btn danger" onClick={(e) => remove(b.id, e)}>Delete</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <div className="tablewrap" style={{ margin: '4px 0 12px' }}>
                            <table className="table">
                              <thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th></tr></thead>
                              <tbody>
                                {b.items.map((it) => (
                                  <tr key={it.id}>
                                    <td>{it.item_name}</td><td>{it.hsn_code}</td><td>{it.qty}</td><td><Money value={it.rate} /></td>
                                    <td><Money value={it.taxable_amt} /></td><td><Money value={it.cgst_amt} /></td>
                                    <td><Money value={it.sgst_amt} /></td><td><Money value={it.igst_amt} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save} style={{ maxWidth: 880 }}>
            <h2>{form.id ? 'Edit Purchase Bill' : 'New Purchase Bill'}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Bill No." value={form.bill_no} onChange={(v) => setForm({ ...form, bill_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Party Name" value={form.party_name} onChange={(v) => setForm({ ...form, party_name: v })} required />
              <Field label="Party GSTIN" value={form.party_gst_no} onChange={(v) => setForm({ ...form, party_gst_no: v })} />
              <Field label="Party State Code" value={form.party_state_code} onChange={(v) => setForm({ ...form, party_state_code: v })} />
              <Field label="Remarks" value={form.remarks} onChange={(v) => setForm({ ...form, remarks: v })} />
            </div>

            <div style={{ marginTop: 14 }}>
              <b style={{ fontSize: 13 }}>Items</b>
              <div className="tablewrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead><tr><th>Item Name</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th></th></tr></thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx}>
                        <td><input value={it.item_name} onChange={(e) => updateItem(idx, 'item_name', e.target.value)} required /></td>
                        <td><input value={it.hsn_code} onChange={(e) => updateItem(idx, 'hsn_code', e.target.value)} /></td>
                        <td><input type="number" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} style={{ width: 70 }} /></td>
                        <td><input type="number" value={it.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} style={{ width: 90 }} /></td>
                        <td><input type="number" value={it.gst_rate} onChange={(e) => updateItem(idx, 'gst_rate', e.target.value)} style={{ width: 70 }} /></td>
                        <td><button type="button" className="btn danger" onClick={() => removeItem(idx)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={addItem}>+ Add Item Line</button>
            </div>

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

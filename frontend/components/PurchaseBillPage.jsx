'use client';
import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({ item_name: '', hsn_code: '', qty: 1, rate: 0, gst_rate: 18, item_type: 'product', is_battery: false, battery_maker: '' });
const n = (v) => Number(v || 0);
const itemCalc = (it) => {
  const taxable = n(it.qty) * n(it.rate);
  const gst = taxable * n(it.gst_rate) / 100;
  const interstate = String(it._stateCode || '') !== '07';
  return { taxable, gst: interstate ? 0 : gst, cgst: interstate ? 0 : gst / 2, sgst: interstate ? 0 : gst / 2, igst: interstate ? gst : 0, total: taxable + gst };
};

export function PurchaseBillPage() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [batteryMakers, setBatteryMakers] = useState([]);
  const [form, setForm] = useState({ date: today(), party_state_code: '07', items: [blankItem()] });
  const totals = form.items.reduce((a, it) => { const x = itemCalc({ ...it, _stateCode: form.party_state_code }); a.taxable += x.taxable; a.cgst += x.cgst; a.sgst += x.sgst; a.igst += x.igst; a.total += x.total; return a; }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/purchase-bills').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    get('/masters/battery-maker').then((d) => setBatteryMakers(Array.isArray(d) ? d : (d.masters || []))).catch(() => setBatteryMakers([]));
  }, []);

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
      items: (b.items || []).map((it) => ({ item_name: it.item_name, hsn_code: it.hsn_code, qty: it.qty, rate: it.rate, gst_rate: it.gst_rate, item_type: it.item_type || (it.is_battery ? 'battery' : 'product'), is_battery: Boolean(it.is_battery) || it.item_type === 'battery', battery_maker: it.battery_maker || '' })),
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
          <form className="modalbox purchaseBillModal" onSubmit={save} style={{ maxWidth: 1180, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                <div><div style={{fontSize:12,color:'#64748b',fontWeight:700,textTransform:'uppercase'}}>Purchase Voucher</div><h2 style={{margin:'3px 0 0'}}>{form.id ? 'Edit Purchase Bill' : 'New Purchase Bill'}</h2></div>
                <button type="button" className="btn" onClick={() => setOpen(false)}>✕</button>
              </div>
            </div>
            <div style={{padding:22}}>
              <ErrorBanner message={error} />
              <div className="purchaseBillHeadGrid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:14,background:'#f8fafc',padding:16,borderRadius:10}}>
                <Field label="Supplier / Party Name" value={form.party_name} onChange={(v) => setForm({...form,party_name:v})} required />
                <Field label="Supplier GSTIN" value={form.party_gst_no} onChange={(v) => setForm({...form,party_gst_no:v.toUpperCase()})} />
                <Field label="Supplier Invoice No." value={form.bill_no} onChange={(v) => setForm({...form,bill_no:v})} />
                <Field label="Invoice Date" type="date" value={form.date} onChange={(v) => setForm({...form,date:v})} />
                <Field label="State Code" value={form.party_state_code} onChange={(v) => setForm({...form,party_state_code:v})} />
                <div style={{gridColumn:'span 3'}}><Field label="Remarks" value={form.remarks} onChange={(v) => setForm({...form,remarks:v})} /></div>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'22px 0 8px'}}>
                <div><b style={{fontSize:15}}>Item Details</b><div style={{fontSize:12,color:'#64748b'}}>Battery purchase me sirf company aur quantity enter karein — Battery No. purchase ke time nahi liya jayega. Battery No. Delivery Challan par enter hoga.</div></div>
                <button type="button" className="btn primary" onClick={addItem}>+ Add Item</button>
              </div>

              <div className="tablewrap purchaseItemWrap" style={{border:'1px solid #e2e8f0',borderRadius:10}}>
                <table className="table purchaseItemTable">
                  <thead><tr><th>#</th><th>Type</th><th style={{minWidth:220}}>Item / Description</th><th>Battery Company</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Taxable</th><th>GST</th><th>Total</th><th></th></tr></thead>
                  <tbody>
                    {form.items.map((it, idx) => { const x=itemCalc({...it,_stateCode:form.party_state_code}); return (
                      <tr key={idx}>
                        <td data-label="#">{idx+1}</td>
                        <td data-label="Type"><select value={it.item_type || (it.is_battery ? 'battery' : 'product')} onChange={(e)=>{const type=e.target.value;updateItem(idx,'item_type',type);updateItem(idx,'is_battery',type==='battery');if(type==='battery'&&!it.item_name)updateItem(idx,'item_name','Battery');}}><option value="product">Product / Material</option><option value="battery">Battery</option></select></td>
                        <td data-label="Item / Description"><input value={it.item_name} placeholder={it.item_type==='battery'?'Battery':'Enter item name'} onChange={(e)=>updateItem(idx,'item_name',e.target.value)} required /></td>
                        <td data-label="Battery Company">{(it.item_type==='battery'||it.is_battery)?<select value={it.battery_maker||''} onChange={(e)=>updateItem(idx,'battery_maker',e.target.value)} required><option value="">Select Battery Company</option>{batteryMakers.map((m)=><option key={m.id||m.name} value={m.name}>{m.name}</option>)}</select>:<span className="muted">—</span>}</td>
                        <td data-label="HSN/SAC"><input value={it.hsn_code} placeholder="HSN" onChange={(e)=>updateItem(idx,'hsn_code',e.target.value)} /></td>
                        <td data-label="Qty"><input type="number" min="0" step="0.01" value={it.qty} onChange={(e)=>updateItem(idx,'qty',e.target.value)} /></td>
                        <td data-label="Rate"><input type="number" min="0" step="0.01" value={it.rate} onChange={(e)=>updateItem(idx,'rate',e.target.value)} /></td>
                        <td data-label="GST %"><input type="number" min="0" step="0.01" value={it.gst_rate} onChange={(e)=>updateItem(idx,'gst_rate',e.target.value)} /></td>
                        <td data-label="Taxable"><Money value={x.taxable}/></td><td data-label="GST"><Money value={x.cgst+x.sgst+x.igst}/></td><td data-label="Total"><b><Money value={x.total}/></b></td>
                        <td data-label="Action">{form.items.length>1 && <button type="button" className="btn danger" onClick={()=>removeItem(idx)}>✕</button>}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr minmax(280px,360px)',gap:20,marginTop:18}}>
                <div style={{padding:14,background:'#f8fafc',borderRadius:10,fontSize:13}}>
                  <b>Tax Summary</b>
                  <div style={{display:'flex',gap:22,marginTop:10,flexWrap:'wrap'}}>
                    <span>Taxable: <b><Money value={totals.taxable}/></b></span>
                    <span>CGST: <b><Money value={totals.cgst}/></b></span>
                    <span>SGST: <b><Money value={totals.sgst}/></b></span>
                    <span>IGST: <b><Money value={totals.igst}/></b></span>
                  </div>
                </div>
                <div style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}><span>Taxable Amount</span><b><Money value={totals.taxable}/></b></div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginTop:8}}><span>Total GST</span><b><Money value={totals.cgst+totals.sgst+totals.igst}/></b></div>
                  <div style={{borderTop:'2px solid #0f172a',marginTop:12,paddingTop:12,display:'flex',justifyContent:'space-between',fontSize:18}}><b>Grand Total</b><b><Money value={totals.total}/></b></div>
                </div>
              </div>

              <div className="actions" style={{marginTop:20}}>
                <button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Purchase Bill'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

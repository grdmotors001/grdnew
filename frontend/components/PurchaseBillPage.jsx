'use client';
import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({ item_name: '', hsn_code: '', qty: 1, rate: 0, gst_rate: 18, item_type: 'product', is_battery: false, battery_maker: '', battery_master_id: '', product_id: '' });
const n = (v) => Number(v || 0);
const asList = (d) => (Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.products || []));
// Account Head Master ka kind name agar alag ho to yahan badal dein (pehla jo data de wahi use hoga).
const ACCOUNT_HEAD_KINDS = ['account-head', 'account_head', 'account-head-master', 'account-heads'];
const headName = (h) => String(h?.name || h?.account_head || h?.head || '').trim();
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
// Sub category kisi bhi field me ho sakti hai — poore row me "indirect expense" dhoondhta hai.
const isIndirectExpense = (h) => Object.values(h || {}).some((v) => typeof v === 'string' && norm(v) === 'indirect expense');
const parseExtra = (v) => { try { const x = typeof v === 'string' ? JSON.parse(v || '[]') : v; return Array.isArray(x) ? x.map((e) => ({ account_head: e.account_head || '', amount: e.amount ?? '', gst_rate: e.gst_rate ?? 0 })) : []; } catch { return []; } };
const blankExtra = () => ({ account_head: '', amount: '', gst_rate: 0 });
const extraCalc = (e, stateCode) => { const amt = n(e.amount); const gst = amt * n(e.gst_rate) / 100; const inter = String(stateCode || '') !== '07'; return { amt, gst, cgst: inter ? 0 : gst / 2, sgst: inter ? 0 : gst / 2, igst: inter ? gst : 0, total: amt + gst }; };
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
  const [makerErr, setMakerErr] = useState('');
  const [parties, setParties] = useState([]);
  const [products, setProducts] = useState([]);
  const [expenseHeads, setExpenseHeads] = useState([]);
  const [form, setForm] = useState({ date: today(), party_state_code: '07', items: [blankItem()], extra_charges: [] });
  const totals = form.items.reduce((a, it) => { const x = itemCalc({ ...it, _stateCode: form.party_state_code }); a.taxable += x.taxable; a.cgst += x.cgst; a.sgst += x.sgst; a.igst += x.igst; a.total += x.total; return a; }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  const extraSum = (form.extra_charges || []).reduce((a, e) => { const x = extraCalc(e, form.party_state_code); a.amt += x.amt; a.cgst += x.cgst; a.sgst += x.sgst; a.igst += x.igst; a.gst += x.gst; return a; }, { amt: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 });
  const extraTotal = extraSum.amt;
  const allCgst = totals.cgst + extraSum.cgst, allSgst = totals.sgst + extraSum.sgst, allIgst = totals.igst + extraSum.igst;
  const grandTotal = totals.total + extraSum.amt + extraSum.gst;
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/purchase-bills').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const pickRows = (d) => Array.isArray(d) ? d : (Array.isArray(d?.masters) ? d.masters : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.data) ? d.data : Array.isArray(d?.items) ? d.items : []);
    const toMakers = (rows) => { const seen = new Set(); return rows.map((m) => (typeof m === 'string' ? { name: m } : m)).filter((m) => { const nm = String(m?.name || '').trim(); const k = nm.toLowerCase(); if (!nm || seen.has(k)) return false; seen.add(k); return true; }).filter((m) => String(m.name).trim() !== '-').map((m) => ({ ...m, name: String(m.name).trim() })); };
    get('/masters/battery-maker', { noClientCache: true })
      .then((d) => {
        const list = toMakers(pickRows(d));
        if (list.length) { setBatteryMakers(list); setMakerErr(''); return; }
        // Master khali/alag ho to Battery Register ki maker list se lo.
        return get('/battery-register', { noClientCache: true }).then((r) => {
          const alt = toMakers([...(r?.makers || []), ...((r?.summary || []).map((x) => x.battery_maker))]);
          setBatteryMakers(alt);
          setMakerErr(alt.length ? '' : 'Battery Maker Master me koi naam nahi mila. Pehle Battery Maker Master me company add karein.');
        });
      })
      .catch((e) => { setBatteryMakers([]); setMakerErr('Battery Maker list load nahi hui: ' + (e?.message || 'error')); });
    get('/masters/party').then((d) => setParties(asList(d))).catch(() => setParties([]));
    // Item dropdown: Raw Material + Dispatched Material (Product Master se)
    Promise.all([
      get('/products?fro=R&per_page=1000').then(asList).catch(() => []),
      get('/products?category=DISPATCH&per_page=1000').then(asList).catch(() => []),
    ]).then(([raw, dispatch]) => {
      const seen = new Set();
      const all = [];
      [...raw, ...dispatch].forEach((p) => { if (p?.id != null && !seen.has(p.id)) { seen.add(p.id); all.push(p); } });
      setProducts(all);
    });
    // Expense dropdown: Account Head Master me se sirf "Indirect Expense"
    (async () => {
      // Kind ka naam guess nahi karte: saare master kinds scan karke jahan Sub Category "Indirect Expense" mile wahi heads lete hain.
      let kinds = [];
      try { const k = await get('/masters'); kinds = Array.isArray(k) ? k : (k?.kinds || []); } catch { /* fallback below */ }
      kinds = [...new Set([...kinds.map((x) => (typeof x === 'string' ? x : x?.kind)).filter(Boolean), ...ACCOUNT_HEAD_KINDS])];
      const lists = await Promise.all(kinds.map((kind) => get(`/masters/${kind}`).then(asList).catch(() => [])));
      const names = lists.flat().filter(isIndirectExpense).map(headName).filter(Boolean);
      setExpenseHeads([...new Set(names)]);
    })();
  }, []);

  const isDispatch = (p) => String(p.category || p.product_category || '').toUpperCase() === 'DISPATCH';
  const rawProducts = products.filter((p) => !isDispatch(p));
  const dispatchProducts = products.filter(isDispatch);

  const filteredRows = rows.filter((b) => {
    if (search && !(b.party_name || '').toLowerCase().includes(search.toLowerCase()) && !(b.bill_no || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    return true;
  });

  const openNew = () => { setForm({ date: today(), party_state_code: '07', items: [blankItem()], extra_charges: [] }); setOpen(true); };
  const openEdit = (b, e) => {
    e.stopPropagation();
    setForm({
      id: b.id, bill_no: b.bill_no, date: b.date, party_name: b.party_name,
      party_gst_no: b.party_gst_no, party_state_code: b.party_state_code, remarks: b.remarks,
      items: (b.items || []).map((it) => ({ item_name: it.item_name, hsn_code: it.hsn_code, qty: it.qty, rate: it.rate, gst_rate: it.gst_rate, item_type: it.item_type || (it.is_battery ? 'battery' : 'product'), is_battery: Boolean(it.is_battery) || it.item_type === 'battery', battery_maker: it.battery_maker || '', battery_master_id: it.battery_master_id || '', product_id: it.product_id || '' })),
      extra_charges: parseExtra(b.extra_charges),
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
  const patchItem = (idx, patch) => setForm((f) => { const items = [...f.items]; items[idx] = { ...items[idx], ...patch }; return { ...f, items }; });
  const pickProduct = (idx, name) => {
    const p = products.find((x) => x.name === name);
    if (!p) { patchItem(idx, { item_name: name, product_id: '' }); return; }
    const patch = { item_name: p.name, product_id: p.id };
    const hsn = p.hsn_code || p.hsn || p.hsn_sac;
    if (hsn) patch.hsn_code = hsn;
    if (p.gst_rate != null && p.gst_rate !== '') patch.gst_rate = p.gst_rate;
    patchItem(idx, patch);
  };
  // Item dropdown me 'Battery' group: Battery Maker Master ki wahi id (master id) item par jati hai.
  const pickBattery = (idx, masterId) => {
    const m = batteryMakers.find((x) => String(x.id) === String(masterId));
    if (!m) return;
    patchItem(idx, { item_type: 'battery', is_battery: true, battery_maker: m.name, battery_master_id: m.id, item_name: m.name, product_id: '' });
  };
  const normName = (v) => String(v || '').trim().toLowerCase();
  const itemKnown = (v) => products.some((x) => normName(x.name) === normName(v)) || batteryMakers.some((m) => normName(m.name) === normName(v));
  // Type karte hi exact match mile to product / battery pick ho jata hai, warna typed text hi rehta hai.
  const onTypeItem = (idx, v) => {
    const t = normName(v);
    const p = t && products.find((x) => normName(x.name) === t);
    if (p) { pickProduct(idx, p.name); return; }
    const m = t && batteryMakers.find((x) => normName(x.name) === t && x.id);
    if (m) { pickBattery(idx, m.id); return; }
    patchItem(idx, { item_name: v, product_id: '' });
  };
  const pickParty = (name) => {
    const p = parties.find((x) => x.name === name);
    const patch = { party_name: name };
    const gst = p && (p.extra || p.gst_no || p.gstin || p.gst_number);
    const st = p && (p.state_code || p.party_state_code);
    if (gst) patch.party_gst_no = String(gst).toUpperCase();
    if (st) patch.party_state_code = String(st);
    setForm((f) => ({ ...f, ...patch }));
  };
  const updateExtra = (idx, field, value) => setForm((f) => { const ex = [...(f.extra_charges || [])]; ex[idx] = { ...ex[idx], [field]: value }; return { ...f, extra_charges: ex }; });
  const addExtra = () => setForm((f) => ({ ...f, extra_charges: [...(f.extra_charges || []), blankExtra()] }));
  const removeExtra = (idx) => setForm((f) => ({ ...f, extra_charges: (f.extra_charges || []).filter((_, i) => i !== idx) }));
  const addItem = () => setForm({ ...form, items: [...form.items, blankItem()] });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const payload = { ...form, extra_charges: (form.extra_charges || []).filter((x) => x.account_head && n(x.amount) !== 0).map((x) => ({ account_head: x.account_head, amount: n(x.amount), gst_rate: n(x.gst_rate) })) };
      if (form.id) await put(`/purchase-bills/${form.id}`, payload);
      else await post('/purchase-bills', payload);
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
                <Field label="Supplier / Party Name" type="select" value={form.party_name || ''} onChange={pickParty} required
                  options={[{ value: '', label: 'Select Party' }, ...(form.party_name && !parties.some((p) => p.name === form.party_name) ? [{ value: form.party_name, label: form.party_name }] : []), ...parties.map((p) => ({ value: p.name, label: p.name }))]} />
                <Field label="Supplier GSTIN" value={form.party_gst_no} onChange={(v) => setForm({...form,party_gst_no:v.toUpperCase()})} />
                <Field label="Supplier Invoice No." value={form.bill_no} onChange={(v) => setForm({...form,bill_no:v})} />
                <Field label="Invoice Date" type="date" value={form.date} onChange={(v) => setForm({...form,date:v})} />
                <Field label="State Code" value={form.party_state_code} onChange={(v) => setForm({...form,party_state_code:v})} />
                <div style={{gridColumn:'span 3'}}><Field label="Remarks" value={form.remarks} onChange={(v) => setForm({...form,remarks:v})} /></div>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'22px 0 8px'}}>
                <div><b style={{fontSize:15}}>Item Details</b><div style={{fontSize:12,color:'#64748b'}}>Battery purchase me sirf company aur quantity enter karein — Battery No. purchase ke time nahi liya jayega. Battery No. Delivery Challan par enter hoga.</div>{makerErr && form.items.some((it)=>it.item_type==='battery'||it.is_battery) && <div style={{fontSize:12,color:'#b91c1c',marginTop:4}}>{makerErr}</div>}</div>
                <button type="button" className="btn primary" onClick={addItem}>+ Add Item</button>
              </div>

              <datalist id="pbItemList">
                {rawProducts.map((p)=><option key={'r'+p.id} value={p.name} label="Raw Material" />)}
                {dispatchProducts.map((p)=><option key={'d'+p.id} value={p.name} label="Dispatched Material" />)}
                {batteryMakers.filter((m)=>m.id).map((m)=><option key={'b'+m.id} value={m.name} label="Battery" />)}
              </datalist>
              <div className="tablewrap purchaseItemWrap" style={{border:'1px solid #e2e8f0',borderRadius:10}}>
                <table className="table purchaseItemTable">
                  <thead><tr><th>#</th><th>Type</th><th style={{minWidth:220}}>Item / Description</th><th>Battery Company</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Taxable</th><th>GST</th><th>Total</th><th></th></tr></thead>
                  <tbody>
                    {form.items.map((it, idx) => { const x=itemCalc({...it,_stateCode:form.party_state_code}); return (
                      <tr key={idx}>
                        <td data-label="#">{idx+1}</td>
                        <td data-label="Type"><select value={it.item_type || (it.is_battery ? 'battery' : 'product')} onChange={(e)=>{const type=e.target.value;patchItem(idx,{item_type:type,is_battery:type==='battery',product_id:'',...(type==='battery'?{item_name:it.item_name||'Battery'}:{item_name:(it.item_name==='Battery'||(it.battery_maker&&it.item_name===it.battery_maker))?'':it.item_name,battery_maker:'',battery_master_id:''})});}}><option value="product">Product / Material</option><option value="battery">Battery</option></select></td>
                        <td data-label="Item / Description">{(it.item_type==='battery'||it.is_battery)
                          ? <input value={it.item_name} placeholder="Battery" onChange={(e)=>updateItem(idx,'item_name',e.target.value)} required />
                          : <><input list="pbItemList" autoComplete="off" value={it.item_name || ''} placeholder="Type ya select karein" onFocus={(e)=>e.target.select()} onChange={(e)=>onTypeItem(idx,e.target.value)} required />
                              {it.item_name && !itemKnown(it.item_name) && <div style={{fontSize:11,color:'#b45309',marginTop:2}}>Product Master me nahi mila (stock me count nahi hoga)</div>}</>}</td>
                        <td data-label="Battery Company">{(it.item_type==='battery'||it.is_battery)?<select value={it.battery_maker||''} onChange={(e)=>{const nm=e.target.value;const m=batteryMakers.find((x)=>x.name===nm);const auto=!it.item_name||it.item_name==='Battery'||it.item_name===it.battery_maker;patchItem(idx,{battery_maker:nm,battery_master_id:m?.id||'',...(auto?{item_name:nm||'Battery'}:{})});}} required><option value="">Select Battery Company</option>{it.battery_maker && !batteryMakers.some((m)=>m.name===it.battery_maker) && <option value={it.battery_maker}>{it.battery_maker}</option>}{batteryMakers.map((m)=><option key={m.id||m.name} value={m.name}>{m.name}</option>)}</select>:<span className="muted">—</span>}</td>
                        <td data-label="HSN/SAC"><input value={it.hsn_code} placeholder="HSN" onChange={(e)=>updateItem(idx,'hsn_code',e.target.value)} /></td>
                        <td data-label="Qty"><input type="number" min={it.item_type==='battery'?1:0} step={it.item_type==='battery'?1:'0.01'} value={it.qty} onChange={(e)=>updateItem(idx,'qty',e.target.value)} /></td>
                        <td data-label="Rate"><input type="number" min="0" step="0.01" value={it.rate} onChange={(e)=>updateItem(idx,'rate',e.target.value)} /></td>
                        <td data-label="GST %"><input type="number" min="0" step="0.01" value={it.gst_rate} onChange={(e)=>updateItem(idx,'gst_rate',e.target.value)} /></td>
                        <td data-label="Taxable"><Money value={x.taxable}/></td><td data-label="GST"><Money value={x.cgst+x.sgst+x.igst}/></td><td data-label="Total"><b><Money value={x.total}/></b></td>
                        <td data-label="Action">{form.items.length>1 && <button type="button" className="btn danger" onClick={()=>removeItem(idx)}>✕</button>}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'22px 0 8px'}}>
                <div><b style={{fontSize:15}}>Expenses</b><div style={{fontSize:12,color:'#64748b'}}>Account Head Master ke Indirect Expense (Freight and Charges, Round Off, Discount). Jis expense par GST lagta hai uska GST % bharein. Discount ya minus round off ke liye amount me minus (-) likhein.</div></div>
                <button type="button" className="btn" onClick={addExtra}>+ Add Expense</button>
              </div>
              {(form.extra_charges || []).length > 0 && (
                <div className="tablewrap" style={{border:'1px solid #e2e8f0',borderRadius:10}}>
                  <table className="table">
                    <thead><tr><th>Expense (Account Head)</th><th style={{width:150}}>Amount</th><th style={{width:100}}>GST %</th><th style={{width:110}}>GST</th><th style={{width:120}}>Total</th><th style={{width:50}}></th></tr></thead>
                    <tbody>
                      {form.extra_charges.map((ex, idx) => (
                        <tr key={idx}>
                          <td><select value={ex.account_head} onChange={(e)=>updateExtra(idx,'account_head',e.target.value)} required>
                            <option value="">Select Expense</option>
                            {ex.account_head && !expenseHeads.includes(ex.account_head) && <option value={ex.account_head}>{ex.account_head}</option>}
                            {expenseHeads.map((h)=><option key={h} value={h}>{h}</option>)}
                          </select></td>
                          <td><input type="number" step="0.01" value={ex.amount} onChange={(e)=>updateExtra(idx,'amount',e.target.value)} required /></td>
                          <td><input type="number" min="0" step="0.01" value={ex.gst_rate} onChange={(e)=>updateExtra(idx,'gst_rate',e.target.value)} /></td>
                          <td><Money value={extraCalc(ex,form.party_state_code).gst}/></td>
                          <td><b><Money value={extraCalc(ex,form.party_state_code).total}/></b></td>
                          <td><button type="button" className="btn danger" onClick={()=>removeExtra(idx)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {expenseHeads.length === 0 && <div style={{fontSize:12,color:'#b45309',marginTop:6}}>Koi Indirect Expense account head nahi mila — pehle Account Head Master me Sub Category "Indirect Expense" ke saath Freight and Charges, Round Off, Discount banayein.</div>}

              <div style={{display:'grid',gridTemplateColumns:'1fr minmax(280px,360px)',gap:20,marginTop:18}}>
                <div style={{padding:14,background:'#f8fafc',borderRadius:10,fontSize:13}}>
                  <b>Tax Summary</b>
                  <div style={{display:'flex',gap:22,marginTop:10,flexWrap:'wrap'}}>
                    <span>Taxable: <b><Money value={totals.taxable}/></b></span>
                    <span>CGST: <b><Money value={allCgst}/></b></span>
                    <span>SGST: <b><Money value={allSgst}/></b></span>
                    <span>IGST: <b><Money value={allIgst}/></b></span>
                  </div>
                </div>
                <div style={{border:'1px solid #e2e8f0',borderRadius:10,padding:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}><span>Taxable Amount</span><b><Money value={totals.taxable}/></b></div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginTop:8}}><span>Total GST</span><b><Money value={allCgst+allSgst+allIgst}/></b></div>
                  {(form.extra_charges || []).length > 0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginTop:8}}><span>Expenses</span><b><Money value={extraTotal}/></b></div>}
                  <div style={{borderTop:'2px solid #0f172a',marginTop:12,paddingTop:12,display:'flex',justifyContent:'space-between',fontSize:18}}><b>Grand Total</b><b><Money value={grandTotal}/></b></div>
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

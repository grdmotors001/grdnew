'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner, Money } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0,10);
const blank = () => ({ product_id:'', qty:1, rate:0, gst_rate:0 });

export function DebitNotePage(){
  const [rows,setRows]=useState([]);
  const [products,setProducts]=useState([]);
  const [parties,setParties]=useState([]);
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({date:today(),party_state_code:'07',items:[blank()]});
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);

  const load=async()=>{
    try{
      const [dn,raw,party]=await Promise.all([
        get('/debit-notes'),
        get('/products?fro=R&page=1&per_page=200'),
        get('/masters/party')
      ]);
      setRows(dn.debit_notes||[]);
      setProducts(raw.products||[]);
      setParties(party||[]);
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[]);

  const updateItem=(idx,field,value)=>{
    const items=[...form.items]; items[idx]={...items[idx],[field]:value};
    if(field==='product_id'){
      const p=products.find(x=>String(x.id)===String(value));
      if(p) items[idx]={...items[idx],rate:items[idx].rate||0,gst_rate:p?.gst_rate||0};
    }
    setForm({...form,items});
  };
  const totals=form.items.reduce((a,it)=>{
    const taxable=Number(it.qty||0)*Number(it.rate||0);
    const gst=taxable*Number(it.gst_rate||0)/100;
    a.taxable+=taxable;a.gst+=gst;a.total+=taxable+gst;return a;
  },{taxable:0,gst:0,total:0});

  const save=async(e)=>{
    e.preventDefault();setError('');
    if(!form.party_name){setError('Supplier / Party Name is required.');return}
    if(!form.reason?.trim()){setError('Reason is required.');return}
    if(form.items.some(x=>!x.product_id||Number(x.qty)<=0)){setError('Select a raw item and valid quantity for every line.');return}
    setSaving(true);
    try{await post('/debit-notes',form);setOpen(false);setForm({date:today(),party_state_code:'07',items:[blank()]});load();}
    catch(e){setError(e.message)}finally{setSaving(false)}
  };

  return <div className="page">
    <div className="pageHeader">
      <div><h2>Debit Note</h2><p className="muted">Raw Material Purchase Return only.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <div className="card">
      <div className="actions" style={{justifyContent:'space-between'}}>
        <div><h3 style={{marginTop:0}}>Raw Material Debit Notes</h3><p className="muted">Only Product Master items marked as Raw (R) can be selected.</p></div>
        <button className="btn primary" onClick={()=>{setForm({date:today(),party_state_code:'07',items:[blank()]});setOpen(true)}}>+ New Debit Note</button>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>DN No.</th><th>Supplier</th><th>Original Bill</th><th>Taxable</th><th>GST</th><th>Total</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td><b>{r.debit_note_no}</b></td><td>{r.party_name}</td><td>{r.original_bill_no||'—'}</td><td><Money value={r.taxable_amount}/></td><td><Money value={r.tax_amount}/></td><td><b><Money value={r.total_amount}/></b></td></tr>)}
      {!rows.length&&<tr><td colSpan="7" className="muted">No Debit Notes yet.</td></tr>}</tbody></table></div>
    </div>

    {open&&<div className="modal"><form className="modalbox" onSubmit={save} style={{maxWidth:1100}}>
      <h2>New Debit Note — Raw Material Return</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Supplier / Party Name" type="select" value={form.party_name||''}
          options={[{value:'',label:'Select Supplier'},...parties.map(p=>({value:p.name,label:p.name}))]}
          onChange={v=>{const p=parties.find(x=>x.name===v);setForm({...form,party_name:v,party_gst_no:p?.extra||'',party_state_code:p?.state_code||'07'})}} required/>
        <Field label="Original Purchase Bill No." value={form.original_bill_no} onChange={v=>setForm({...form,original_bill_no:v})}/>
        <Field label="Debit Note Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})} required/>
        <Field label="Supplier GSTIN" value={form.party_gst_no} onChange={v=>setForm({...form,party_gst_no:v.toUpperCase()})}/>
        <Field label="State Code" value={form.party_state_code} onChange={v=>setForm({...form,party_state_code:v})}/>
        <Field label="Reason" value={form.reason} onChange={v=>setForm({...form,reason:v})} required/>
        <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'20px 0 8px'}}><b>Raw Items</b><button type="button" className="btn primary" onClick={()=>setForm({...form,items:[...form.items,blank()]})}>+ Add Item</button></div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Raw Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Taxable</th><th>Total</th><th></th></tr></thead>
      <tbody>{form.items.map((it,i)=>{const p=products.find(x=>String(x.id)===String(it.product_id));const taxable=Number(it.qty||0)*Number(it.rate||0);const gst=taxable*Number(it.gst_rate||0)/100;return <tr key={i}>
        <td><select value={it.product_id} onChange={e=>updateItem(i,'product_id',e.target.value)} required><option value="">Select Raw Item</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.code?' — '+p.code:''}</option>)}</select></td>
        <td>{p?.hsn_code||'—'}</td><td><input type="number" min="0.01" step="0.01" value={it.qty} onChange={e=>updateItem(i,'qty',e.target.value)}/></td>
        <td><input type="number" min="0" step="0.01" value={it.rate} onChange={e=>updateItem(i,'rate',e.target.value)}/></td>
        <td><input type="number" min="0" step="0.01" value={it.gst_rate} onChange={e=>updateItem(i,'gst_rate',e.target.value)}/></td>
        <td><Money value={taxable}/></td><td><b><Money value={taxable+gst}/></b></td>
        <td>{form.items.length>1&&<button type="button" className="btn danger" onClick={()=>setForm({...form,items:form.items.filter((_,x)=>x!==i)})}>✕</button>}</td>
      </tr>})}</tbody></table></div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:24,marginTop:16,fontSize:15}}><span>Taxable <b><Money value={totals.taxable}/></b></span><span>GST <b><Money value={totals.gst}/></b></span><span>Total <b><Money value={totals.total}/></b></span></div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Debit Note'}</button></div>
    </form></div>}
  </div>
}

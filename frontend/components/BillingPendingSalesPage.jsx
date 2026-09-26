'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner, Money } from './ui';

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [createOpen,setCreateOpen]=useState(false),[options,setOptions]=useState({applications:[],vehicles:[]});
  const [invoiceSale,setInvoiceSale]=useState(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{const r=await get('/billing/pending-sales');setRows(r.applications||[])}
    catch(e){setError(e.message||'Could not load Pending Sales')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const openCreate=async()=>{
    try{const r=await get('/billing/pending-sales/options');setOptions(r);setCreateOpen(true)}
    catch(e){setError(e.message||'Could not load options')}
  };
  const approve=async id=>{
    if(!confirm('Approve this Pending Sale?'))return;
    try{await post('/billing/pending-sales/'+id+'/approve',{});load()}catch(e){setError(e.message)}
  };
  const openSale=async id=>{
    try{const r=await get('/billing/pending-sales/invoice?id='+id);setInvoiceSale({...r,id})}
    catch(e){setError(e.message||'Could not open Tax Invoice')}
  };

  return <div className="page">
    <div className="pageHeader">
      <div><h2>Pending Bills / Billing</h2><p className="muted">Pending Sales → Admin Approval → Approved Sales → Create Sale → Tax Invoice.</p></div>
      <div style={{display:'flex',gap:8}}><button className="btn primary" onClick={openCreate}>+ Create Pending Sale</button><button className="btn" onClick={load}>↻ Refresh</button></div>
    </div>
    <ErrorBanner message={error}/>
    <div className="card">
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Application</th><th>Dealer</th><th>Customer</th><th>Chassis</th><th>Description</th><th>Sale Amount</th><th>Status</th><th>Action</th>
      </tr></thead><tbody>
      {rows.map(r=><tr key={r.id}>
        <td><b>{r.application_no||r.application_id}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}</td>
        <td>{r.chassis_no||'—'}</td><td>{r.description||'—'}</td><td><Money value={r.sale_amount}/></td>
        <td><b>{r.status}</b></td>
        <td>{r.status==='PENDING'&&<button className="btn primary" onClick={()=>approve(r.id)}>Approve</button>}
            {r.status==='APPROVED'&&<button className="btn primary" onClick={()=>openSale(r.id)}>Create Sale</button>}
            {r.status==='BILLED'&&<span className="pill s">Billed</span>}</td>
      </tr>)}
      {!loading&&!rows.length&&<tr><td colSpan="8" className="muted">No Pending Sales.</td></tr>}
      </tbody></table></div>
      {loading&&<div className="muted" style={{padding:16}}>Loading…</div>}
    </div>
    {createOpen&&<CreatePendingSale options={options} onClose={()=>setCreateOpen(false)} onSaved={()=>{setCreateOpen(false);load()}}/>}
    {invoiceSale&&<TaxInvoiceModal data={invoiceSale} onClose={()=>setInvoiceSale(null)} onSaved={()=>{setInvoiceSale(null);load()}}/>}
  </div>
}

function CreatePendingSale({options,onClose,onSaved}){
  const [form,setForm]=useState({application_id:'',vehicle_id:'',description:'',sale_amount:''}),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const app=options.applications.find(x=>String(x.id)===String(form.application_id));
  const dealer=app?.dealer_name||'';
  const vehicles=options.vehicles.filter(v=>!app?.dealer_id||!v.dealer_id||Number(v.dealer_id)===Number(app.dealer_id));
  useEffect(()=>{if(app&&!form.sale_amount)setForm(f=>({...f,sale_amount:app.loan_amount||''}))},[app?.id]);
  const save=async()=>{setSaving(true);setError('');try{await post('/billing/pending-sales/create',form);onSaved()}catch(e){setError(e.message)}finally{setSaving(false)}};
  return <div className="modal"><div className="modalbox" style={{maxWidth:720}}>
    <h2>Create Pending Sale</h2><p className="muted">Description admin bhi yahin se create kar sakta hai.</p><ErrorBanner message={error}/>
    <div className="formgrid">
      <label className="field"><span>Loan Application</span><select className="input" value={form.application_id} onChange={e=>setForm({...form,application_id:e.target.value,vehicle_id:'',sale_amount:''})}><option value="">Select Application</option>{options.applications.map(x=><option key={x.id} value={x.id}>{x.application_no||x.id} · {x.customer_name||'—'} · {x.dealer_name||'—'}</option>)}</select></label>
      <Field label="Dealer" value={dealer} onChange={()=>{}} readOnly/>
      <label className="field"><span>Chassis</span><select className="input" value={form.vehicle_id} onChange={e=>setForm({...form,vehicle_id:e.target.value})}><option value="">Select Chassis</option>{vehicles.map(v=><option key={v.challan_id} value={v.challan_id}>{v.chassis_no||'—'} · {v.product_name||'—'} · {v.dealer_name||''}</option>)}</select></label>
      <Field label="Sale Amount" type="number" value={form.sale_amount} onChange={v=>setForm({...form,sale_amount:v})}/>
    </div>
    <label className="field" style={{marginTop:12}}><span>Description</span><textarea className="input" rows="4" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Enter sale description"/></label>
    <div className="actions" style={{marginTop:16}}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving||!form.application_id||!form.description} onClick={save}>{saving?'Saving…':'Create Pending Sale'}</button></div>
  </div></div>
}

function TaxInvoiceModal({data,onClose,onSaved}){
  const [form,setForm]=useState(data.invoice||{}),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=async()=>{setSaving(true);setError('');try{await post('/billing/pending-sales/'+data.id+'/save-invoice',{invoice:form});onSaved()}catch(e){setError(e.message)}finally{setSaving(false)}};
  return <div className="modal"><div className="modalbox" style={{maxWidth:980}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h2>Tax Invoice</h2><p className="muted">Details pre-filled hain. Save karte hi Bill No. generate hoga.</p></div><button className="btn" onClick={onClose}>×</button></div>
    <ErrorBanner message={error}/>
    <div className="formgrid">
      <Field label="Invoice Date" type="date" value={form.date||''} onChange={v=>set('date',v)}/>
      <Field label="Customer Name" value={form.buyer_name||''} onChange={v=>set('buyer_name',v)}/>
      <Field label="Mobile" value={form.buyer_mobile||''} onChange={v=>set('buyer_mobile',v)}/>
      <Field label="Dealer" value={form.dealer_name||''} onChange={v=>set('dealer_name',v)}/>
      <Field label="Model" value={form.product_name||''} onChange={v=>set('product_name',v)}/>
      <Field label="Chassis No." value={form.chassis_no||''} onChange={v=>set('chassis_no',v)}/>
      <Field label="Motor No." value={form.motor_no||''} onChange={v=>set('motor_no',v)}/>
      <Field label="Controller No." value={form.controller_no||''} onChange={v=>set('controller_no',v)}/>
      <Field label="Colour" value={form.colour||''} onChange={v=>set('colour',v)}/>
      <Field label="Sale Amount" type="number" value={form.sale_amount??''} onChange={v=>set('sale_amount',v)}/>
      <Field label="Loan Amount" type="number" value={form.hypothecation_amount??''} onChange={v=>set('hypothecation_amount',v)}/>
      <Field label="GST Rate %" type="number" value={form.gst_rate??5} onChange={v=>set('gst_rate',v)}/>
      <Field label="Amount Received" type="number" value={form.amount_received??0} onChange={v=>set('amount_received',v)}/>
      <Field label="Mode / Term" value={form.mode_term||''} onChange={v=>set('mode_term',v)}/>
    </div>
    <div className="actions" style={{marginTop:16}}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save & Generate Bill No.'}</button></div>
  </div></div>
}

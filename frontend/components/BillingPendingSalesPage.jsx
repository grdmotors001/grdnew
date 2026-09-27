'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner, Money } from './ui';

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [createOpen,setCreateOpen]=useState(false),[options,setOptions]=useState({applications:[],vehicles:[]});
  const [invoiceSale,setInvoiceSale]=useState(null),[view,setView]=useState('PENDING'),[canApprove,setCanApprove]=useState(false);

  const load=async()=>{
    setLoading(true);setError('');
    try{const r=await get('/billing/pending-sales');setRows(r.applications||[]);setCanApprove(Boolean(r.can_approve))}
    catch(e){setError(e.message||'Could not load Pending Sales')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const openCreate=async()=>{
    try{const r=await get('/billing/pending-sales/options');setOptions(r);setCanApprove(Boolean(r.can_approve));setCreateOpen(true)}
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
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <button className={'btn '+(view==='PENDING'?'primary':'')} onClick={()=>setView('PENDING')}>Pending Sales</button>
        <button className={'btn '+(view==='APPROVED'?'primary':'')} onClick={()=>setView('APPROVED')}>Approved Sales</button>
        <button className={'btn '+(view==='BILLED'?'primary':'')} onClick={()=>setView('BILLED')}>Billed</button>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Application</th><th>Dealer</th><th>Customer</th><th>Chassis</th><th>Description</th><th>Sale Amount</th><th>Status</th><th>Action</th>
      </tr></thead><tbody>
      {rows.filter(r=>r.status===view).map(r=><tr key={r.id}>
        <td><b>{r.application_no||r.application_id}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}</td>
        <td>{r.chassis_no||'—'}</td><td>{r.description||'—'}</td><td><Money value={r.sale_amount}/></td>
        <td><b>{r.status}</b></td>
        <td>{r.status==='PENDING'&&canApprove&&<button className="btn primary" onClick={()=>approve(r.id)}>Approve</button>}
            {r.status==='APPROVED'&&<button className="btn primary" onClick={()=>openSale(r.id)}>Create Sale</button>}
            {r.status==='BILLED'&&<span className="pill s">Billed</span>}</td>
      </tr>)}
      {!loading&&!rows.filter(r=>r.status===view).length&&<tr><td colSpan="8" className="muted">No {view==='APPROVED'?'Approved':'Pending'} Sales.</td></tr>}
      </tbody></table></div>
      {loading&&<div className="muted" style={{padding:16}}>Loading…</div>}
    </div>
    {createOpen&&<CreatePendingSale options={options} onClose={()=>setCreateOpen(false)} onSaved={()=>{setCreateOpen(false);load()}}/>}
    {invoiceSale&&<TaxInvoiceModal data={invoiceSale} onClose={()=>setInvoiceSale(null)} onSaved={()=>{setInvoiceSale(null);load()}}/>}
  </div>
}

function CreatePendingSale({options,onClose,onSaved}){
  const initial={
    dealer_id:'',application_id:'',vehicle_id:'',buyer_name:'',buyer_mobile:'',buyer_relation:'',buyer_father_name:'',buyer_address:'',
    buyer_gst_no:'',buyer_pan:'',buyer_aadhar:'',buyer_dob:'',buyer_state:'',buyer_state_code:'',state_type:'I',
    mode_term:'',bank_name:'',bank_account_no:'',bank_ifsc:'',rto_name:'',despatch_through:'',eway_bill_no:'',license_no:'',
    cvr_no:'',cancelled_cheque_no:'',remarks:'',dealer_page_no:'',sale_amount:'',amount_received:'',financer_name:'',
    hypothecation_amount:'',vehicle_reg_no:'',ledger_no:'',chassis_record_no:'',voucher_no:'',subsidy_amount:'',
    gst_sale_amount:'',gst_rate:5,insurance_amount:'',registration_amount:'',discount:'',sale_type:'',do_no:'',internal_sale_details:''
  };
  const [form,setForm]=useState(initial),[step,setStep]=useState(0),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const dealers=options.dealers||[];
  const applications=(options.applications||[]).filter(x=>!form.dealer_id||Number(x.dealer_id)===Number(form.dealer_id));
  const vehicles=(options.vehicles||[]).filter(v=>!form.dealer_id||Number(v.dealer_id)===Number(form.dealer_id));
  const app=applications.find(x=>String(x.id)===String(form.application_id));
  const vehicle=vehicles.find(v=>String(v.challan_id)===String(form.vehicle_id));
  const balance=Math.max(0,Number(form.sale_amount||0)-Number(form.hypothecation_amount||0)-Number(form.amount_received||0));
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const selectDealer=v=>{
    const x=dealers.find(d=>String(d.id)===String(v));
    setForm(f=>({...f,dealer_id:v,application_id:'',vehicle_id:'',buyer_name:'',buyer_mobile:'',buyer_address:'',
      sale_amount:'',gst_sale_amount:'',hypothecation_amount:'',sale_type:'',dealer_page_no:x?.page_no||''}));
  };
  const applyApp=v=>{
    const x=applications.find(y=>String(y.id)===String(v)); if(!x)return;
    setForm(f=>({...f,application_id:v,buyer_name:x.customer_name||'',buyer_mobile:x.customer_phone||'',buyer_address:x.customer_address||'',buyer_state:x.customer_state||'',
      sale_amount:x.loan_amount?String(x.loan_amount):f.sale_amount,gst_sale_amount:x.loan_amount?String(x.loan_amount):f.gst_sale_amount,
      hypothecation_amount:x.loan_amount?String(x.loan_amount):f.hypothecation_amount,sale_type:x.loan_vehicle_type||f.sale_type}));
  };
  const applyVehicle=v=>{
    const x=vehicles.find(y=>String(y.challan_id)===String(v)); if(!x)return;
    setForm(f=>({...f,vehicle_id:v,sale_amount:f.sale_amount||String(x.sale_value||''),gst_sale_amount:f.gst_sale_amount||String(x.sale_value||''),sale_type:f.sale_type||x.model_name||x.product_name||'New Rickshaw'}));
  };
  const save=async()=>{
    setSaving(true);setError('');
    try{
      if(!form.dealer_id)throw new Error('Dealer select karo.');
      if(!form.vehicle_id)throw new Error('Chassis / Delivery Challan select karo.');
      if(!form.buyer_name.trim())throw new Error('Customer Name required hai.');
      if(Number(form.hypothecation_amount||0)>Number(form.sale_amount||0))throw new Error('Hypothecation/Loan Amount Sale Amount se zyada nahi ho sakta.');
      await post('/billing/pending-sales/create',{...form,application_id:form.application_id?Number(form.application_id):null,dealer_id:Number(form.dealer_id),vehicle_id:Number(form.vehicle_id),
        delivery_challan_id:Number(form.vehicle_id),customer_name:form.buyer_name,customer_phone:form.buyer_mobile,customer_address:form.buyer_address,customer_state:form.buyer_state,
        sale_amount:Number(form.sale_amount||0),loan_amount:Number(form.hypothecation_amount||0)});
      onSaved();
    }catch(e){setError(e.message||'Could not create Pending Sale')}finally{setSaving(false)}
  };
  const Input=({label,...p})=><label className="field"><span>{label}</span><input className="input" {...p}/></label>;
  const Text=({label,...p})=><label className="field"><span>{label}</span><textarea className="input" rows="2" {...p}/></label>;
  return <div className="modal"><div className="modalbox" style={{maxWidth:1000}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}><div><h2 style={{margin:0}}>Create Pending Sale</h2><p className="muted" style={{margin:'6px 0'}}>Tax Invoice / Dealer Pending Sale jaisa complete form — <b>Bill No. nahi hai</b>.</p></div><button className="btn" onClick={onClose}>×</button></div>
    <ErrorBanner message={error}/>
    <div className="formgrid" style={{marginTop:12}}>
      <label className="field"><span>Dealer</span><select className="input" value={form.dealer_id} onChange={e=>selectDealer(e.target.value)} required><option value="">Select Dealer</option>{dealers.map(d=><option key={d.id} value={d.id}>{d.name}{d.code?' · '+d.code:''}</option>)}</select></label>
      <label className="field"><span>Loan Application</span><select className="input" value={form.application_id} onChange={e=>applyApp(e.target.value)}><option value="">Manual Customer / No Loan Approved</option>{applications.map(x=><option key={x.id} value={x.id}>{x.application_no||x.id} · {x.customer_name||'—'}</option>)}</select></label>
      <label className="field"><span>Delivery Challan / Chassis</span><select className="input" value={form.vehicle_id} onChange={e=>applyVehicle(e.target.value)} required><option value="">Select Chassis</option>{vehicles.map(v=><option key={v.challan_id} value={v.challan_id}>{v.chassis_no||'—'} · {v.challan_no||'DC'} · {v.product_name||v.model_name||''}</option>)}</select></label>
    </div>
    {vehicle&&<div className="card" style={{marginTop:10,padding:10}}><b>Dealer:</b> {vehicle.dealer_name||'—'} &nbsp; <b>Chassis:</b> {vehicle.chassis_no||'—'} &nbsp; <b>Model:</b> {vehicle.model_name||vehicle.product_name||'—'} &nbsp; <b>Colour:</b> {vehicle.colour||'—'}</div>}
    <div className="actions" style={{margin:'14px 0 8px',gap:6}}>
      {['Applicant Details','Internal','Amount / Tax'].map((x,i)=><button type="button" key={x} className={'btn '+(step===i?'primary':'')} onClick={()=>setStep(i)}>{i+1}. {x}</button>)}
    </div>
    {step===0&&<div className="formgrid">
      <Input label="Dealer Page No." value={form.dealer_page_no} onChange={e=>set('dealer_page_no',e.target.value)}/>
      <Input label="Customer Name" value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)} required/>
      <Input label="Buyer Relation" value={form.buyer_relation} onChange={e=>set('buyer_relation',e.target.value)}/>
      <Input label="Buyer Father/Husband Name" value={form.buyer_father_name} onChange={e=>set('buyer_father_name',e.target.value)}/>
      <Input label="Buyer Address" value={form.buyer_address} onChange={e=>set('buyer_address',e.target.value)}/>
      <Input label="Buyer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/>
      <Input label="Buyer GSTIN" value={form.buyer_gst_no} onChange={e=>set('buyer_gst_no',e.target.value)}/>
      <Input label="Buyer PAN" value={form.buyer_pan} onChange={e=>set('buyer_pan',e.target.value)}/>
      <Input label="Buyer Aadhar" value={form.buyer_aadhar} onChange={e=>set('buyer_aadhar',e.target.value)}/>
      <Input label="Buyer Date of Birth" type="date" value={form.buyer_dob} onChange={e=>set('buyer_dob',e.target.value)}/>
      <Input label="Buyer State" value={form.buyer_state} onChange={e=>set('buyer_state',e.target.value)}/>
      <Input label="Buyer State Code" value={form.buyer_state_code} onChange={e=>set('buyer_state_code',e.target.value)}/>
      <label className="field"><span>Intra / Inter State</span><select className="input" value={form.state_type} onChange={e=>set('state_type',e.target.value)}><option value="I">Intra-state (CGST + SGST)</option><option value="O">Inter-state (IGST)</option></select></label>
      <Input label="Mode / Term" value={form.mode_term} onChange={e=>set('mode_term',e.target.value)}/><Input label="Bank Name" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/><Input label="Bank Account No." value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/><Input label="Bank IFSC" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value)}/>
      <Input label="RTO Name" value={form.rto_name} onChange={e=>set('rto_name',e.target.value)}/><Input label="Despatch Through" value={form.despatch_through} onChange={e=>set('despatch_through',e.target.value)}/><Input label="E-Way Bill No." value={form.eway_bill_no} onChange={e=>set('eway_bill_no',e.target.value)}/><Input label="License No." value={form.license_no} onChange={e=>set('license_no',e.target.value)}/><Input label="CVR No." value={form.cvr_no} onChange={e=>set('cvr_no',e.target.value)}/><Input label="Cancelled Cheque No." value={form.cancelled_cheque_no} onChange={e=>set('cancelled_cheque_no',e.target.value)}/><Text label="Remarks" value={form.remarks} onChange={e=>set('remarks',e.target.value)} style={{gridColumn:'1 / -1'}}/>
    </div>}
    {step===1&&<div className="formgrid">
      <Input label="Sale Amount (Internal)" type="number" min="0" value={form.sale_amount} onChange={e=>set('sale_amount',e.target.value)} required/>
      <Input label="Amount Received" type="number" min="0" value={form.amount_received} onChange={e=>set('amount_received',e.target.value)}/>
      <Input label="Financer Name (Hypothecation)" value={form.financer_name} onChange={e=>set('financer_name',e.target.value)}/>
      <Input label="Hypothecation / Loan Amount" type="number" min="0" value={form.hypothecation_amount} onChange={e=>set('hypothecation_amount',e.target.value)}/>
      <label className="field"><span>Balance</span><input className="input" value={balance.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})} readOnly/></label>
      <Input label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={e=>set('vehicle_reg_no',e.target.value)}/><Input label="Ledger No." value={form.ledger_no} onChange={e=>set('ledger_no',e.target.value)}/><Input label="Chassis Record No." value={form.chassis_record_no} onChange={e=>set('chassis_record_no',e.target.value)}/><Input label="Voucher No." value={form.voucher_no} onChange={e=>set('voucher_no',e.target.value)}/><Input label="Subsidy Amount" type="number" min="0" value={form.subsidy_amount} onChange={e=>set('subsidy_amount',e.target.value)}/><Input label="Sale Type" value={form.sale_type} onChange={e=>set('sale_type',e.target.value)}/><Input label="DO No." value={form.do_no} onChange={e=>set('do_no',e.target.value)}/><Text label="Internal Sale Details" value={form.internal_sale_details} onChange={e=>set('internal_sale_details',e.target.value)} style={{gridColumn:'1 / -1'}}/>
    </div>}
    {step===2&&<div className="formgrid">
      <Input label="GST Sale Amount" type="number" min="0" value={form.gst_sale_amount} onChange={e=>set('gst_sale_amount',e.target.value)} required/>
      <Input label="GST Rate %" type="number" min="0" value={form.gst_rate} onChange={e=>set('gst_rate',e.target.value)}/><Input label="Insurance Amount" type="number" min="0" value={form.insurance_amount} onChange={e=>set('insurance_amount',e.target.value)}/><Input label="Registration Amount" type="number" min="0" value={form.registration_amount} onChange={e=>set('registration_amount',e.target.value)}/><Input label="Discount" type="number" min="0" value={form.discount} onChange={e=>set('discount',e.target.value)}/>
    </div>}
    <div className="actions" style={{marginTop:16,justifyContent:'space-between'}}><div className="actions"><button type="button" className="btn" disabled={step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← Back</button><button type="button" className="btn" disabled={step===2} onClick={()=>setStep(s=>Math.min(2,s+1))}>Next →</button></div><div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving||!form.dealer_id||!form.vehicle_id}>{saving?'Saving…':'Create Pending Sale'}</button></div></div>
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

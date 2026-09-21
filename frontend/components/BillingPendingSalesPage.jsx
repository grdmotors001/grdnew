'use client';
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { Money, Field, ErrorBanner } from './ui';

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[manual,setManual]=useState([]),[dealers,setDealers]=useState([]),[approvedLoans,setApprovedLoans]=useState([]),[oldChallans,setOldChallans]=useState([]),[showroomDeliveries,setShowroomDeliveries]=useState([]),[doOptions,setDoOptions]=useState([]);
  const [form,setForm]=useState({dealer_id:'',date:new Date().toISOString().slice(0,10),chassis_no:'',sale_amount:'',remarks:''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[usingLoan,setUsingLoan]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [a,m,d,l,o]=await Promise.all([get('/billing/pending-sales'),get('/billing/manual-pending-bills'),get('/dealer-list'),get('/billing/approved-loans'),get('/billing/old-rickshaw-challans'),get('/billing/showroom-deliveries'),get('/billing/showroom-do-options')]);
      setRows(a.applications||[]);setManual(m.bills||[]);setDealers(d.dealers||[]);setApprovedLoans(l.applications||[]);setOldChallans(o.challans||[]);setShowroomDeliveries(s?.deliveries||[]);setDoOptions(doData?.do_numbers||[]);
    }catch(e){setError(e.message)}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const useApprovedLoan=async applicationNo=>{
    if(!confirm('Use this approved CHFPL loan for GRD Pending Bill? It will be consumed here and hidden from this list.'))return;
    setUsingLoan(applicationNo);setError('');
    try{await post('/billing/approved-loans/'+encodeURIComponent(applicationNo)+'/use',{});await load();}
    catch(e){setError(e.message)}
    finally{setUsingLoan('')}
  };
  const approve=async id=>{if(!confirm('Approve this Pending Sale for Bill generation?'))return;try{await post('/billing/pending-sales/'+id+'/approve',{});load()}catch(e){setError(e.message)}};
  const bill=async id=>{if(!confirm('Generate Tax Bill now?'))return;try{const r=await post('/billing/pending-sales/'+id+'/generate-bill',{});alert('Bill generated: '+(r.invoice?.bill_no||''));load()}catch(e){setError(e.message)}};
  const saveManual=async e=>{
    e.preventDefault();setSaving(true);setError('');
    try{await post('/billing/manual-pending-bills',{...form,dealer_id:Number(form.dealer_id),sale_amount:Number(form.sale_amount)});
      setForm({dealer_id:'',date:new Date().toISOString().slice(0,10),chassis_no:'',sale_amount:'',remarks:''});load();
    }catch(e){setError(e.message)}finally{setSaving(false)}
  };
  const approveManual=async id=>{if(!confirm('Approve this manual cash bill?'))return;try{await post('/billing/manual-pending-bills/'+id+'/approve',{});load()}catch(e){setError(e.message)}};

  const selectAllInventory=()=>setInventorySelected(inventorySelected.size===inventory.length?new Set():new Set(inventory.map(x=>x.id)));
  const downloadSelectedTxt=async()=>{try{if(!inventorySelected.size)return setError('Select at least one vehicle.');await downloadBlob('/billing/vehicle-inventory/download-txt',{invoice_ids:[...inventorySelected]},'VahanInventoryTXT.TXT')}catch(e){setError(e.message)}};

  return <div className="page">
    <div className="pageHeader"><div><h2>Pending Bills / Billing</h2><p className="muted">Loan billing aur cash sales dono pehle Pending Bill me aayenge.</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
    <ErrorBanner message={error}/>
    <div className="card" style={{marginBottom:14}}>
      <h3 style={{marginTop:0}}>Manual Cash Sale → Pending Bill</h3>
      <p className="muted">Cash me rickshaw sale hone par customer master create nahi hoga. Billing department yahan manual entry karega.</p>
      <form onSubmit={saveManual}><div className="formgrid">
        <Field label="Dealer / Showroom" type="select" value={form.dealer_id} options={[{value:'',label:'Select Dealer / Showroom'},...dealers.map(d=>({value:d.id,label:(d.code?d.code+' — ':'')+d.name}))]} onChange={v=>setForm({...form,dealer_id:v})} required/>
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})} required/>
        <Field label="Chassis No." value={form.chassis_no} onChange={v=>setForm({...form,chassis_no:v})} required/>
        <Field label="Cash Sale Amount" type="number" value={form.sale_amount} onChange={v=>setForm({...form,sale_amount:v})} required/>
        <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
      </div><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save to Pending Bills'}</button></form>
    </div>

    <div className="card" style={{marginBottom:14}}>
      <h3 style={{marginTop:0}}>Manual Cash Pending Bills</h3>
      <div className="tablewrap"><table className="table"><thead><tr><th>Pending No.</th><th>Date</th><th>Dealer</th><th>Chassis</th><th>Model</th><th>Cash Amount</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{manual.map(r=><tr key={r.id}><td><b>{r.pending_no}</b></td><td>{r.date}</td><td>{r.dealer_name}</td><td>{r.chassis_no}</td><td>{r.product_name||'—'}</td><td><Money value={r.sale_amount}/></td><td>{r.status}</td><td>{r.status==='PENDING_BILL'&&<button className="btn primary" onClick={()=>approveManual(r.id)}>Approve</button>}</td></tr>)}{!loading&&!manual.length&&<tr><td colSpan="8" className="muted">No manual cash pending bills.</td></tr>}</tbody></table></div>
    </div>

    <ShowroomDeliveryBillingSection rows={showroomDeliveries} doOptions={doOptions} onSaved={load}/>\n    <OldRickshawBillingSection rows={oldChallans} onSaved={load}/>
    <div className="card" style={{marginBottom:14}}>
      <h3 style={{marginTop:0}}>Pending for Bill — Approved CHFPL Loans</h3>
      <p className="muted">CHFPL me loan approve hone ke baad yahan Pending for Bill me live dikhega. Billing staff isi application ko sale/billing process me use karega.</p>
      <div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>Vehicle</th><th>Loan Amount</th><th>Status</th><th>Tenure</th><th>Action</th></tr></thead>
      <tbody>{approvedLoans.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}<br/><small className="muted">{r.customer_phone||''}</small></td><td>{r.vehicle_model_name||'—'}</td><td><Money value={r.loan_amount_requested}/></td><td><span className="loanStatus approved">{String(r.status||'').replace(/_/g,' ')}</span></td><td>{r.tenure_months||'—'} months</td><td><button className="btn primary" disabled={usingLoan===r.application_no} onClick={()=>useApprovedLoan(r.application_no)}>{usingLoan===r.application_no?'Using…':'Use for Pending Bill'}</button></td></tr>)}{!loading&&!approvedLoans.length&&<tr><td colSpan="8" className="muted">No approved CHFPL loans available for billing.</td></tr>}</tbody></table></div>
    </div>

    <div className="card"><h3 style={{marginTop:0}}>Loan / CHFPL Pending Sales</h3><div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>DO Status</th><th>Chassis</th><th>Sale Amount</th><th>Description</th><th>Billing Status</th><th>Action</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name}</td><td>{r.customer_name}</td><td>{r.status}</td><td>{r.billing_chassis_no||'—'}</td><td><Money value={r.billing_sale_amount}/></td><td>{r.dealer_description||'—'}</td><td><b>{r.billing_status}</b></td><td style={{display:'flex',gap:6,flexWrap:'wrap'}}>{r.billing_status==='PENDING_SALE'&&<button className="btn primary" onClick={()=>approve(r.id)}>Approve</button>}{r.billing_status==='BILL_APPROVED'&&<button className="btn primary" onClick={()=>bill(r.id)}>Generate Bill</button>}</td></tr>)}{!loading&&!rows.length&&<tr><td colSpan="9" className="muted">No loan pending sales.</td></tr>}</tbody></table></div>{loading&&<div className="muted" style={{padding:16}}>Loading…</div>}</div>
  </div>
}


function OldRickshawBillingSection({rows,onSaved}){
 const [edit,setEdit]=useState(null),[form,setForm]=useState({});
 const open=r=>{setEdit(r);setForm({sale_amount:r.sale_amount||'',file_charge:r.file_charge||'',loan_amount:r.loan_amount||'',down_payment:r.down_payment||'',sale_customer:r.sale_customer||'',sale_mobile:r.sale_mobile||'',sold_at:new Date().toISOString().slice(0,10)})};
 const save=async()=>{try{await post('/billing/old-rickshaw-challans/'+edit.id+'/sale',form);setEdit(null);onSaved()}catch(e){alert(e.message)}};
 return <div className="card" style={{marginBottom:14}}><h3 style={{marginTop:0}}>Old Rickshaw Challans → Sale Billing</h3><p className="muted">Factory se challan banne ke baad yahan sale data complete hoga.</p><div className="tablewrap"><table className="table"><thead><tr><th>Challan</th><th>Date</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Dealer</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.challan_no}</b></td><td>{r.date}</td><td>{r.model_name}</td><td>{r.vehicle_no}</td><td>{r.colour||'—'}</td><td>{r.dealer_name||'—'}</td><td>{r.status}</td><td><button className="btn primary" onClick={()=>open(r)}>Enter Sale Data</button></td></tr>)}{!rows.length&&<tr><td colSpan="8" className="muted">No Old Rickshaw challans pending for sale.</td></tr>}</tbody></table></div>{edit&&<div className="modal"><div className="modalbox"><h2>Sale Data — {edit.challan_no}</h2><div className="formgrid"><Field label="Sale Amount" type="number" value={form.sale_amount} onChange={v=>setForm({...form,sale_amount:v})} required/><Field label="File Charge" type="number" value={form.file_charge} onChange={v=>setForm({...form,file_charge:v})}/><Field label="Loan Amount" type="number" value={form.loan_amount} onChange={v=>setForm({...form,loan_amount:v})}/><Field label="Down Payment" type="number" value={form.down_payment} onChange={v=>setForm({...form,down_payment:v})}/><Field label="Customer Name" value={form.sale_customer} onChange={v=>setForm({...form,sale_customer:v})}/><Field label="Mobile" value={form.sale_mobile} onChange={v=>setForm({...form,sale_mobile:v})}/><Field label="Sale Date" type="date" value={form.sold_at} onChange={v=>setForm({...form,sold_at:v})}/></div><div className="actions" style={{marginTop:16}}><button className="btn" onClick={()=>setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save Sale Data</button></div></div></div>}</div>
}

function ShowroomDeliveryBillingSection({rows,doOptions,onSaved}){
 const [edit,setEdit]=useState(null),[doNo,setDoNo]=useState(""),[saving,setSaving]=useState(false);
 const open=r=>{setEdit(r);setDoNo(r.do_no||"")};
 const save=async()=>{if(!edit)return;setSaving(true);try{await put("/billing/showroom-deliveries/"+edit.id,{do_no:doNo});setEdit(null);onSaved()}catch(e){alert(e.message)}finally{setSaving(false)}};
 return <div className="card" style={{marginBottom:14}}><h3 style={{marginTop:0}}>Showroom Deliveries → Pending Bill</h3><p className="muted">Showroom se submit hui delivery yahan Pending Bill me aayegi. Loan case me DO dealer ne select kiya ho to wahi DO rahega; warna Billing yahan select kar sakti hai.</p>
 <div className="tablewrap"><table className="table"><thead><tr><th>Delivery</th><th>Date</th><th>Dealer</th><th>Customer</th><th>Type</th><th>Vehicle / Chassis</th><th>Sale</th><th>Loan</th><th>Down Payment</th><th>DO No.</th><th>Status</th><th>Action</th></tr></thead><tbody>
 {rows.map(r=><tr key={r.id}><td><b>{r.delivery_no}</b></td><td>{r.date}</td><td>{r.dealer_name||"—"}</td><td>{r.customer_name||"—"}<br/><small className="muted">{r.customer_phone||""}</small></td><td>{r.delivery_type}</td><td>{r.chassis_no||r.vehicle_no||"—"}</td><td><Money value={r.sale_amount}/></td><td><Money value={r.loan_amount}/></td><td><Money value={r.down_payment}/></td><td><b>{r.do_no||"—"}</b>{r.do_selected_by&&<small className="muted"> ({r.do_selected_by})</small>}</td><td>{r.billing_status}</td><td><button className="btn" onClick={()=>open(r)}>Edit DO</button></td></tr>)}
 {!rows.length&&<tr><td colSpan="12" className="muted">No showroom deliveries pending for bill.</td></tr>}</tbody></table></div>
 {edit&&<div className="modal"><div className="modalbox"><h2>DO No. — {edit.delivery_no}</h2><p className="muted">{edit.customer_name} · {edit.delivery_type} · {edit.chassis_no||edit.vehicle_no||"—"}</p><Field label="DO No." type="select" value={doNo} options={[{value:"",label:"No DO — leave for later"},...doOptions.map(x=>({value:x.do_no,label:x.do_no+" · "+(x.customer_name||x.application_no)}))]} onChange={setDoNo}/><div className="actions" style={{marginTop:16}}><button className="btn" onClick={()=>setEdit(null)}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving?"Saving…":"Save DO"}</button></div></div></div>}</div>
}

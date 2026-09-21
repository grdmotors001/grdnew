'use client';
import { useEffect, useState } from 'react';
import { get, post, downloadBlob } from '../lib/api';
import { Money, Field, ErrorBanner } from './ui';

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[manual,setManual]=useState([]),[dealers,setDealers]=useState([]),[approvedLoans,setApprovedLoans]=useState([]);
  const [form,setForm]=useState({dealer_id:'',date:new Date().toISOString().slice(0,10),chassis_no:'',sale_amount:'',remarks:''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[usingLoan,setUsingLoan]=useState('');
  const [billingTab,setBillingTab]=useState('pending');
  const [inventory,setInventory]=useState([]),[inventorySelected,setInventorySelected]=useState(new Set());
  const [invFrom,setInvFrom]=useState(''),[invTo,setInvTo]=useState(''),[invName,setInvName]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [a,m,d,l]=await Promise.all([get('/billing/pending-sales'),get('/billing/manual-pending-bills'),get('/dealer-list'),get('/billing/approved-loans')]);
      setRows(a.applications||[]);setManual(m.bills||[]);setDealers(d.dealers||[]);setApprovedLoans(l.applications||[]);
    }catch(e){setError(e.message)}finally{setLoading(false)}
  };
  const loadInventory=async()=>{
    try{
      const p=new URLSearchParams(); if(invFrom)p.set('from_date',invFrom); if(invTo)p.set('to_date',invTo); if(invName)p.set('name',invName);
      const r=await get('/billing/vehicle-inventory?'+p.toString()); setInventory(r.vehicles||[]); setInventorySelected(new Set());
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[]);
  useEffect(()=>{if(billingTab==='inventory')loadInventory()},[billingTab]);

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

  const toggleInventory=id=>setInventorySelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n});
  const selectAllInventory=()=>setInventorySelected(inventorySelected.size===inventory.length?new Set():new Set(inventory.map(x=>x.id)));
  const downloadSelectedTxt=async()=>{try{if(!inventorySelected.size)return setError('Select at least one vehicle.');await downloadBlob('/billing/vehicle-inventory/download-txt',{invoice_ids:[...inventorySelected]},'VahanInventoryTXT.TXT')}catch(e){setError(e.message)}};

  return <div className="page">
    <div className="pageHeader"><div><h2>Pending Bills / Billing</h2><p className="muted">Loan billing aur cash sales dono pehle Pending Bill me aayenge.</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
    <ErrorBanner message={error}/>
    <div className="actions" style={{marginBottom:14}}>
      <button className={billingTab==='pending'?'btn primary':'btn'} onClick={()=>setBillingTab('pending')}>Pending Billing</button>
      <button className={billingTab==='inventory'?'btn primary':'btn'} onClick={()=>setBillingTab('inventory')}>Vahan Inventory</button>
    </div>

    {billingTab==='inventory' ? <div className="card">
      <div className="actions" style={{marginBottom:12}}>
        <Field label="From Date" type="date" value={invFrom} onChange={setInvFrom}/>
        <Field label="To Date" type="date" value={invTo} onChange={setInvTo}/>
        <Field label="Name Filter" value={invName} onChange={setInvName} placeholder="Customer / Model"/>
        <button className="btn primary" onClick={loadInventory}>Search</button>
        <button className="btn" onClick={()=>{setInvFrom('');setInvTo('');setInvName('');setTimeout(loadInventory,0)}}>Clear</button>
        <button className="btn" disabled={!inventorySelected.size} onClick={downloadSelectedTxt}>Download Text File ({inventorySelected.size})</button>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr>
        <th><input type="checkbox" checked={inventory.length>0&&inventorySelected.size===inventory.length} onChange={selectAllInventory}/></th>
        <th>Date</th><th>Customer</th><th>Model</th><th>Chassis No.</th><th>Motor No.</th><th>UMRN</th><th>Manufacturing</th><th>Colour Code</th>
      </tr></thead><tbody>{inventory.map(r=><tr key={r.id}>
        <td><input type="checkbox" checked={inventorySelected.has(r.id)} onChange={()=>toggleInventory(r.id)}/></td>
        <td>{r.date}</td><td>{r.customer_name||'—'}</td><td>{r.model_name||'—'}</td><td><b>{r.chassis_no||'—'}</b></td><td>{r.motor_no||'—'}</td><td>{r.umrn||'—'}</td><td>{r.manufacturing_month||'—'}</td><td>{r.colour_code||'—'}</td>
      </tr>)}{!inventory.length&&<tr><td colSpan="9" className="muted">No vehicle records found.</td></tr>}</tbody></table></div>
    </div> : <>
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

    <div className="card" style={{marginBottom:14}}>
      <h3 style={{marginTop:0}}>Approved CHFPL Loans → Billing</h3>
      <p className="muted">CHFPL se approved/sanctioned loans yahan live dikhte hain. Inhi loans ko billing staff sale process me select karega.</p>
      <div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>Vehicle</th><th>Loan Amount</th><th>Status</th><th>Tenure</th><th>Action</th></tr></thead>
      <tbody>{approvedLoans.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}<br/><small className="muted">{r.customer_phone||''}</small></td><td>{r.vehicle_model_name||'—'}</td><td><Money value={r.loan_amount_requested}/></td><td><span className="loanStatus approved">{String(r.status||'').replace(/_/g,' ')}</span></td><td>{r.tenure_months||'—'} months</td><td><button className="btn primary" disabled={usingLoan===r.application_no} onClick={()=>useApprovedLoan(r.application_no)}>{usingLoan===r.application_no?'Using…':'Use for Pending Bill'}</button></td></tr>)}{!loading&&!approvedLoans.length&&<tr><td colSpan="8" className="muted">No approved CHFPL loans available for billing.</td></tr>}</tbody></table></div>
    </div>

    <div className="card"><h3 style={{marginTop:0}}>Loan / CHFPL Pending Sales</h3><div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>DO Status</th><th>Chassis</th><th>Sale Amount</th><th>Description</th><th>Billing Status</th><th>Action</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name}</td><td>{r.customer_name}</td><td>{r.status}</td><td>{r.billing_chassis_no||'—'}</td><td><Money value={r.billing_sale_amount}/></td><td>{r.dealer_description||'—'}</td><td><b>{r.billing_status}</b></td><td style={{display:'flex',gap:6,flexWrap:'wrap'}}>{r.billing_status==='PENDING_SALE'&&<button className="btn primary" onClick={()=>approve(r.id)}>Approve</button>}{r.billing_status==='BILL_APPROVED'&&<button className="btn primary" onClick={()=>bill(r.id)}>Generate Bill</button>}</td></tr>)}{!loading&&!rows.length&&<tr><td colSpan="9" className="muted">No loan pending sales.</td></tr>}</tbody></table></div>{loading&&<div className="muted" style={{padding:16}}>Loading…</div>}</div>
  </div>
}

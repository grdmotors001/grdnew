'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Money, Field, ErrorBanner } from './ui';

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[manual,setManual]=useState([]),[dealers,setDealers]=useState([]),[approvedLoans,setApprovedLoans]=useState([]);
  const [form,setForm]=useState({dealer_id:'',date:new Date().toISOString().slice(0,10),chassis_no:'',sale_amount:'',remarks:''});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [a,m,d,l]=await Promise.all([get('/billing/pending-sales'),get('/billing/manual-pending-bills'),get('/dealers'),get('/billing/approved-loans')]);
      setRows(a.applications||[]);setManual(m.bills||[]);setDealers(d.dealers||[]);setApprovedLoans(l.applications||[]);
    }catch(e){setError(e.message)}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const approve=async id=>{if(!confirm('Approve this Pending Sale for Bill generation?'))return;try{await post('/billing/pending-sales/'+id+'/approve',{});load()}catch(e){setError(e.message)}};
  const bill=async id=>{if(!confirm('Generate Tax Bill now?'))return;try{const r=await post('/billing/pending-sales/'+id+'/generate-bill',{});alert('Bill generated: '+(r.invoice?.bill_no||''));load()}catch(e){setError(e.message)}};
  const saveManual=async e=>{
    e.preventDefault();setSaving(true);setError('');
    try{await post('/billing/manual-pending-bills',{...form,dealer_id:Number(form.dealer_id),sale_amount:Number(form.sale_amount)});
      setForm({dealer_id:'',date:new Date().toISOString().slice(0,10),chassis_no:'',sale_amount:'',remarks:''});load();
    }catch(e){setError(e.message)}finally{setSaving(false)}
  };
  const approveManual=async id=>{if(!confirm('Approve this manual cash bill?'))return;try{await post('/billing/manual-pending-bills/'+id+'/approve',{});load()}catch(e){setError(e.message)}};

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

    <div className="card" style={{marginBottom:14}}>
      <h3 style={{marginTop:0}}>Approved CHFPL Loans → Billing</h3>
      <p className="muted">CHFPL se approved/sanctioned loans yahan live dikhte hain. Inhi loans ko billing staff sale process me select karega.</p>
      <div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>Vehicle</th><th>Loan Amount</th><th>Status</th><th>Tenure</th></tr></thead>
      <tbody>{approvedLoans.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}<br/><small className="muted">{r.customer_phone||''}</small></td><td>{r.vehicle_model_name||'—'}</td><td><Money value={r.loan_amount_requested}/></td><td><span className="loanStatus approved">{String(r.status||'').replace(/_/g,' ')}</span></td><td>{r.tenure_months||'—'} months</td></tr>)}{!loading&&!approvedLoans.length&&<tr><td colSpan="7" className="muted">No approved CHFPL loans available for billing.</td></tr>}</tbody></table></div>
    </div>

    <div className="card"><h3 style={{marginTop:0}}>Loan / CHFPL Pending Sales</h3><div className="tablewrap"><table className="table"><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>DO Status</th><th>Chassis</th><th>Sale Amount</th><th>Description</th><th>Billing Status</th><th>Action</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.dealer_name}</td><td>{r.customer_name}</td><td>{r.status}</td><td>{r.billing_chassis_no||'—'}</td><td><Money value={r.billing_sale_amount}/></td><td>{r.dealer_description||'—'}</td><td><b>{r.billing_status}</b></td><td style={{display:'flex',gap:6,flexWrap:'wrap'}}>{r.billing_status==='PENDING_SALE'&&<button className="btn primary" onClick={()=>approve(r.id)}>Approve</button>}{r.billing_status==='BILL_APPROVED'&&<button className="btn primary" onClick={()=>bill(r.id)}>Generate Bill</button>}</td></tr>)}{!loading&&!rows.length&&<tr><td colSpan="9" className="muted">No loan pending sales.</td></tr>}</tbody></table></div>{loading&&<div className="muted" style={{padding:16}}>Loading…</div>}</div>
  </div>
}

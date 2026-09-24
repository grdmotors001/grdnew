'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { Money, Field, ErrorBanner } from './ui';

const today=()=>new Date().toISOString().slice(0,10);

export function DealerCashReceiptPage() {
  const [customers,setCustomers]=useState([]);
  const [type,setType]=useState('new_booking');
  const [form,setForm]=useState({
    date:today(), customer_id:'', customer_name:'', customer_phone:'',
    sale_amount:'', booking_for:'new', loan_amount:'', amount:'',
    payment_mode:'cash', reference_no:'', remarks:''
  });
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);

  const loadCustomers=async()=>{
    setLoading(true); setError('');
    try{
      const r=await get('/dealer/cash-book/customers?payable_only=1');
      setCustomers(r.customers||[]);
    }catch(e){setError(e.message||'Could not load previous customers')}
    finally{setLoading(false)}
  };
  useEffect(()=>{loadCustomers()},[]);

  const selected=useMemo(()=>customers.find(x=>String(x.id)===String(form.customer_id)),[customers,form.customer_id]);
  const balance=Number(selected?.balance||0);
  // Balance Payment dropdown me sirf outstanding customers.
  const payableCustomers=useMemo(()=>customers.filter(c=>Number(c.balance||0)>0),[customers]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const changeType=v=>{
    setType(v);
    setForm(x=>({...x,customer_id:'',customer_name:'',customer_phone:'',sale_amount:'',booking_for:'new',loan_amount:'',amount:'',reference_no:'',remarks:''}));
    setReceipt(null);setError('');
  };

  const submit=async e=>{
    e.preventDefault(); setSaving(true); setError(''); setReceipt(null);
    try{
      const payload=type==='balance_payment'
        ? {receipt_type:type,date:form.date,customer_id:Number(form.customer_id),amount:Number(form.amount),payment_mode:form.payment_mode,reference_no:form.reference_no,remarks:form.remarks}
        : {receipt_type:type,date:form.date,customer_name:form.customer_name,customer_phone:form.customer_phone,
           sale_amount:Number(form.sale_amount),booking_for:form.booking_for,loan_amount:Number(form.loan_amount||0),
           amount:Number(form.amount),payment_mode:form.payment_mode,reference_no:form.reference_no,remarks:form.remarks};
      const r=await post('/dealer/cash-book/receipt',payload);
      setReceipt(r.receipt); await loadCustomers();
      setForm(x=>({...x,customer_id:'',customer_name:'',customer_phone:'',sale_amount:'',loan_amount:'',amount:'',reference_no:'',remarks:''}));
    }catch(e){setError(e.message||'Could not create receipt')}
    finally{setSaving(false)}
  };

  return <div className="dealerLoanPage">
    <div className="dealerPanel" style={{maxWidth:980}}>
      <div className="dealerPanelHead">
        <div><h3>Customer Cash Receipt</h3><p>Booking aur customer balance payment ki receipt yahin se banegi.</p></div>
        <button type="button" className="btn" onClick={loadCustomers}>↻ Refresh</button>
      </div>
      <ErrorBanner message={error}/>
      {receipt&&<div className="card" style={{padding:12,marginBottom:14}}>
        <b>Receipt Created: {receipt.receipt_no}</b><div className="muted" style={{marginTop:5}}>{receipt.customer_name} · ₹ {Number(receipt.amount||0).toLocaleString('en-IN')} · {receipt.date}</div>
        <button type="button" className="btn primary" style={{marginTop:9}} onClick={()=>window.print()}>Print Receipt</button>
      </div>}

      <div className="actions" style={{marginBottom:12}}>
        <button type="button" className={'btn '+(type==='new_booking'?'primary':'')} onClick={()=>changeType('new_booking')}>New Booking</button>
        <button type="button" className={'btn '+(type==='balance_payment'?'primary':'')} onClick={()=>changeType('balance_payment')}>Balance Payment</button>
      </div>

      <form onSubmit={submit}>
        {type==='balance_payment' ? <>
          <div className="grid">
            <Field label="Previous Customer" type="select" value={form.customer_id}
              options={[{value:'',label:'Select Previous Customer'},...payableCustomers.map(c=>({value:c.id,label:`${c.name} — ${c.phone||'No Mobile'} — Balance ₹${Number(c.balance||0).toLocaleString('en-IN')}`}))]}
              onChange={v=>set('customer_id',v)} required/>
            <Field label="Date" type="date" value={form.date} onChange={v=>set('date',v)} required/>
            <div className="card" style={{padding:10}}><small className="muted">Sale Amount</small><b>₹ {Number(selected?.sale_amount||0).toLocaleString('en-IN')}</b></div>
            <div className="card" style={{padding:10}}><small className="muted">Loan Amount</small><b>₹ {Number(selected?.loan_amount||0).toLocaleString('en-IN')}</b></div>
            <div className="card" style={{padding:10}}><small className="muted">Paid</small><b>₹ {Number(selected?.paid_amount||0).toLocaleString('en-IN')}</b></div>
            <div className="card" style={{padding:10}}><small className="muted">Outstanding Balance</small><b>₹ {balance.toLocaleString('en-IN')}</b></div>
            <Field label="Receipt Amount" type="number" value={form.amount} onChange={v=>set('amount',v)} required/>
            <div className="card" style={{padding:10}}><small className="muted">Payment Mode</small><b>Cash</b></div>
            <Field label="Reference No." value={form.reference_no} onChange={v=>set('reference_no',v)}/>
            <Field label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)}/>
          </div>
        </> : <>
          <div className="grid">
            <Field label="Customer Name" value={form.customer_name} onChange={v=>set('customer_name',v)} required/>
            <Field label="Mobile No." value={form.customer_phone} onChange={v=>set('customer_phone',v)} required/>
            <Field label="Date" type="date" value={form.date} onChange={v=>set('date',v)} required/>
            <Field label="Sale Amount" type="number" value={form.sale_amount} onChange={v=>set('sale_amount',v)} required/>
            <Field label="Vehicle / Booking Type" type="select" value={form.booking_for} options={[
              {value:'new',label:'New'}, {value:'old',label:'Old'}, {value:'battery',label:'Battery'}
            ]} onChange={v=>set('booking_for',v)}/>
            <Field label="Loan Amount" type="number" value={form.loan_amount} onChange={v=>set('loan_amount',v)}/>
            <Field label="Receipt Amount" type="number" value={form.amount} onChange={v=>set('amount',v)} required/>
            <div className="card" style={{padding:10}}><small className="muted">Payment Mode</small><b>Cash</b></div>
            <Field label="Reference No." value={form.reference_no} onChange={v=>set('reference_no',v)}/>
            <Field label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)}/>
          </div>
          <div className="muted" style={{margin:'8px 0'}}>New Booking: Sale Amount − Loan Amount = customer balance. Receipt Amount is the payment received today.</div>
        </>}
        <button className="btn primary" disabled={saving} style={{marginTop:12}}>{saving?'Saving…':'Create Receipt'}</button>
      </form>
    </div>

    <div className="dealerPanel" style={{maxWidth:980,marginTop:14}}>
      <div className="dealerPanelHead"><div><h3>Previous Customers</h3><p>Balance Payment ke liye customer yahin se select hoga.</p></div></div>
      {loading?<div className="dealerEmpty">Loading…</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Customer</th><th>Mobile</th><th>Type</th><th>Sale</th><th>Loan</th><th>Paid</th><th>Balance</th></tr></thead><tbody>
        {customers.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{c.phone||'—'}</td><td>{c.vehicle_no||'—'}</td><td>₹ {Number(c.sale_amount||0).toLocaleString('en-IN')}</td><td>₹ {Number(c.loan_amount||0).toLocaleString('en-IN')}</td><td>₹ {Number(c.paid_amount||0).toLocaleString('en-IN')}</td><td><b>₹ {Number(c.balance||0).toLocaleString('en-IN')}</b></td></tr>)}
        {!customers.length&&<tr><td colSpan="7" className="muted">No previous customers found.</td></tr>}
      </tbody></table></div>}
    </div>
  </div>;
}
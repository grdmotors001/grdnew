'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';

const categories = [
  ['tea_customer','Tea for Customer'],['tea_staff','Tea for Staff'],['water','Water Expense'],
  ['rent','Rent Expense'],['repairing','Repairing Expense'],['makhi_commission','Makhi / Commission Expense'],['other','Other Expense']
];
const money = v => `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const today = () => new Date().toISOString().slice(0,10);

export function DealerCashBook(){
  const [tab,setTab]=useState('book'), [from,setFrom]=useState(today()), [to,setTo]=useState(today()), [opening,setOpening]=useState('');
  const [data,setData]=useState({receipts:[],expenses:[],handovers:[],summary:{}});
  const [loading,setLoading]=useState(false), [saving,setSaving]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('');
  const [receipt,setReceipt]=useState({date:today(),customer_name:'',customer_phone:'',application_no:'',dealer_register_page_no:'',booking_for:'',amount:'',payment_mode:'cash',reference_no:'',remarks:''});
  const [expense,setExpense]=useState({date:today(),category:'tea_customer',amount:'',paid_to:'',remarks:''});
  const [handover,setHandover]=useState({date:today(),amount:'',sent_to:'',remarks:''});

  async function load(){setLoading(true);setError('');try{setData(await get(`/dealer/cash-book?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))}catch(e){setError(e.message||'Could not load Cash Book')}finally{setLoading(false)}}
  useEffect(()=>{load()},[from,to]);
  const flash=t=>{setMessage(t);setTimeout(()=>setMessage(''),2500)};
  async function save(path,payload,label,reset){setSaving(true);setError('');try{const d=await post(path,payload);reset();flash(label(d));await load();setTab('book')}catch(e){setError(e.message||'Could not save')}finally{setSaving(false)}}

  const entries=useMemo(()=>[
    ...(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({date:r.date,type:'Customer Receipt',no:r.receipt_no,narration:`${r.customer_name}${r.application_no?' · '+r.application_no:''}`,debit:0,credit:Number(r.amount||0)})),
    ...(data.expenses||[]).map(e=>({date:e.date,type:'Expense',no:e.expense_no,narration:e.category_label||e.category,debit:Number(e.amount||0),credit:0})),
    ...(data.handovers||[]).map(h=>({date:h.date,type:'HO Handover',no:h.handover_no,narration:h.sent_to||'Head Office',debit:Number(h.amount||0),credit:0}))
  ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.no).localeCompare(String(b.no))),[data]);
  const openingBalance=Number(data.summary?.opening_balance ?? 0);
  const closing=Number(data.summary?.closing_balance ?? (openingBalance+Number(data.summary?.net_movement||0)));

  return <div className="dealerPortal">
    <div className="dealerPortalHeader"><div><h1>Shop Cash Book</h1><div className="muted">G.R.D. dealer cash — customer receipts, shop expenses and Head Office handover</div></div></div>
    {error&&<div className="error">{error}</div>}{message&&<div className="card" style={{marginBottom:12}}>{message}</div>}
    <div className="grid dealerMetrics">
      <div className="card"><div className="muted">Opening</div><div className="metric">{money(openingBalance)}</div></div>
      <div className="card"><div className="muted">Cash Received</div><div className="metric">{money(data.summary?.cash_received)}</div></div>
      <div className="card"><div className="muted">Expenses</div><div className="metric">{money(data.summary?.expenses)}</div></div>
      <div className="card"><div className="muted">HO Handover</div><div className="metric">{money(data.summary?.ho_handover)}</div></div>
      <div className="card"><div className="muted">Closing Cash</div><div className="metric">{money(closing)}</div></div>
    </div>
    <div className="actions dealerTabs" style={{marginTop:16}}>
      <button className={'btn'+(tab==='book'?' primary':'')} onClick={()=>setTab('book')}>Cash Book</button>
      <button className={'btn'+(tab==='receipt'?' primary':'')} onClick={()=>setTab('receipt')}>+ Customer Receipt</button>
      <button className={'btn'+(tab==='expense'?' primary':'')} onClick={()=>setTab('expense')}>+ Expense</button>
      <button className={'btn'+(tab==='handover'?' primary':'')} onClick={()=>setTab('handover')}>+ HO Handover</button>
      <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/><div className="muted" style={{alignSelf:'center',fontSize:12}}>Opening = previous closing (auto)</div>
    </div>

    {tab==='receipt'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/receipt',receipt,d=>`Dealer Receipt ${d.receipt.receipt_no} created`,()=>setReceipt({...receipt,customer_name:'',customer_phone:'',application_no:'',dealer_register_page_no:'',booking_for:'',amount:'',reference_no:'',remarks:''}))}}>
      <h2>Customer Booking / Down Payment Receipt</h2><p className="muted">Independent G.R.D. dealer receipt. It does not create or modify CHFPL receipts.</p>
      <div className="grid">
        <input className="input" type="date" value={receipt.date} onChange={e=>setReceipt({...receipt,date:e.target.value})} required/><input className="input" placeholder="Customer Name" value={receipt.customer_name} onChange={e=>setReceipt({...receipt,customer_name:e.target.value})} required/>
        <input className="input" placeholder="Customer Phone" value={receipt.customer_phone} onChange={e=>setReceipt({...receipt,customer_phone:e.target.value})}/><input className="input" placeholder="Dealer Register Page No." value={receipt.dealer_register_page_no} onChange={e=>setReceipt({...receipt,dealer_register_page_no:e.target.value})}/><input className="input" placeholder="Application / Booking No." value={receipt.application_no} onChange={e=>setReceipt({...receipt,application_no:e.target.value})}/>
        <input className="input" placeholder="Vehicle / Model" value={receipt.booking_for} onChange={e=>setReceipt({...receipt,booking_for:e.target.value})}/><input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={receipt.amount} onChange={e=>setReceipt({...receipt,amount:e.target.value})} required/>
        <select className="input" value={receipt.payment_mode} onChange={e=>setReceipt({...receipt,payment_mode:e.target.value})}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
        <input className="input" placeholder="Reference No." value={receipt.reference_no} onChange={e=>setReceipt({...receipt,reference_no:e.target.value})}/><input className="input" placeholder="Remarks" value={receipt.remarks} onChange={e=>setReceipt({...receipt,remarks:e.target.value})}/>
      </div><button className="btn primary" disabled={saving}>Create Dealer Receipt</button>
    </form>}

    {tab==='expense'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/expense',expense,d=>`Expense ${d.expense.expense_no} saved`,()=>setExpense({...expense,amount:'',paid_to:'',remarks:''}))}}>
      <h2>Shop Expense</h2><div className="grid"><input className="input" type="date" value={expense.date} onChange={e=>setExpense({...expense,date:e.target.value})} required/>
      <select className="input" value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}>{categories.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
      <input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})} required/><input className="input" placeholder="Paid To" value={expense.paid_to} onChange={e=>setExpense({...expense,paid_to:e.target.value})}/><input className="input" placeholder="Remarks" value={expense.remarks} onChange={e=>setExpense({...expense,remarks:e.target.value})}/></div>
      <button className="btn primary" disabled={saving}>Save Expense</button></form>}

    {tab==='handover'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/handover',handover,d=>`Handover ${d.handover.handover_no} saved`,()=>setHandover({...handover,amount:'',sent_to:'',remarks:''}))}}>
      <h2>Cash Handover to Head Office</h2><div className="grid"><input className="input" type="date" value={handover.date} onChange={e=>setHandover({...handover,date:e.target.value})} required/><input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={handover.amount} onChange={e=>setHandover({...handover,amount:e.target.value})} required/><input className="input" placeholder="Sent To / Received By" value={handover.sent_to} onChange={e=>setHandover({...handover,sent_to:e.target.value})}/><input className="input" placeholder="Remarks" value={handover.remarks} onChange={e=>setHandover({...handover,remarks:e.target.value})}/></div>
      <button className="btn primary" disabled={saving}>Record HO Handover</button></form>}

    {tab==='book'&&<div className="card"><h2>Cash Book Entries</h2>{loading?<div className="muted">Loading...</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Narration</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{entries.map(e=><tr key={e.type+'-'+e.no}><td>{e.date}</td><td>{e.type}</td><td><b>{e.no}</b></td><td>{e.narration}</td><td>{e.debit?money(e.debit):'—'}</td><td>{e.credit?money(e.credit):'—'}</td></tr>)}{!entries.length&&<tr><td colSpan="6" className="muted">No cash entries for this date range.</td></tr>}</tbody></table></div>}</div>}
  </div>
}

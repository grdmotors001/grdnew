'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post, put, downloadExcel } from '../lib/api';
import { DayBookPreview } from './DayBookPreview';

const categories = [
  ['tea_customer','Tea for Customer'],['tea_staff','Tea for Staff'],['water','Water Expense'],
  ['rent','Rent Expense'],['repairing','Repairing Expense'],['makhi_commission','Makhi / Commission Expense'],['other','Other Expense']
];
const money = v => `₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const today = () => new Date().toISOString().slice(0,10);

const blankReceipt = () => ({date:today(),customer_id:'',customer_name:'',customer_phone:'',dealer_register_page_no:'',application_no:'',booking_for:'',amount:'',payment_mode:'cash',reference_no:'',remarks:''});

export function DealerCashBook(){
  const [tab,setTab]=useState('book');
  const [from,setFrom]=useState(today()), [to,setTo]=useState(today());
  const [data,setData]=useState({receipts:[],expenses:[],handovers:[],summary:{}});
  const [allReceipts,setAllReceipts]=useState([]);
  const [customers,setCustomers]=useState([]);
  const [customerSearch,setCustomerSearch]=useState('');
  const [selectedCustomer,setSelectedCustomer]=useState(null);
  const [editing,setEditing]=useState(null);
  const [receipt,setReceipt]=useState(blankReceipt());
  const [expense,setExpense]=useState({date:today(),category:'tea_customer',amount:'',paid_to:'',remarks:''});
  const [handover,setHandover]=useState({date:today(),amount:'',sent_to:'',remarks:''});
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');

  async function loadBook(){setLoading(true);setError('');try{setData(await get(`/dealer/cash-book?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))}catch(e){setError(e.message||'Could not load Cash Book')}finally{setLoading(false)}}
  async function loadReceipts(){try{const d=await get('/dealer/cash-book/all-receipts');setAllReceipts(d.receipts||[])}catch(e){setError(e.message||'Could not load receipts')}}
  async function loadCustomers(q=''){try{const d=await get(`/dealer/cash-book/customers?q=${encodeURIComponent(q)}`);setCustomers(d.customers||[])}catch(e){setError(e.message||'Could not load customers')}}
  useEffect(()=>{loadBook()},[from,to]);
  useEffect(()=>{if(tab==='receipts')loadReceipts();if(tab==='customers')loadCustomers()},[tab]);

  const flash=t=>{setMessage(t);setTimeout(()=>setMessage(''),2500)};
  async function save(path,payload,label,reset){setSaving(true);setError('');try{const d=await post(path,payload);reset();flash(label(d));await loadBook();if(tab==='receipts')await loadReceipts();if(tab==='customers')await loadCustomers();setTab('book')}catch(e){setError(e.message||'Could not save')}finally{setSaving(false)}}

  const entries=useMemo(()=>[
    ...(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({date:r.date,type:'Customer Receipt',no:r.receipt_no,narration:r.customer_name,debit:0,credit:Number(r.amount||0)})),
    ...(data.expenses||[]).map(e=>({date:e.date,type:'Expense',no:e.expense_no,narration:e.category_label||e.category,debit:Number(e.amount||0),credit:0})),
    ...(data.handovers||[]).map(h=>({date:h.date,type:'HO Handover',no:h.handover_no,narration:h.sent_to||'Head Office',debit:Number(h.amount||0),credit:0}))
  ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.no).localeCompare(String(b.no))),[data]);
  const openingBalance=Number(data.summary?.opening_balance||0);
  const closing=Number(data.summary?.closing_balance??(openingBalance+Number(data.summary?.net_movement||0)));

  const customerMatches = customerSearch.trim() ? customers.filter(c=>[c.page_no,c.name,c.phone,c.vehicle_no].join(' ').toLowerCase().includes(customerSearch.trim().toLowerCase())).slice(0,8) : [];
  const chooseCustomer = c => {
    setSelectedCustomer(c);
    setCustomerSearch('');
    setReceipt(x=>({...x,customer_id:String(c.id),customer_name:c.name||'',customer_phone:c.phone||'',dealer_register_page_no:c.page_no||''}));
  };

  async function saveCustomer(){
    if(!editing)return;
    setSaving(true);setError('');
    try{const d=await put(`/dealer/cash-book/customers/${editing.id}`,editing);flash('Customer record updated');setEditing(null);await loadCustomers();setCustomers(x=>x);if(d.customer)setSelectedCustomer(d.customer)}catch(e){setError(e.message||'Could not update customer')}finally{setSaving(false)}
  }

  const exportDayBook = () => downloadExcel('/dealer/cash-book?from='+from+'&to='+to,'Cash_Day_Book_'+from+'.xlsx');

  return (
    <div className="dealerPortal">
    <div className="dealerPortalHeader"><div><h1>Showroom Cash Book</h1><div className="muted">Customer receipts, customer register, shop expenses and Head Office handover</div></div></div>
    {error&&<div className="error">{error}</div>}{message&&<div className="card" style={{marginBottom:12}}>{message}</div>}

    <div className="grid dealerMetrics">
      <div className="card"><div className="muted">Opening</div><div className="metric">{money(openingBalance)}</div></div>
      <div className="card"><div className="muted">Cash Received</div><div className="metric">{money(data.summary?.cash_received)}</div></div>
      <div className="card"><div className="muted">Expenses</div><div className="metric">{money(data.summary?.expenses)}</div></div>
      <div className="card"><div className="muted">HO Handover</div><div className="metric">{money(data.summary?.ho_handover)}</div></div>
      <div className="card"><div className="muted">Closing Cash</div><div className="metric">{money(closing)}</div></div>
    </div>

    <div className="actions dealerTabs" style={{marginTop:16,flexWrap:'wrap'}}>
      <button className={'btn'+(tab==='book'?' primary':'')} onClick={()=>setTab('book')}>Cash Book</button>
      <button className={'btn'+(tab==='receipt'?' primary':'')} onClick={()=>setTab('receipt')}>+ Customer Receipt</button>
      <button className={'btn'+(tab==='receipts'?' primary':'')} onClick={()=>setTab('receipts')}>All Receipts</button>
      <button className={'btn'+(tab==='customers'?' primary':'')} onClick={()=>{setTab('customers');loadCustomers()}}>All Customers</button>
      <button className={'btn'+(tab==='expense'?' primary':'')} onClick={()=>setTab('expense')}>+ Expense</button>
      <button className={'btn'+(tab==='handover'?' primary':'')} onClick={()=>setTab('handover')}>+ HO Handover</button>
      <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
    </div>

    {tab==='receipt'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/receipt',receipt,d=>`Receipt ${d.receipt.receipt_no} created`,()=>{setReceipt(blankReceipt());setSelectedCustomer(null);setCustomerSearch('')})}}>
      <h2>Customer Receipt</h2><p className="muted">New booking: enter name/mobile directly. Existing customer: search and select below.</p>
      <div style={{position:'relative',marginBottom:12}}>
        <input className="input" placeholder="🔎 Search existing customer by name / mobile / page no." value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);loadCustomers(e.target.value)}}/>
        {customerMatches.length>0&&<div style={{position:'absolute',zIndex:20,left:0,right:0,top:'100%',background:'var(--card,#111827)',border:'1px solid #334155',borderRadius:10,overflow:'hidden'}}>
          {customerMatches.map(c=><button type="button" key={c.id} onClick={()=>chooseCustomer(c)} style={{display:'block',width:'100%',textAlign:'left',padding:12,border:0,borderBottom:'1px solid #334155',background:'transparent',color:'inherit',cursor:'pointer'}}>
            <b>{c.name}</b> <span className="muted">· {c.phone||'No mobile'} · Page {c.page_no||'—'}</span><div className="muted">{c.vehicle_no||'Vehicle not set'} · Balance {money(c.balance)}</div>
          </button>)}
        </div>}
      </div>
      {selectedCustomer&&<div className="card" style={{marginBottom:12,padding:12}}><b>Selected: {selectedCustomer.name}</b><span className="muted"> · Page {selectedCustomer.page_no||'—'} · Balance {money(selectedCustomer.balance)}</span><button type="button" className="btn" style={{float:'right'}} onClick={()=>{setSelectedCustomer(null);setReceipt(x=>({...x,customer_id:''}))}}>Change</button></div>}
      <div className="grid">
        <input className="input" type="date" value={receipt.date} onChange={e=>setReceipt({...receipt,date:e.target.value})} required/>
        <input className="input" placeholder="Customer Name" value={receipt.customer_name} onChange={e=>setReceipt({...receipt,customer_name:e.target.value})} required/>
        <input className="input" placeholder="Mobile No." value={receipt.customer_phone} onChange={e=>setReceipt({...receipt,customer_phone:e.target.value})}/>
        <input className="input" placeholder="Customer Register Page No. (manual)" value={receipt.dealer_register_page_no} onChange={e=>setReceipt({...receipt,dealer_register_page_no:e.target.value})}/>
        <input className="input" placeholder="Application / Booking No." value={receipt.application_no} onChange={e=>setReceipt({...receipt,application_no:e.target.value})}/>
        <input className="input" placeholder="Vehicle / Model" value={receipt.booking_for} onChange={e=>setReceipt({...receipt,booking_for:e.target.value})}/>
        <input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={receipt.amount} onChange={e=>setReceipt({...receipt,amount:e.target.value})} required/>
        <select className="input" value={receipt.payment_mode} onChange={e=>setReceipt({...receipt,payment_mode:e.target.value})}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
        <input className="input" placeholder="Reference No." value={receipt.reference_no} onChange={e=>setReceipt({...receipt,reference_no:e.target.value})}/><input className="input" placeholder="Remarks" value={receipt.remarks} onChange={e=>setReceipt({...receipt,remarks:e.target.value})}/>
      </div>
      <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Receipt'}</button>
    </form>}

    {tab==='receipts'&&<div className="card"><div className="dealerPortalHeader"><div><h2>All Receipts</h2><div className="muted">Every showroom receipt — latest first</div></div></div>
      <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Receipt No.</th><th>Name</th><th>Amount</th><th>Page No.</th></tr></thead><tbody>
        {allReceipts.map(r=><tr key={r.id}><td>{r.date}</td><td><b>{r.receipt_no}</b></td><td>{r.customer_name}<div className="muted">{r.customer_phone||''}</div></td><td>{money(r.amount)}</td><td>{r.dealer_register_page_no||'—'}</td></tr>)}
        {!allReceipts.length&&<tr><td colSpan="5" className="muted">No receipts found.</td></tr>}
      </tbody></table></div>
    </div>}

    {tab==='customers'&&<div className="card"><div className="dealerPortalHeader"><div><h2>All Customers</h2><div className="muted">Showroom customer register — page number is maintained manually</div></div><button className="btn" onClick={()=>loadCustomers()}>Refresh</button></div>
      <div style={{display:'flex',gap:8,marginBottom:12}}><input className="input" placeholder="Search page no. / name / mobile / vehicle no." value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);loadCustomers(e.target.value)}}/></div>
      <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Page No.</th><th>Name</th><th>Phone</th><th>Financer</th><th>Vehicle No.</th><th>Sale Amount</th><th>Loan</th><th>Balance</th><th></th></tr></thead><tbody>
        {customers.map(c=><tr key={c.id}><td>{c.page_no||'—'}</td><td><b>{c.name}</b></td><td>{c.phone||'—'}</td><td>{c.financer||'—'}</td><td>{c.vehicle_no||'—'}</td><td>{money(c.sale_amount)}</td><td>{money(c.loan_amount)}</td><td><b>{money(c.balance)}</b></td><td><button className="btn" onClick={()=>setEditing({...c})}>Edit</button></td></tr>)}
        {!customers.length&&<tr><td colSpan="9" className="muted">No customers found.</td></tr>}
      </tbody></table></div>
    </div>}

    {editing&&<div className="card" style={{marginTop:12}}><h2>Edit Customer</h2><div className="grid">
      {[
        ['page_no','Page No.'],['name','Name'],['phone','Phone No.']
      ].map(([k,l])=><input key={k} className="input" placeholder={l} value={editing[k]||''} onChange={e=>setEditing({...editing,[k]:e.target.value})}/>)}
      <div className="muted" style={{gridColumn:'1 / -1'}}>Financer, Vehicle No., Sale Amount and Loan are maintained by Billing Department and are shown here only.</div>

    </div><div className="actions"><button className="btn primary" disabled={saving} onClick={saveCustomer}>Save Customer</button><button className="btn" onClick={()=>setEditing(null)}>Cancel</button></div></div>}

    {tab==='expense'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/expense',expense,d=>`Expense ${d.expense.expense_no} saved`,()=>setExpense({...expense,amount:'',paid_to:'',remarks:''}))}}>
      <h2>Shop Expense</h2><div className="grid"><input className="input" type="date" value={expense.date} onChange={e=>setExpense({...expense,date:e.target.value})} required/><select className="input" value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}>{categories.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select><input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})} required/><input className="input" placeholder="Paid To" value={expense.paid_to} onChange={e=>setExpense({...expense,paid_to:e.target.value})}/><input className="input" placeholder="Remarks" value={expense.remarks} onChange={e=>setExpense({...expense,remarks:e.target.value})}/></div><button className="btn primary" disabled={saving}>Save Expense</button></form>}

    {tab==='handover'&&<form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/handover',handover,d=>`Handover ${d.handover.handover_no} saved`,()=>setHandover({...handover,amount:'',sent_to:'',remarks:''}))}}>
      <h2>Cash Handover to Head Office</h2><div className="grid"><input className="input" type="date" value={handover.date} onChange={e=>setHandover({...handover,date:e.target.value})} required/><input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={handover.amount} onChange={e=>setHandover({...handover,amount:e.target.value})} required/><input className="input" placeholder="Sent To / Received By" value={handover.sent_to} onChange={e=>setHandover({...handover,sent_to:e.target.value})}/><input className="input" placeholder="Remarks" value={handover.remarks} onChange={e=>setHandover({...handover,remarks:e.target.value})}/></div><button className="btn primary" disabled={saving}>Record HO Handover</button></form>}

    {tab==='book'&&<DayBookPreview
      date={from}
      dealerLabel="Showroom Branch"
      receipts={(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({
        id:r.id,no:r.receipt_no,date:r.date,particulars:r.customer_name||'Customer Receipt',
        folio:r.dealer_register_page_no||'',amount:r.amount
      }))}
      payments={[
        ...(data.expenses||[]).map(e=>({id:'e'+e.id,no:e.expense_no,date:e.date,particulars:e.category_label||e.category,folio:e.folio||'',amount:e.amount})),
        ...(data.handovers||[]).map(h=>({id:'h'+h.id,no:h.handover_no,date:h.date,particulars:h.sent_to||'Head Office',folio:h.folio||'',amount:h.amount}))
      ]}
      openingBalance={openingBalance}
      closingBalance={closing}
      onDateChange={d=>{setFrom(d);setTo(d)}}
      onPrev={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()-1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
      onNext={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()+1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
      onPrint={()=>window.print()}
      onExport={exportDayBook}
    />
    </div>
  );
}

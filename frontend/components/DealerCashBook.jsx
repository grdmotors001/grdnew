'use client';

import { useEffect, useState } from 'react';
import { get, post, put, downloadExcel } from '../lib/api';
import { DayBookPreview } from './DayBookPreview';

const today = () => new Date().toISOString().slice(0,10);
const money = v => `₹${Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2})`;
const categories = [
  ['tea_customer','Tea for Customer'],['tea_staff','Tea for Staff'],['water','Water Expense'],
  ['rent','Rent Expense'],['repairing','Repairing Expense'],['makhi_commission','Makhi / Commission Expense'],['other','Other Expense']
];

export function DealerCashBook(){
  const [tab,setTab]=useState('book');
  const [from,setFrom]=useState(today());
  const [to,setTo]=useState(today());
  const [data,setData]=useState({receipts:[],expenses:[],handovers:[],summary:{}});
  const [customers,setCustomers]=useState([]);
  const [allReceipts,setAllReceipts]=useState([]);
  const [search,setSearch]=useState('');
  const [selectedCustomer,setSelectedCustomer]=useState(null);
  const [editing,setEditing]=useState(null);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [receipt,setReceipt]=useState({date:today(),customer_id:'',customer_name:'',customer_phone:'',dealer_register_page_no:'',application_no:'',booking_for:'',amount:'',payment_mode:'cash',reference_no:'',remarks:''});
  const [expense,setExpense]=useState({date:today(),category:'tea_customer',amount:'',paid_to:'',remarks:''});
  const [handover,setHandover]=useState({date:today(),amount:'',sent_to:'',remarks:''});

  const loadBook=async()=>{try{setError('');setData(await get('/dealer/cash-book?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)))}catch(e){setError(e.message||'Could not load Cash Book')}};
  const loadCustomers=async(q='')=>{try{const d=await get('/dealer/cash-book/customers?q='+encodeURIComponent(q));setCustomers(d.customers||[])}catch(e){setError(e.message||'Could not load customers')}};
  const loadReceipts=async()=>{try{const d=await get('/dealer/cash-book/all-receipts');setAllReceipts(d.receipts||[])}catch(e){setError(e.message||'Could not load receipts')}};
  useEffect(()=>{loadBook()},[from,to]);
  useEffect(()=>{if(tab==='customers')loadCustomers();if(tab==='receipts')loadReceipts()},[tab]);

  const flash=t=>{setMessage(t);setTimeout(()=>setMessage(''),2500)};
  const save=async(path,payload,label,reset)=>{setSaving(true);setError('');try{const d=await post(path,payload);reset();flash(label(d));await loadBook();setTab('book')}catch(e){setError(e.message||'Could not save')}finally{setSaving(false)}};
  const chooseCustomer=c=>{setSelectedCustomer(c);setSearch('');setReceipt(x=>({...x,customer_id:String(c.id),customer_name:c.name||'',customer_phone:c.phone||'',dealer_register_page_no:c.page_no||''}))};
  const customerMatches=search.trim()?customers.filter(c=>[c.page_no,c.name,c.phone,c.vehicle_no].join(' ').toLowerCase().includes(search.trim().toLowerCase())).slice(0,8):[];
  const opening=Number(data.summary?.opening_balance||0);
  const closing=Number(data.summary?.closing_balance??(opening+Number(data.summary?.net_movement||0)));
  const exportDayBook=()=>downloadExcel('/dealer/cash-book?from='+from+'&to='+to,'Cash_Day_Book_'+from+'.xlsx');

  const field=(label,key,obj,setter,type='text')=><input className="input" type={type} placeholder={label} value={obj[key]||''} onChange={e=>setter({...obj,[key]:e.target.value})}/>;

  return (
    <div className="dealerPortal">
      <div className="dealerPortalHeader">
        <div><h1>Showroom Cash Book</h1><div className="muted">Customer receipts, customer register, shop expenses and Head Office handover</div></div>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="card" style={{marginBottom:12}}>{message}</div>}

      <div className="grid dealerMetrics">
        <div className="card"><div className="muted">Opening</div><div className="metric">{money(opening)}</div></div>
        <div className="card"><div className="muted">Cash Received</div><div className="metric">{money(data.summary?.cash_received)}</div></div>
        <div className="card"><div className="muted">Expenses</div><div className="metric">{money(data.summary?.expenses)}</div></div>
        <div className="card"><div className="muted">HO Handover</div><div className="metric">{money(data.summary?.ho_handover)}</div></div>
        <div className="card"><div className="muted">Closing Cash</div><div className="metric">{money(closing)}</div></div>
      </div>

      <div className="actions dealerTabs" style={{marginTop:16,flexWrap:'wrap'}}>
        {[
          ['book','Cash Book'],['receipt','+ Customer Receipt'],['receipts','All Receipts'],
          ['customers','All Customers'],['expense','+ Expense'],['handover','+ HO Handover']
        ].map(([k,label])=><button key={k} className={'btn'+(tab===k?' primary':'')} onClick={()=>setTab(k)}>{label}</button>)}
        <input className="input" type="date" value={from} onChange={e=>{setFrom(e.target.value);setTo(e.target.value)}}/>
        <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
      </div>

      {tab==='book' && <DayBookPreview
        date={from}
        dealerLabel="Showroom Branch"
        receipts={(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({id:r.id,no:r.receipt_no,date:r.date,particulars:r.customer_name||'Customer Receipt',folio:r.dealer_register_page_no||'',amount:r.amount}))}
        payments={[
          ...(data.expenses||[]).map(e=>({id:'e'+e.id,no:e.expense_no,date:e.date,particulars:e.category_label||e.category,folio:e.folio||'',amount:e.amount})),
          ...(data.handovers||[]).map(h=>({id:'h'+h.id,no:h.handover_no,date:h.date,particulars:h.sent_to||'Head Office',folio:h.folio||'',amount:h.amount}))
        ]}
        openingBalance={opening}
        closingBalance={closing}
        onDateChange={d=>{setFrom(d);setTo(d)}}
        onPrev={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()-1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
        onNext={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()+1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
        onPrint={()=>window.print()}
        onExport={exportDayBook}
      />}

      {tab==='receipt' && <form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/receipt',receipt,d=>`Receipt ${d.receipt.receipt_no} created`,()=>{setReceipt({date:today(),customer_id:'',customer_name:'',customer_phone:'',dealer_register_page_no:'',application_no:'',booking_for:'',amount:'',payment_mode:'cash',reference_no:'',remarks:''});setSelectedCustomer(null);setSearch('')})}}>
        <h2>Customer Receipt</h2>
        <div style={{position:'relative',marginBottom:12}}>
          <input className="input" placeholder="Search existing customer by name / mobile / page no." value={search} onChange={e=>{setSearch(e.target.value);loadCustomers(e.target.value)}}/>
          {customerMatches.length>0 && <div style={{position:'absolute',zIndex:20,left:0,right:0,top:'100%',background:'var(--card,#111827)',border:'1px solid #334155',borderRadius:10,overflow:'hidden'}}>
            {customerMatches.map(c=><button type="button" key={c.id} onClick={()=>chooseCustomer(c)} style={{display:'block',width:'100%',textAlign:'left',padding:12,border:0,borderBottom:'1px solid #334155',background:'transparent',color:'inherit'}}><b>{c.name}</b> <span className="muted">· {c.phone||'No mobile'} · Page {c.page_no||'—'}</span><div className="muted">{c.vehicle_no||'Vehicle not set'} · Balance {money(c.balance)}</div></button>)}
          </div>}
        </div>
        {selectedCustomer && <div className="card" style={{marginBottom:12,padding:12}}><b>Selected: {selectedCustomer.name}</b><span className="muted"> · Page {selectedCustomer.page_no||'—'} · Balance {money(selectedCustomer.balance)}</span></div>}
        <div className="grid">
          {field('Date','date',receipt,setReceipt,'date')}{field('Customer Name','customer_name',receipt,setReceipt)}
          {field('Mobile No.','customer_phone',receipt,setReceipt)}{field('Customer Register Page No.','dealer_register_page_no',receipt,setReceipt)}
          {field('Application / Booking No.','application_no',receipt,setReceipt)}{field('Vehicle / Model','booking_for',receipt,setReceipt)}
          {field('Amount','amount',receipt,setReceipt,'number')}
          <select className="input" value={receipt.payment_mode} onChange={e=>setReceipt({...receipt,payment_mode:e.target.value})}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
          {field('Reference No.','reference_no',receipt,setReceipt)}{field('Remarks','remarks',receipt,setReceipt)}
        </div>
        <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Receipt'}</button>
      </form>}

      {tab==='receipts' && <div className="card"><h2>All Receipts</h2><div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Receipt No.</th><th>Name</th><th>Amount</th><th>Page No.</th></tr></thead><tbody>{allReceipts.map(r=><tr key={r.id}><td>{r.date}</td><td><b>{r.receipt_no}</b></td><td>{r.customer_name}<div className="muted">{r.customer_phone||''}</div></td><td>{money(r.amount)}</td><td>{r.dealer_register_page_no||'—'}</td></tr>)}{!allReceipts.length&&<tr><td colSpan="5" className="muted">No receipts found.</td></tr>}</tbody></table></div></div>}

      {tab==='customers' && <div className="card"><div className="dealerPortalHeader"><div><h2>All Customers</h2><div className="muted">Showroom customer register</div></div><button className="btn" onClick={()=>loadCustomers()}>Refresh</button></div><input className="input" placeholder="Search page no. / name / mobile / vehicle no." value={search} onChange={e=>{setSearch(e.target.value);loadCustomers(e.target.value)}}/><div className="tablewrap dealerTable" style={{marginTop:12}}><table className="table"><thead><tr><th>Page No.</th><th>Name</th><th>Phone</th><th>Financer</th><th>Vehicle No.</th><th>Sale Amount</th><th>Loan</th><th>Balance</th><th></th></tr></thead><tbody>{customers.map(c=><tr key={c.id}><td>{c.page_no||'—'}</td><td><b>{c.name}</b></td><td>{c.phone||'—'}</td><td>{c.financer||'—'}</td><td>{c.vehicle_no||'—'}</td><td>{money(c.sale_amount)}</td><td>{money(c.loan_amount)}</td><td><b>{money(c.balance)}</b></td><td><button className="btn" onClick={()=>setEditing({...c})}>Edit</button></td></tr>)}</tbody></table></div></div>}

      {editing && <div className="card" style={{marginTop:12}}><h2>Edit Customer</h2><div className="grid">{field('Page No.','page_no',editing,setEditing)}{field('Name','name',editing,setEditing)}{field('Phone No.','phone',editing,setEditing)}</div><div className="actions"><button className="btn primary" disabled={saving} onClick={async()=>{setSaving(true);try{const d=await put('/dealer/cash-book/customers/'+editing.id,editing);flash('Customer record updated');setEditing(null);await loadCustomers();if(d.customer)setSelectedCustomer(d.customer)}catch(e){setError(e.message||'Could not update customer')}finally{setSaving(false)}}}>Save Customer</button><button className="btn" onClick={()=>setEditing(null)}>Cancel</button></div></div>}

      {tab==='expense' && <form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/expense',expense,d=>`Expense ${d.expense.expense_no} saved`,()=>setExpense({...expense,amount:'',paid_to:'',remarks:''}))}}><h2>Shop Expense</h2><div className="grid">{field('Date','date',expense,setExpense,'date')}<select className="input" value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}>{categories.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>{field('Amount','amount',expense,setExpense,'number')}{field('Paid To','paid_to',expense,setExpense)}{field('Remarks','remarks',expense,setExpense)}</div><button className="btn primary" disabled={saving}>Save Expense</button></form>}

      {tab==='handover' && <form className="card" onSubmit={e=>{e.preventDefault();save('/dealer/cash-book/handover',handover,d=>`Handover ${d.handover.handover_no} saved`,()=>setHandover({...handover,amount:'',sent_to:'',remarks:''}))}}><h2>Cash Handover to Head Office</h2><div className="grid">{field('Date','date',handover,setHandover,'date')}{field('Amount','amount',handover,setHandover,'number')}{field('Sent To / Received By','sent_to',handover,setHandover)}{field('Remarks','remarks',handover,setHandover)}</div><button className="btn primary" disabled={saving}>Record HO Handover</button></form>}
    </div>
  );
}

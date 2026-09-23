'use client';

import { useEffect, useState } from 'react';
import { get, downloadExcel } from '../lib/api';
import { DayBookPreview } from './DayBookPreview';

const today = () => new Date().toISOString().slice(0,10);
const money = v => `₹${Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

// Cash / Day Book ledger only. Receipt, expense, handover and customer masters
// are maintained in DealerCashBookExtras.jsx so each workflow has one place.
export function DealerCashBook(){
  const [from,setFrom]=useState(today());
  const [to,setTo]=useState(today());
  const [data,setData]=useState({receipts:[],expenses:[],handovers:[],summary:{}});
  const [error,setError]=useState('');
  const loadBook=async()=>{try{setError('');setData(await get('/dealer/cash-book?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)))}catch(e){setError(e.message||'Could not load Cash Book')}};
  useEffect(()=>{loadBook()},[from,to]);
  const opening=Number(data.summary?.opening_balance||0);
  const closing=Number(data.summary?.closing_balance??(opening+Number(data.summary?.net_movement||0)));
  const exportDayBook=()=>downloadExcel('/dealer/cash-book?from='+from+'&to='+to,'Cash_Day_Book_'+from+'.xlsx');
  return <div className="dealerPortal">
    <div className="dealerPortalHeader"><div><h1>Showroom Cash Book</h1><div className="muted">Cash / Day Book ledger</div></div></div>
    {error&&<div className="error">{error}</div>}
    <div className="grid dealerMetrics">
      <div className="card"><div className="muted">Opening</div><div className="metric">{money(opening)}</div></div>
      <div className="card"><div className="muted">Cash Received</div><div className="metric">{money(data.summary?.cash_received)}</div></div>
      <div className="card"><div className="muted">Expenses</div><div className="metric">{money(data.summary?.expenses)}</div></div>
      <div className="card"><div className="muted">HO Handover</div><div className="metric">{money(data.summary?.ho_handover)}</div></div>
      <div className="card"><div className="muted">Closing Cash</div><div className="metric">{money(closing)}</div></div>
    </div>
    <div className="actions dealerTabs" style={{marginTop:16,flexWrap:'wrap'}}>
      <input className="input" type="date" value={from} onChange={e=>{setFrom(e.target.value);setTo(e.target.value)}}/>
      <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
    </div>
    <DayBookPreview date={from} dealerLabel="Showroom Branch"
      receipts={(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({id:r.id,no:r.receipt_no,date:r.date,particulars:r.customer_name||'Customer Receipt',folio:r.dealer_register_page_no||'',amount:r.amount}))}
      payments={[...(data.expenses||[]).map(e=>({id:'e'+e.id,no:e.expense_no,date:e.date,particulars:e.category_label||e.category,folio:e.folio||'',amount:e.amount})),...(data.handovers||[]).map(h=>({id:'h'+h.id,no:h.handover_no,date:h.date,particulars:h.sent_to||'Head Office',folio:h.folio||'',amount:h.amount}))]}
      openingBalance={opening} closingBalance={closing}
      onDateChange={d=>{setFrom(d);setTo(d)}}
      onPrev={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()-1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
      onNext={()=>{const x=new Date(from+'T00:00:00');x.setDate(x.getDate()+1);const d=x.toISOString().slice(0,10);setFrom(d);setTo(d)}}
      onPrint={()=>window.print()} onExport={exportDayBook}/>
  </div>;
}

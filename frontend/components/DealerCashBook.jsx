'use client';

import { useEffect, useState } from 'react';
import { get, downloadExcel } from '../lib/api';
import { DayBookPreview } from './DayBookPreview';

// Local (IST) date, UTC nahi: raat 12 se subah 5:30 tak toISOString() kal ki date de deta tha.
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today = () => iso(new Date());
const presetRange = (p) => {
  const t = new Date(), f = new Date();
  if (p === '7d') f.setDate(f.getDate() - 6);
  else if (p === '1m') { f.setMonth(f.getMonth() - 1); f.setDate(f.getDate() + 1); }
  else f.setDate(f.getDate() - 1); // 2d: kal + aaj
  return { from: iso(f), to: iso(t) };
};
const money = v => `₹${Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

// Cash / Day Book ledger only. Receipt, expense, handover and customer masters
// are maintained in DealerCashBookExtras.jsx so each workflow has one place.
export function DealerCashBook(){
  const [preset,setPreset]=useState('2d');
  const [from,setFrom]=useState(presetRange('2d').from);
  const [to,setTo]=useState(today());
  const changePreset=p=>{setPreset(p);if(p!=='range'){const r=presetRange(p);setFrom(r.from);setTo(r.to)}};
  const changeRange=(f,t)=>{if(f&&t&&f>t){const x=f;f=t;t=x}if(f)setFrom(f);if(t)setTo(t)};
  const [data,setData]=useState({receipts:[],expenses:[],handovers:[],summary:{}});
  const [error,setError]=useState('');
  const loadBook=async()=>{try{setError('');setData(await get('/dealer/cash-book?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)))}catch(e){setError(e.message||'Could not load Cash Book')}};
  useEffect(()=>{loadBook()},[from,to]);
  const opening=Number(data.summary?.opening_balance||0);
  const closing=Number(data.summary?.closing_balance??(opening+Number(data.summary?.net_movement||0)));
  const exportDayBook=()=>downloadExcel('/dealer/cash-book?from='+from+'&to='+to,'Cash_Day_Book_'+from+(to!==from?'_to_'+to:'')+'.xlsx');
  return <>
    {error&&<div className="error">{error}</div>}
    <style>{`
      .dealerCashSum{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}
      .dealerCashSum .card{padding:14px 16px;border-top:3px solid var(--line)}
      .dealerCashSum .card .metric{font-size:22px;margin-top:4px}
      .dealerCashSum .card small{display:block;margin-top:2px}
      .dealerCashSum .open{border-top-color:#3b82f6}.dealerCashSum .in{border-top-color:#16a36a}.dealerCashSum .out{border-top-color:#8b5cf6}.dealerCashSum .ho{border-top-color:#f59e0b}.dealerCashSum .close{border-top-color:#ef9f27}
      @media(max-width:1100px){.dealerCashSum{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:700px){.dealerCashSum{grid-template-columns:1fr 1fr;gap:8px}.dealerCashSum .card{padding:10px 12px}.dealerCashSum .card .metric{font-size:17px}.dealerCashSum .close{grid-column:1/-1}}
    `}</style>
    <div className="dealerCashSum">
      <div className="card open"><div className="muted">Opening</div><div className="metric">{money(opening)}</div></div>
      <div className="card in"><div className="muted">Cash Received</div><div className="metric">{money(data.summary?.cash_received)}</div></div>
      <div className="card out"><div className="muted">Expenses</div><div className="metric">{money(data.summary?.expenses)}</div></div>
      <div className="card ho"><div className="muted">HO Handover (Accepted)</div><div className="metric">{money(data.summary?.ho_handover)}</div>{Number(data.summary?.pending_handover||0)>0&&<small className="muted">Pending: {money(data.summary?.pending_handover)}</small>}</div>
      <div className="card close"><div className="muted">Closing Cash</div><div className="metric">{money(closing)}</div></div>
    </div>
    <DayBookPreview date={from} dealerLabel="Showroom Branch" hideSummary
      receipts={(data.receipts||[]).filter(r=>r.payment_mode==='cash').map(r=>({id:r.id,no:r.receipt_no,date:r.date,particulars:r.customer_name||'Customer Receipt',folio:r.dealer_register_page_no||'',amount:r.amount}))}
      payments={[...(data.expenses||[]).map(e=>({id:'e'+e.id,no:e.expense_no,date:e.date,particulars:(e.category_label||e.category)+(e.customer_name?' - '+e.customer_name:''),folio:e.folio||'',amount:e.amount})),...(data.handovers||[]).map(h=>({id:'h'+h.id,no:h.handover_no,date:h.date,particulars:h.sent_to||'Head Office',folio:h.folio||'',amount:h.amount}))]}
      openingBalance={opening} closingBalance={closing}
      preset={preset} rangeFrom={from} rangeTo={to} onPresetChange={changePreset} onRangeChange={changeRange}
      onExport={exportDayBook}/>
  </>;
}

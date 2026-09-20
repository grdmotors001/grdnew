'use client';

import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const num = (v) => Number(v || 0);
const today = () => new Date().toISOString().slice(0, 10);
const inRange = (d, from, to) => (!from || !d || d >= from) && (!to || !d || d <= to);

function Line({ label, value, bold = false }) {
  return <div style={{ display:'flex', justifyContent:'space-between', gap:16, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
    <span style={{ fontWeight:bold ? 700 : 400 }}>{label}</span>
    <strong>{money(value)}</strong>
  </div>;
}

function ReportHeader({ title, subtitle, from, setFrom, to, setTo, refresh, loading }) {
  return <div className="pageHeader" style={{alignItems:'flex-end',gap:16,flexWrap:'wrap'}}>
    <div><h1>{title}</h1><p className="muted">{subtitle}</p></div>
    <div className="toolbar" style={{margin:0}}>
      <div className="field"><label>From</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></div>
      <div className="field"><label>To</label><input type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
      <button className="btn" onClick={refresh} disabled={loading}>↻ Refresh</button>
    </div>
  </div>;
}

async function loadAccounts(from, to) {
  const range = `${from ? `from=${from}&` : ''}${to ? `to=${to}&` : ''}`;
  const [sales, purchases, expenses, old] = await Promise.all([
    get(`/reports/sale-register?${range}page=1&per_page=5000`),
    get(`/reports/purchase-register?${range}page=1&per_page=5000`),
    get('/expense-payment-voucher'),
    get('/old-rickshaws'),
  ]);
  const invoices = sales?.invoices || sales?.rows || [];
  const purchaseRows = purchases?.rows || [];
  const expenseRows = expenses?.vouchers || [];
  const oldRows = old?.records || [];
  return { invoices, purchaseRows, expenseRows, oldRows };
}

export function ProfitLossPage() {
  const [from,setFrom]=useState(new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10));
  const [to,setTo]=useState(today());
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);

  const load=async()=>{setLoading(true);setError('');try{setData(await loadAccounts(from,to));}catch(e){setError(e.message||'Could not load accounting data')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);

  const p=useMemo(()=>{
    if(!data)return null;
    const sales=num(data.invoices.reduce((s,x)=>s+num(x.taxable_value ?? x.taxable_amt),0));
    const oldSales=num(data.oldRows.filter(x=>x.status==='sold' && inRange(x.sale_date||x.date,from,to)).reduce((s,x)=>s+num(x.sold_amount||x.sale_amount),0));
    const purchases=num(data.purchaseRows.reduce((s,x)=>s+num(x.taxable_amt),0));
    const expenses=num(data.expenseRows.filter(x=>x.status!=='rejected' && inRange(x.date,from,to)).reduce((s,x)=>s+num(x.amount),0));
    const revenue=sales+oldSales;
    const gross=revenue-purchases;
    return {sales,oldSales,revenue,purchases,gross,expenses,net:gross-expenses};
  },[data,from,to]);

  if(error)return <div className="page"><div className="error">{error}</div></div>;
  if(!p)return <div className="page"><ReportHeader title="Profit & Loss Account" subtitle="Loading accounting data…" from={from} setFrom={setFrom} to={to} refresh={load} loading={loading}/></div>;

  return <div className="page">
    <ReportHeader title="Profit & Loss Account" subtitle="Based on recorded sales, purchases and approved/payment expense vouchers. Opening balances and non-recorded adjustments are excluded." from={from} setFrom={setFrom} to={to} refresh={load} loading={loading}/>
    <div className="formgrid" style={{alignItems:'start'}}>
      <div className="card"><h2>Income / Revenue</h2><Line label="Taxable Tax Invoice Sales" value={p.sales}/><Line label="Old Rickshaw Sales" value={p.oldSales}/><Line label="Total Revenue" value={p.revenue} bold/></div>
      <div className="card"><h2>Cost & Expenses</h2><Line label="Raw Material Purchases" value={p.purchases}/><Line label="Operating / Payment Expenses" value={p.expenses}/><Line label="Total Cost & Expenses" value={p.purchases+p.expenses} bold/></div>
    </div>
    <div className="card" style={{marginTop:14}}>
      <h2>Profit / (Loss)</h2>
      <Line label="Revenue" value={p.revenue}/><Line label="Less: Purchases / Cost" value={p.purchases}/><Line label="Gross Profit" value={p.gross} bold/><Line label="Less: Expenses" value={p.expenses}/><div style={{marginTop:12,padding:14,borderRadius:10,background:'var(--surface-2)',display:'flex',justifyContent:'space-between',fontSize:20}}><b>Net Profit / (Loss)</b><strong>{money(p.net)}</strong></div>
    </div>
  </div>;
}

export function BalanceSheetPage() {
  const [from,setFrom]=useState(new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10));
  const [to,setTo]=useState(today());
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);

  const load=async()=>{setLoading(true);setError('');try{setData(await loadAccounts(from,to));}catch(e){setError(e.message||'Could not load accounting data')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);

  const b=useMemo(()=>{
    if(!data)return null;
    const receivables=num(data.invoices.filter(x=>inRange(x.date,from,to)).reduce((s,x)=>s+Math.max(0,num(x.balance_due ?? (num(x.bill_total)-num(x.amount_received)-num(x.hypothecation_amount)))),0));
    const oldReceivables=num(data.oldRows.filter(x=>x.status==='sold' && inRange(x.sale_date||x.date,from,to)).reduce((s,x)=>s+Math.max(0,num(x.balance_amount ?? (num(x.sold_amount||x.sale_amount)-num(x.receipt_amount)))),0));
    const payables=num(data.purchaseRows.reduce((s,x)=>s+num(x.total_amt),0));
    const inventoryPurchases=num(data.purchaseRows.reduce((s,x)=>s+num(x.total_amt),0));
    const dayBookMemo=0;
    return {receivables:receivables+oldReceivables,payables,inventoryPurchases,dayBookMemo};
  },[data,from,to]);

  if(error)return <div className="page"><div className="error">{error}</div></div>;
  if(!b)return <div className="page"><ReportHeader title="Balance Sheet" subtitle="Loading accounting data…" from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/></div>;

  return <div className="page">
    <ReportHeader title="Balance Sheet" subtitle="Current recorded balances from GRD transaction modules. Opening capital, fixed assets, stock valuation and bank/cash opening balances are not yet configured." from={from} setFrom={setFrom} to={setTo} refresh={load} loading={loading}/>
    <div className="formgrid" style={{alignItems:'start'}}>
      <div className="card"><h2>Assets</h2><Line label="Trade Receivables" value={b.receivables} bold/><div style={{marginTop:14,padding:12,border:'1px dashed var(--border)',borderRadius:10}}><b>Inventory / Fixed Assets</b><div className="muted" style={{marginTop:6}}>Value is not calculated until opening stock/fixed-asset valuation is configured.</div></div></div>
      <div className="card"><h2>Liabilities & Capital</h2><Line label="Trade Payables (recorded purchases)" value={b.payables} bold/><div style={{marginTop:14,padding:12,border:'1px dashed var(--border)',borderRadius:10}}><b>Capital / Opening Balances</b><div className="muted" style={{marginTop:6}}>Opening capital, loans and other liabilities need accounting opening balances before this becomes a statutory balance sheet.</div></div></div>
    </div>
    <div className="card" style={{marginTop:14}}>
      <h2>Accounting Status</h2>
      <div className="formgrid">
        <div><div className="muted">Known Assets</div><strong style={{fontSize:22}}>{money(b.receivables)}</strong></div>
        <div><div className="muted">Known Liabilities</div><strong style={{fontSize:22}}>{money(b.payables)}</strong></div>
      </div>
      <div className="muted" style={{marginTop:14}}>This screen intentionally does not invent missing opening balances. Once opening capital, cash/bank, inventory and fixed assets are added, the report can be expanded into a fully balanced statutory Balance Sheet.</div>
    </div>
  </div>;
}

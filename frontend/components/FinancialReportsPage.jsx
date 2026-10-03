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
  const load=async()=>{setLoading(true);setError('');try{setData(await get(`/reports/profit-loss?from=${from}&to=${to}`));}catch(e){setError(e.message||'Could not load accounting data')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  if(error)return <div className="page"><div className="error">{error}</div></div>;
  if(!data)return <div className="page"><ReportHeader title="Profit & Loss Account" subtitle="Loading accounting data…" from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/></div>;
  const rows=[['Opening Stock',data.opening_stock],['Purchases',data.purchases],['Cost of Goods Sold',data.cost_of_goods_sold],['Direct / Operating Expenses',data.expenses],['Gross Profit',Math.max(0,Number(data.gross_profit||0))],['Net Profit / (Loss)',data.net_profit]];
  return <div className="page"><ReportHeader title="Profit & Loss Account" subtitle="Opening Stock + Purchases − Closing Stock = Cost of Goods Sold; Sales linked from billing." from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/>
    <div className="card" style={{padding:0,overflow:'hidden'}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}><div style={{padding:18,borderRight:'1px solid var(--border)'}}><h3>Debit / Cost Side</h3><Line label="Opening Stock" value={data.opening_stock}/><Line label="Purchases" value={data.purchases}/><Line label="Closing Stock (Less)" value={-Number(data.closing_stock||0)}/><Line label="Cost of Goods Sold" value={data.cost_of_goods_sold} bold/><Line label="Expenses" value={data.expenses} bold/>{(data.expense_heads||[]).map(h=><Line key={h.account_head+'|'+h.sub_category} label={'\u00A0\u00A0'+h.account_head+(h.sub_category&&h.sub_category!=='-'?' ('+h.sub_category+')':'')} value={h.amount}/>)}<Line label="Net Profit / (Loss)" value={data.net_profit} bold/></div><div style={{padding:18}}><h3>Credit / Income Side</h3><Line label="Sales / Billing" value={data.sales}/><Line label="Closing Stock" value={data.closing_stock}/><Line label="Gross Profit" value={Math.max(0,Number(data.gross_profit||0))} bold/></div></div></div>
    <div className="card" style={{marginTop:14}}><h3>Stock Summary</h3>{(data.rows||[]).some(r=>r.rate_source==='Not set'&&num(r.closing_qty)!==0)&&<div className="error" style={{marginBottom:8}}>Kuch products ka stock hai par Purchase Price set nahi hai (Rate Source = "Not set"). Unki value 0 gini ja rahi hai, isliye profit sahi nahi aayega. Masters → Products me Purchase Price bhar do.</div>}<div className="tablewrap"><table className="table"><thead><tr><th>Product</th><th>Sub Group</th><th>Opening Qty</th><th>Closing Qty</th><th>Rate</th><th>Rate Source</th><th>Closing Value</th></tr></thead><tbody>{(data.rows||[]).map(r=><tr key={r.id}><td>{r.name}</td><td>{r.sub_group_name||'Primary'}</td><td>{num(r.opening_qty)}</td><td>{num(r.closing_qty)}</td><td>{money(r.rate)}</td><td style={{color:r.rate_source==='Not set'&&num(r.closing_qty)!==0?'var(--red,#b91c1c)':undefined}}>{r.rate_source||'—'}</td><td>{money(r.closing_value!=null?r.closing_value:num(r.closing_qty)*num(r.rate))}</td></tr>)}</tbody></table></div></div>
  </div>;
}
export function BalanceSheetPage() {
  const [from,setFrom]=useState(new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10));
  const [to,setTo]=useState(today());
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const load=async()=>{setLoading(true);setError('');try{setData(await loadAccounts('',to));}catch(e){setError(e.message||'Could not load accounting data')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const b=useMemo(()=>{if(!data)return null;
    const receivables=num(data.invoices.filter(x=>inRange(x.date,from,to)).reduce((s,x)=>s+Math.max(0,num(x.balance_due ?? (num(x.bill_total)-num(x.amount_received)-num(x.hypothecation_amount)))),0));
    const oldReceivables=num(data.oldRows.filter(x=>x.status==='sold'&&inRange(x.sale_date||x.date,from,to)).reduce((s,x)=>s+Math.max(0,num(x.balance_amount ?? (num(x.sold_amount||x.sale_amount)-num(x.receipt_amount)))),0));
    const payables=num(data.purchaseRows.reduce((s,x)=>s+num(x.total_amt),0)); return {receivables:receivables+oldReceivables,payables};
  },[data,from,to]);
  if(error)return <div className="page"><div className="error">{error}</div></div>;
  if(!b)return <div className="page"><ReportHeader title="Balance Sheet" subtitle="Loading…" from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/></div>;
  return <div className="page">
    <ReportHeader title="Balance Sheet" subtitle="T-format view. Account heads can be mapped later." from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/>
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderBottom:'1px solid var(--border)'}}>
        <div style={{padding:14,textAlign:'center',fontWeight:800,borderRight:'1px solid var(--border)'}}>Liabilities</div>
        <div style={{padding:14,textAlign:'center',fontWeight:800}}>Assets</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}>
        <div style={{padding:18,borderRight:'1px solid var(--border)'}}>
          <Line label="Capital Account (to be mapped)" value={0}/>
          <Line label="Current Liabilities / Payables" value={b.payables}/>
          <Line label="Profit & Loss A/c (to be mapped)" value={0}/>
          <Line label="Total Liabilities (known)" value={b.payables} bold/>
        </div>
        <div style={{padding:18}}>
          <Line label="Fixed Assets (to be mapped)" value={0}/>
          <Line label="Current Assets / Trade Receivables" value={b.receivables}/>
          <Line label="Inventory / Stock (to be mapped)" value={0}/>
          <Line label="Total Assets (known)" value={b.receivables} bold/>
        </div>
      </div>
    </div>
    <div className="card" style={{marginTop:14}}><h2>Accounting Heads</h2><p className="muted">Head mapping intentionally open hai. Baad me decide karenge kaunsa GRD head Capital, Current Liability, Current Asset, Fixed Asset, Stock, etc. me jayega.</p></div>
  </div>;
}


export function AuditReportPage(){
  const [rows,setRows]=useState([]),[filters,setFilters]=useState({user:'',module:'',action:'',record:'',from:'',to:''}),[error,setError]=useState('');
  const load=async()=>{try{const q=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));const d=await get('/audit-report?'+q.toString());setRows(d.rows||[]);setError('')}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[]);
  return <div className="page"><div className="pageHeader"><div><h1>Audit / User Activity</h1><p className="muted">Kis user ne kya create, edit, delete ya approve kiya — old value aur new value ke saath.</p></div><button className="btn" onClick={load}>↻ Refresh</button></div>
    <div className="card"><div className="formgrid">{[['user','User'],['module','Module'],['action','Action'],['record','Record/Reference']].map(([k,l])=><div className="field" key={k}><label>{l}</label><input value={filters[k]} onChange={e=>setFilters({...filters,[k]:e.target.value})}/></div>)}<div className="field"><label>From</label><input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></div><div className="field"><label>To</label><input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></div></div><button className="btn primary" onClick={load}>Apply Filters</button></div>
    {error&&<div className="error">{error}</div>}<div className="tablewrap"><table className="table"><thead><tr><th>Date/Time</th><th>User</th><th>Module</th><th>Action</th><th>Record</th><th>Old Value</th><th>New Value</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleString('en-IN')}</td><td>{r.username||'-'}</td><td>{r.module_key}</td><td>{r.action}</td><td>{r.record_ref||r.record_id||'-'}</td><td><pre style={{maxWidth:260,whiteSpace:'pre-wrap'}}>{r.old_value?JSON.stringify(r.old_value):'-'}</pre></td><td><pre style={{maxWidth:260,whiteSpace:'pre-wrap'}}>{r.new_value?JSON.stringify(r.new_value):'-'}</pre></td></tr>)}</tbody></table></div></div>
}

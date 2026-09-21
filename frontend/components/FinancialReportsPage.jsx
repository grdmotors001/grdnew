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
  if(!p)return <div className="page"><ReportHeader title="Profit & Loss Account" subtitle="Loading accounting data…" from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/></div>;

  return <div className="page">
    <ReportHeader title="Profit & Loss Account" subtitle="T-format view. Account heads can be mapped later." from={from} setFrom={setFrom} to={to} setTo={setTo} refresh={load} loading={loading}/>
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderBottom:'1px solid var(--border)'}}>
        <div style={{padding:14,textAlign:'center',fontWeight:800,borderRight:'1px solid var(--border)'}}>Particulars</div>
        <div style={{padding:14,textAlign:'center',fontWeight:800}}>Particulars</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}>
        <div style={{padding:18,borderRight:'1px solid var(--border)'}}>
          <Line label="Opening / Cost Side (to be mapped)" value={0}/>
          <Line label="Raw Material Purchases" value={p.purchases}/>
          <Line label="Direct / Operating Expenses" value={p.expenses}/>
          <Line label="Gross Profit c/o" value={Math.max(0,p.gross)} bold/>
          <Line label="Total" value={p.purchases+p.expenses+Math.max(0,p.gross)} bold/>
        </div>
        <div style={{padding:18}}>
          <Line label="Sales Accounts" value={p.revenue}/>
          <Line label="Closing Stock / Other Income (to be mapped)" value={0}/>
          <Line label="Gross Loss c/o" value={Math.max(0,-p.gross)} bold/>
          <Line label="Total" value={p.revenue+Math.max(0,-p.gross)} bold/>
        </div>
      </div>
      <div style={{borderTop:'2px solid var(--border)',display:'grid',gridTemplateColumns:'1fr 1fr'}}>
        <div style={{padding:18,borderRight:'1px solid var(--border)'}}><Line label="Indirect Expenses" value={p.expenses}/><Line label="Net Profit / (Loss)" value={p.net} bold/></div>
        <div style={{padding:18}}><Line label="Gross Profit b/f" value={Math.max(0,p.gross)}/><Line label="Indirect Income (to be mapped)" value={0}/></div>
      </div>
    </div>
    <div className="muted" style={{marginTop:10}}>Actual ledger heads are intentionally left unmapped for now; we can decide later where each head appears.</div>
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
  if(!b)return <div className="page"><ReportHeader title="Balance Sheet" subtitle="Loading…" from={from} setFrom={setFrom} to={to} setTo={load} refresh={load} loading={loading}/></div>;
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


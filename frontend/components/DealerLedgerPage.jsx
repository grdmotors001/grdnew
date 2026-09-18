'use client';
import {useEffect,useMemo,useState} from 'react';
import {get} from '../lib/api';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

export function DealerLedgerPage(){
 const [data,setData]=useState({events:[]}),[from,setFrom]=useState(''),[to,setTo]=useState(''),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){
  setLoading(true);setError('');
  try{
   const q=new URLSearchParams(); if(from)q.set('from',from);if(to)q.set('to',to);if(search.trim())q.set('search',search.trim());
   setData(await get('/dealer/ledger?'+q.toString()));
  }catch(e){setError(e.message||'Could not load ledger')}finally{setLoading(false)}
 }
 useEffect(()=>{load()},[from,to]);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return data.events||[];return (data.events||[]).filter(e=>[e.doc_no,e.account,...(e.lines||[])].join(' ').toLowerCase().includes(q))},[data,search]);
 const totals=useMemo(()=>filtered.reduce((a,e)=>({debit:a.debit+Number(e.debit||0),credit:a.credit+Number(e.credit||0)}),{debit:0,credit:0}),[filtered]);
 return <div className="dealerPortal">
  <div className="dealerPortalHeader"><div><h1>My Ledger</h1><div className="muted">Your GRD Motors account statement — sales, receipts and running balance</div></div></div>
  {error&&<div className="error">{error}</div>}
  <div className="grid dealerMetrics">
   <div className="card"><div className="muted">Total Debit</div><div className="metric">{money(totals.debit)}</div></div>
   <div className="card"><div className="muted">Total Credit</div><div className="metric">{money(totals.credit)}</div></div>
   <div className="card"><div className="muted">Net Position</div><div className="metric">{money(Math.abs(totals.debit-totals.credit))} <small>{totals.credit>=totals.debit?'Cr':'Dr'}</small></div></div>
  </div>
  <div className="actions dealerTabs" style={{marginTop:16}}>
   <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/>
   <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
   <input className="input dealerSearch" placeholder="Search bill, chassis, narration…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <button className="btn" onClick={load}>Refresh</button>
  </div>
  <div className="card" style={{marginTop:16}}>
   <h2>Account Statement</h2>
   {loading?<div className="muted">Loading...</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Particulars</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Dr/Cr</th></tr></thead><tbody>
    {filtered.map((e,i)=><tr key={e.record_type+'-'+e.record_id+'-'+i}><td>{e.date}</td><td>{e.vr_type==='S'?'Sale':'Receipt / Payment'}</td><td><b>{e.doc_no||'—'}</b></td><td>{(e.lines||[]).map((x,j)=><div key={j}>{x}</div>)}</td><td>{e.debit?money(e.debit):'—'}</td><td>{e.credit?money(e.credit):'—'}</td><td><b>{money(e.balance)}</b></td><td>{e.dc}</td></tr>)}
    {!filtered.length&&<tr><td colSpan="8" className="muted">No ledger entries for the selected period.</td></tr>}
   </tbody><tfoot><tr><th colSpan="4">Filtered Total</th><th>{money(totals.debit)}</th><th>{money(totals.credit)}</th><th colSpan="2"></th></tr></tfoot></table></div>}
  </div>
 </div>;
}

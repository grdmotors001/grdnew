'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Money } from './ui';

export function CashAtDealerPage(){
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]),[dealerId,setDealerId]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=()=>{setLoading(true);const q=dealerId?'?dealer_id='+dealerId:'';Promise.all([get('/reports/cash-at-dealer'+q),get('/dealers')]).then(([d,m])=>{setData(d);setDealers(m.dealers||[])}).catch(e=>setError(e.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load()},[dealerId]);
  return <div className="page"><div className="pageHeader"><div><h2>Cash at Dealer</h2><p className="muted">Cash received − dealer expenses − cash handed over to Head Office.</p></div><div className="actions"><select className="input" value={dealerId} onChange={e=>setDealerId(e.target.value)}><option value="">All Dealers</option>{dealers.map(d=><option key={d.id} value={d.id}>{d.code?d.code+' — ':''}{d.name}</option>)}</select><button className="btn" onClick={load}>↻ Refresh</button></div></div>
    {error&&<div className="error">{error}</div>}
    <div className="card" style={{marginBottom:14}}><div className="muted">Total Cash at Dealer</div><div style={{fontSize:30,fontWeight:800,marginTop:4}}><Money value={data?.total_cash_at_dealer}/></div></div>
    <div className="card"><div className="tablewrap"><table className="table"><thead><tr><th>Dealer</th><th>Cash Received</th><th>Expenses</th><th>HO Handover</th><th>Cash at Dealer</th></tr></thead><tbody>{(data?.rows||[]).map(r=><tr key={r.dealer_id}><td><b>{r.dealer_code||''}</b> {r.dealer_name}</td><td><Money value={r.cash_received}/></td><td><Money value={r.expenses}/></td><td><Money value={r.ho_handover}/></td><td><b><Money value={r.cash_at_dealer}/></b></td></tr>)}{!loading&&!data?.rows?.length&&<tr><td colSpan="5" className="muted">No dealer cash records found.</td></tr>}</tbody></table></div>{loading&&<div className="muted" style={{padding:16}}>Loading…</div>}</div>
  </div>;
}

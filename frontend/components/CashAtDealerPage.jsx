'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Money } from './ui';

export function CashAtDealerPage(){
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]),[dealerId,setDealerId]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');
  const [bookDealer,setBookDealer]=useState(null);
  const load=()=>{setLoading(true);const q=dealerId?'?dealer_id='+dealerId:'';Promise.all([get('/reports/cash-at-dealer'+q),get('/dealers')]).then(([d,m])=>{setData(d);setDealers(m.dealers||[])}).catch(e=>setError(e.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load()},[dealerId]);
  const q=search.trim().toLowerCase();
  const filteredRows=(data?.rows||[]).filter(r=>!q||String(r.dealer_name||'').toLowerCase().includes(q));
  return <div>
    <div className="dealerContentToolbar">
      <div className="dealerPageIntro"><span className="dealerSectionIcon">₹</span><div><strong>Cash at Dealer</strong><small>Cash received − dealer expenses − cash handed over to Head Office (accepted)</small></div></div>
      <div className="actions"><select className="input" value={dealerId} onChange={e=>setDealerId(e.target.value)}><option value="">All Dealers</option>{dealers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><button className="btn" onClick={load}>↻ Refresh</button></div>
    </div>
    {error&&<div className="error">{error}</div>}
    <div className="card" style={{marginBottom:14}}><div className="muted">Total Cash at Dealer</div><div style={{fontSize:30,fontWeight:800,marginTop:4}}><Money value={data?.total_cash_at_dealer}/></div></div>
    <input className="input" style={{width:'100%',maxWidth:420,margin:'0 0 12px'}} placeholder="Search dealer…" value={search} onChange={e=>setSearch(e.target.value)} />
    <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Dealer</th><th>Cash Received</th><th>Expenses</th><th>HO Handover (Accepted)</th><th>Pending Handover</th><th>Cash at Dealer</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r.dealer_id} onClick={()=>setBookDealer({id:r.dealer_id,name:r.dealer_name})} style={{cursor:'pointer'}} title="Click: Day Book kholein"><td><b>{r.dealer_name}</b></td><td><Money value={r.cash_received}/></td><td><Money value={r.expenses}/></td><td><Money value={r.ho_handover}/></td><td><Money value={r.pending_handover}/></td><td><b><Money value={r.cash_at_dealer}/></b></td></tr>)}{!loading&&!filteredRows.length&&<tr><td colSpan="6" className="dealerEmpty">No dealer cash records found.</td></tr>}</tbody></table></div>
    {loading&&<div className="dealerEmpty">Loading…</div>}
    {bookDealer&&<DealerDayBookModal dealer={bookDealer} onClose={()=>{setBookDealer(null);load()}} />}
  </div>;
}
const fmtDate=d=>{const x=String(d||'').slice(0,10).split('-');return x.length===3?`${x[2]}-${x[1]}-${x[0]}`:(d||'—')};
const iso=d=>d.toISOString().slice(0,10);
const KIND={receipt:'Receipt',expense:'Expense',handover:'HO Handover'};

// Dealer (showroom/branch) ka din-wise Day Book. Har din ke niche Verify - roz ki shop expense/receipt check karke tag lagane ke liye.
function DealerDayBookModal({dealer,onClose}){
  const [from,setFrom]=useState(()=>iso(new Date(Date.now()-30*86400000)));
  const [to,setTo]=useState(()=>iso(new Date()));
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [only,setOnly]=useState('all');
  const load=()=>{setError('');get('/reports/dealer-day-book?dealer_id='+dealer.id+'&from='+from+'&to='+to,{noClientCache:true}).then(setData).catch(e=>setError(e.message))};
  useEffect(()=>{load()},[from,to]);
  const act=async(dates,unverify=false)=>{
    if(busy||!dates.length)return;
    let remarks='';
    if(!unverify&&dates.length===1){const r=window.prompt('Remarks (optional):','');if(r===null)return;remarks=r}
    setBusy(true);setError('');
    try{await post('/dealer-day-book/verify',{dealer_id:dealer.id,dates,unverify,remarks});load()}
    catch(e){setError(e.message||'Verify failed')}finally{setBusy(false)}
  };
  const days=data?.days||[];
  const shown=days.filter(d=>only==='all'||(only==='pending'&&(!d.verified||d.verified.changed)));
  const pendingDates=days.filter(d=>!d.verified||d.verified.changed).map(d=>d.date);
  const sm=data?.summary||{};
  return <div className="modal" onClick={onClose}>
    <div className="modalbox" style={{width:'min(1100px,100%)'}} onClick={e=>e.stopPropagation()}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,flexWrap:'wrap',marginBottom:10}}>
        <div><h2 style={{margin:0}}>{dealer.name}</h2><div className="subtitle">Day Book · {fmtDate(from)} to {fmtDate(to)}</div></div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="toolbar" style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap',marginBottom:10}}>
        <label>From<br/><input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>To<br/><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <select className="input" value={only} onChange={e=>setOnly(e.target.value)}><option value="all">All days</option><option value="pending">Sirf pending / changed</option></select>
        <button type="button" className="btn primary" disabled={busy||!pendingDates.length} onClick={()=>window.confirm(pendingDates.length+' din verify karne hain?')&&act(pendingDates)}>Verify all pending ({pendingDates.length})</button>
      </div>
      {data&&<div className="muted" style={{marginBottom:8}}>{sm.days} din · <b style={{color:'#15803d'}}>{sm.verified} verified</b> · {sm.unverified} pending{sm.changed?<> · <b style={{color:'#b45309'}}>{sm.changed} verify ke baad badle</b></>:null}</div>}
      {error&&<div className="error">{error}</div>}
      {!data&&!error&&<div className="card">Loading…</div>}
      {data&&!shown.length&&<div className="dealerEmpty">{days.length?'Koi pending din nahi.':'Is period me koi entry nahi.'}</div>}
      {shown.map(d=>{
        const v=d.verified,changed=v&&v.changed,ok=v&&!v.changed;
        return <div key={d.date} className="card" style={{marginBottom:12,padding:12,borderLeft:'4px solid '+(ok?'#16a34a':changed?'#d97706':'#cbd5e1')}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:6}}>
            <div><b style={{fontSize:15}}>{fmtDate(d.date)}</b> <span className="muted">· Opening <Money value={d.opening}/></span></div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              {ok&&<span className="pill t" title={v.remarks||''}>✓ Verified · {v.by} · {new Date(v.at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>}
              {changed&&<span className="pill d">⚠ Verify ke baad entry badli ({v.by})</span>}
              {!v&&<span className="pill m">Pending</span>}
              {(!v||changed)&&<button type="button" className="btn primary" disabled={busy} onClick={()=>act([d.date])}>{changed?'Re-verify':'Verify'}</button>}
              {v&&<button type="button" className="btn" disabled={busy} onClick={()=>window.confirm('Verify hata dein?')&&act([d.date],true)}>Undo</button>}
            </div>
          </div>
          {v&&v.remarks&&<div className="muted" style={{marginBottom:6}}>Remarks: {v.remarks}</div>}
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Type</th><th>No.</th><th>Party / Customer</th><th>Details</th><th>Status</th><th style={{textAlign:'right'}}>Receipt (IN)</th><th style={{textAlign:'right'}}>Payment (OUT)</th></tr></thead>
            <tbody>{d.entries.map((e,i)=>{
              const isIn=e.kind==='receipt',out=e.kind!=='receipt';
              const note=e.kind==='receipt'?(e.in_cash?'':String(e.mode||'').toUpperCase()+' (cash nahi)'):e.kind==='handover'?(e.status==='accepted'?'Accepted':e.status==='rejected'?'Rejected':'Pending'):'';
              return <tr key={e.kind+e.id+i} style={e.in_cash?undefined:{opacity:.6}}>
                <td>{KIND[e.kind]}</td><td>{e.no||'—'}</td><td>{e.party||'—'}</td><td>{e.detail||'—'}</td><td>{note||'—'}</td>
                <td style={{textAlign:'right'}}>{isIn?<Money value={e.amount}/>:''}</td>
                <td style={{textAlign:'right'}}>{out?<Money value={e.amount}/>:''}</td>
              </tr>})}</tbody>
            <tfoot><tr><td colSpan="5"><b>Day total</b></td><td style={{textAlign:'right'}}><b><Money value={d.cash_in}/></b></td><td style={{textAlign:'right'}}><b><Money value={d.expenses+d.ho_out}/></b></td></tr>
              <tr><td colSpan="5"><b>Closing cash</b></td><td colSpan="2" style={{textAlign:'right'}}><b><Money value={d.closing}/></b></td></tr></tfoot>
          </table></div>
        </div>})}
    </div>
  </div>;
}


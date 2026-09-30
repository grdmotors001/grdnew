'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner } from './ui';
import { formatDate } from '../lib/date';

export function NotificationPage(){
  const [data,setData]=useState(null),[error,setError]=useState(''),[limits,setLimits]=useState({});
  const load=()=>get('/notifications').then(d=>{setData(d);const m={};(d.branch_cash_limits||[]).forEach(x=>{m[x.dealer_id]=x.limit});setLimits(m)}).catch(e=>setError(e.message));
  useEffect(()=>{load()},[]);
  const markRead=async id=>{try{await post('/notifications/read',{id});await load()}catch(e){setError(e.message)}};
  const saveLimit=async dealer_id=>{try{await post('/notifications/cash-limit',{dealer_id:Number(dealer_id),cash_limit:Number(limits[dealer_id])});await load()}catch(e){setError(e.message)}};
  return <div className="page">
    <div className="card"><h2>Notifications</h2><p className="muted">Battery change/fit alerts aur Branch cash-limit alerts yahan aayenge.</p><ErrorBanner message={error}/>
      {!data ? <div>Loading…</div> : !data.notifications?.length ? <div className="muted">No unread notifications.</div> :
      <div style={{display:'grid',gap:10}}>{data.notifications.map((n,i)=><div key={n.virtual?n.id:(n.id||i)} style={{border:'1px solid var(--border)',borderRadius:10,padding:12}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12}}><b>{n.title}</b><span className="muted">{n.created_at?formatDate(n.created_at):''}</span></div>
        <div style={{marginTop:5}}>{n.message}</div>
        {!n.virtual && <button className="btn" style={{marginTop:8}} onClick={()=>markRead(n.id)}>Mark Read</button>}
      </div>)}</div>}
    </div>
    <div className="card"><h2>Branch Cash Limit</h2><p className="muted">Limit cross hote hi Branch cash notification dikhega.</p>
      {(data?.branch_cash_limits||[]).map(d=><div key={d.dealer_id} className="actions" style={{marginBottom:8}}>
        <span style={{minWidth:220,fontWeight:600}}>{d.dealer_name}</span>
        <input className="input" type="number" value={limits[d.dealer_id]??d.limit} onChange={e=>setLimits({...limits,[d.dealer_id]:e.target.value})} style={{maxWidth:180}}/>
        <button className="btn primary" onClick={()=>saveLimit(d.dealer_id)}>Save Limit</button>
      </div>)}
    </div>
  </div>;
}

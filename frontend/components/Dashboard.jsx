'use client';

import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { EmptyState, Money, Pill } from './ui';
import { formatDate } from '../lib/date';
import { Factory, Truck, Receipt, Users, Wallet, ClipboardList } from 'lucide-react';

const Card = ({label,value,sub,onClick,icon:Icon}) => {
  const body=<><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><span className="muted">{label}</span>{Icon&&<Icon size={19}/>}</div><div className="metric" style={{marginTop:6}}>{value}</div>{sub&&<div className="muted" style={{marginTop:4}}>{sub}</div>}</>;
  return onClick?<button className="card" style={{textAlign:'left',cursor:'pointer'}} onClick={onClick}>{body}</button>:<div className="card">{body}</div>;
};

export function Dashboard({ setActive }) {
  const [d,setD]=useState(null);
  const [error,setError]=useState('');

  const load=()=>get('/dashboard').then(setD).catch(e=>setError(e.message||'Could not load dashboard'));
  useEffect(()=>{load();},[]);

  if(error)return <div className="error">{error}</div>;
  if(!d)return <div className="card">Loading dashboard…</div>;

  const receivable=Math.max(0,Number(d.sales_total||0)-Number(d.loan_total||0)-Number(d.received_total||0));
  const recent=[
    ...(d.manufacturing||[]).map(v=>({...v,_stage:'Manufacturing'})),
    ...(d.delivery_challan||[]).map(v=>({...v,_stage:'Delivery Challan'})),
    ...(d.tax_invoice||[]).map(v=>({...v,_stage:'Tax Invoice'})),
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));

  return <>
    <div className="pageHeader">
      <div><h2 style={{marginBottom:3}}>Dashboard</h2><p className="muted">G.R.D. Motors — current business overview</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>

    <div className="grid" style={{marginTop:12}}>
      <Card label="Total Vehicles" value={Number(d.total_vehicles||0).toLocaleString('en-IN')} sub="All vehicle stages" icon={Factory} />
      <Card label="Manufacturing" value={Number(d.counts?.manufacturing||0).toLocaleString('en-IN')} sub="Currently in factory" icon={Factory} onClick={()=>setActive('production-voucher')} />
      <Card label="Delivery Challan" value={Number(d.counts?.delivery_challan||0).toLocaleString('en-IN')} sub={Number(d.pending_challans||0)+' pending for billing'} icon={Truck} onClick={()=>setActive('delivery-challan')} />
      <Card label="Tax Invoice" value={Number(d.counts?.tax_invoice||0).toLocaleString('en-IN')} sub="Billed vehicles" icon={Receipt} onClick={()=>setActive('tax-invoice')} />
      <Card label="Dealers" value={Number(d.dealers||0).toLocaleString('en-IN')} sub="Active dealer accounts" icon={Users} onClick={()=>setActive('dealer')} />
      <Card label="Receivable" value={<Money value={receivable}/>} sub="Sale − loan − received" icon={Wallet} onClick={()=>setActive('payment-receivable-report')} />
    </div>

    <div className="grid" style={{marginTop:14}}>
      <div className="card"><span className="muted">Sales Value</span><div className="metric"><Money value={d.sales_total}/></div></div>
      <div className="card"><span className="muted">Loan / Hypothecation</span><div className="metric"><Money value={d.loan_total}/></div></div>
      <div className="card"><span className="muted">Amount Received</span><div className="metric"><Money value={d.received_total}/></div></div>
      <div className="card"><span className="muted">Production This Month</span><div className="metric">{Number(d.production_this_month||0).toLocaleString('en-IN')}</div></div>
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Recent Vehicle Activity</h3><p className="muted">Latest 100 vehicle records from the existing database.</p></div><button className="btn" onClick={()=>setActive('delivery-challan-register')}>Open Registers</button></div>
      {!recent.length?<EmptyState text="No vehicle records found."/>:<div className="tablewrap"><table className="table">
        <thead><tr><th>Date</th><th>Chassis No.</th><th>Model</th><th>Motor No.</th><th>Dealer</th><th>Stage</th></tr></thead>
        <tbody>{recent.slice(0,35).map(v=><tr key={String(v.id)+'-'+v._stage}><td>{formatDate(v.date)}</td><td><b>{v.chassis_no||'—'}</b></td><td>{v.model_name||'—'}</td><td>{v.motor_no||'—'}</td><td>{v.dealer_name||'—'}</td><td><Pill text={v._stage} kind={v._stage==='Manufacturing'?'m':v._stage==='Delivery Challan'?'d':'t'}/></td></tr>)}</tbody>
      </table></div>}
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Quick Access</h3><p className="muted">Open the modules used most often.</p></div></div>
      <div className="actions">
        <button className="btn" onClick={()=>setActive('production-voucher')}>+ Production Voucher</button>
        <button className="btn" onClick={()=>setActive('delivery-challan')}>+ Delivery Challan</button>
        <button className="btn" onClick={()=>setActive('tax-invoice')}>+ Tax Invoice</button>
        <button className="btn" onClick={()=>setActive('payment-receivable-report')}><ClipboardList size={15}/> Payment Receivable</button>
      </div>
    </div>
  </>;
}

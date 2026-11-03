'use client';

import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { EmptyState } from './ui';
import { MonthlyTrendChart } from './MonthlyTrendChart';
import { formatDate } from '../lib/date';
import { Factory, Truck, Receipt, Users, ClipboardList, UserCheck, UserX } from 'lucide-react';

const maxBy = (rows, key) => Math.max(1, ...(rows || []).map(r => Number(r[key] || 0)));
const monthLabel = (m) => {
  const d = new Date(String(m || '') + '-01T00:00:00');
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

const Card = ({label,value,sub,onClick,icon:Icon}) => {
  const body=<><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><span className="muted">{label}</span>{Icon&&<Icon size={19}/>}</div><div className="metric" style={{marginTop:6}}>{value}</div>{sub&&<div className="muted" style={{marginTop:4}}>{sub}</div>}</>;
  return onClick?<button className="card" style={{textAlign:'left',cursor:'pointer',color:'var(--ink)',font:'inherit'}} onClick={onClick}>{body}</button>:<div className="card">{body}</div>;
};

export function Dashboard({ setActive }) {
  const [d,setD]=useState(null);
  const [error,setError]=useState('');
  const [hr,setHr]=useState(null);

  // Employee / absent count (HR data). Fail ho to dashboard na tute, bas cards '—' dikhayenge.
  const loadHr=()=>{
    const day=istToday();
    return Promise.all([get('/hr/employees'),get('/hr/attendance?month='+day.slice(0,7))]).then(([e,a])=>{
      const emps=(e.employees||[]).filter(x=>x.active!==false);
      const presentIds=new Set((a.attendance||[]).filter(r=>String(r.work_date||'').slice(0,10)===day&&(r.status==='Present'||r.status==='Half Day')).map(r=>String(r.employee_id)));
      setHr({total:emps.length,present:emps.filter(x=>presentIds.has(String(x.id))).length,absent:emps.filter(x=>!presentIds.has(String(x.id))).length});
    }).catch(()=>setHr({total:null,present:null,absent:null}));
  };
  const load=()=>{loadHr();return get('/dashboard').then(setD).catch(e=>setError(e.message||'Could not load dashboard'));};
  useEffect(()=>{load();},[]);

  if(error)return <div className="error">{error}</div>;
  if(!d)return <div className="card">Loading dashboard…</div>;

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
      <Card label="Today Challan" value={Number(d.today_challans?.length||0).toLocaleString('en-IN')} sub="Today's delivery challans" icon={Truck} onClick={()=>setActive('delivery-challan')} />
      <Card label="Today Bill" value={Number(d.today_bills?.length||0).toLocaleString('en-IN')} sub="Today's tax invoices" icon={Receipt} onClick={()=>setActive('tax-invoice')} />
      <Card label="Today Production" value={Number((d.today_production||[]).reduce((s,r)=>s+Number(r.quantity||0),0)).toLocaleString('en-IN')} sub="Vehicles produced today" icon={Factory} onClick={()=>setActive('production-voucher')} />
      <Card label="Dealers" value={Number(d.dealers||0).toLocaleString('en-IN')} sub="Active dealer accounts" icon={Users} onClick={()=>setActive('dealer')} />
    </div>

    <div className="grid" style={{marginTop:14}}>
      <Card label="Total Employees" value={hr?.total==null?'—':Number(hr.total).toLocaleString('en-IN')} sub="Active employees" icon={Users} onClick={()=>setActive('hr-attendance')} />
      <Card label="Present Today" value={hr?.present==null?'—':Number(hr.present).toLocaleString('en-IN')} sub="Aaj punch kiya" icon={UserCheck} onClick={()=>setActive('hr-attendance')} />
      <Card label="Absent Today" value={hr?.absent==null?'—':Number(hr.absent).toLocaleString('en-IN')} sub="Aaj koi punch nahi" icon={UserX} onClick={()=>setActive('hr-attendance')} />
    </div>

    <div className="grid" style={{marginTop:14}}>
      <Card label="Total Vehicles" value={Number(d.total_vehicles||0).toLocaleString('en-IN')} sub="All vehicle stages" icon={Factory} />
      <Card label="Manufacturing" value={Number(d.counts?.manufacturing||0).toLocaleString('en-IN')} sub="Currently in factory" icon={Factory} onClick={()=>setActive('production-voucher')} />
      <Card label="Delivery Challan" value={Number(d.counts?.delivery_challan||0).toLocaleString('en-IN')} sub={Number(d.pending_challans||0)+' pending for billing'} icon={Truck} onClick={()=>setActive('delivery-challan')} />
      <Card label="Tax Invoice" value={Number(d.counts?.tax_invoice||0).toLocaleString('en-IN')} sub="Billed vehicles" icon={Receipt} onClick={()=>setActive('tax-invoice')} />
    </div>

    <div className="grid" style={{marginTop:14, gridTemplateColumns:'minmax(0,2fr) minmax(320px,1fr)'}}>
      <div className="card">
        <div className="pageHeader"><div><h3 style={{margin:0}}>1 Year Sales &amp; Manufacturing Graph</h3><p className="muted">Monthly billed sales value and vehicles manufactured — last 12 months</p></div></div>
        {(() => {
          const sales = d.billed_monthly || [], mfg = d.manufacturing_monthly || [];
          const months = Array.from(new Set([...sales.map(r => r.month), ...mfg.map(r => r.month)])).sort();
          const sMap = Object.fromEntries(sales.map(r => [r.month, Number(r.taxable || 0)]));
          const mMap = Object.fromEntries(mfg.map(r => [r.month, Number(r.quantity || 0)]));
          const sMax = Math.max(1, ...months.map(m => sMap[m] || 0)), mMax = Math.max(1, ...months.map(m => mMap[m] || 0));
          const SALE = 'var(--theme-accent)', MFG = '#f59e0b';
          const bar = (v, max, color, title) => <div title={title} style={{width:'38%',height:(v/max*175)+'px',minHeight:v?4:1,borderRadius:'6px 6px 2px 2px',background:color}} />;
          return <>
            <div style={{display:'flex',gap:16,fontSize:12,marginTop:8}}>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:SALE,marginRight:6}} />Sales (₹)</span>
              <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:MFG,marginRight:6}} />Manufacturing (vehicles)</span>
            </div>
            <div style={{display:'flex',alignItems:'flex-end',gap:8,height:230,padding:'16px 4px 4px',overflowX:'auto'}}>
              {months.map(m => <div key={m} style={{minWidth:52,flex:1,height:'100%',display:'flex',flexDirection:'column',justifyContent:'flex-end',alignItems:'center',gap:6}}>
                <div style={{width:'100%',display:'flex',alignItems:'flex-end',justifyContent:'center',gap:3}}>
                  {bar(sMap[m] || 0, sMax, SALE, monthLabel(m) + ' • Sales ₹' + (sMap[m] || 0).toLocaleString('en-IN'))}
                  {bar(mMap[m] || 0, mMax, MFG, monthLabel(m) + ' • Manufacturing ' + (mMap[m] || 0).toLocaleString('en-IN'))}
                </div>
                <span className="muted" style={{fontSize:10,whiteSpace:'nowrap'}}>{monthLabel(m)}</span>
              </div>)}
              {!months.length && <EmptyState text="No sales data found."/>}
            </div>
          </>;
        })()}
      </div>

      <div className="card">
        <h3 style={{margin:0}}>State-wise Sale</h3>
        <p className="muted">Last 12 months, billed sales value</p>
        <div className="tablewrap">
          <table className="table" style={{minWidth:0}}>
            <thead><tr><th>State</th><th>Bills</th><th>Sale</th></tr></thead>
            <tbody>{(d.state_sales || []).map(r => <tr key={r.state}><td><b>{r.state}</b></td><td>{Number(r.billed||0)}</td><td>₹{Number(r.taxable||0).toLocaleString('en-IN')}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>

    <MonthlyTrendChart />

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

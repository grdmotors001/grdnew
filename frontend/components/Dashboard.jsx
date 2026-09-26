'use client';

import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { EmptyState, Money, Pill } from './ui';
import { formatDate } from '../lib/date';
import { Factory, Truck, Receipt, Users, Wallet, ClipboardList } from 'lucide-react';

const maxBy = (rows, key) => Math.max(1, ...(rows || []).map(r => Number(r[key] || 0)));
const monthLabel = (m) => {
  const d = new Date(String(m || '') + '-01T00:00:00');
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

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

    <div className="grid" style={{marginTop:14, gridTemplateColumns:'minmax(0,2fr) minmax(320px,1fr)'}}>
      <div className="card">
        <div className="pageHeader"><div><h3 style={{margin:0}}>1 Year Sales Graph</h3><p className="muted">Monthly billed sales value — last 12 months</p></div></div>
        {(() => {
          const rows = d.billed_monthly || [];
          const max = maxBy(rows, 'taxable');
          return <div style={{display:'flex',alignItems:'flex-end',gap:8,height:230,padding:'16px 4px 4px',overflowX:'auto'}}>
            {rows.map(r => <div key={r.month} title={monthLabel(r.month)+' • ₹'+Number(r.taxable||0).toLocaleString('en-IN')} style={{minWidth:42,flex:1,height:'100%',display:'flex',flexDirection:'column',justifyContent:'flex-end',alignItems:'center',gap:6}}>
              <div style={{width:'70%',height:(Number(r.taxable||0)/max*175)+'px',minHeight:Number(r.taxable||0)?4:1,borderRadius:'6px 6px 2px 2px',background:'var(--accent)'}} />
              <span className="muted" style={{fontSize:10,whiteSpace:'nowrap'}}>{monthLabel(r.month)}</span>
            </div>)}
            {!rows.length && <EmptyState text="No sales data found."/>}
          </div>;
        })()}
      </div>

      <div className="card">
        <h3 style={{margin:0}}>State-wise Sale</h3>
        <p className="muted">Last 12 months, billed sales value</p>
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>State</th><th>Bills</th><th>Sale</th></tr></thead>
            <tbody>{(d.state_sales || []).map(r => <tr key={r.state}><td><b>{r.state}</b></td><td>{Number(r.billed||0)}</td><td>₹{Number(r.taxable||0).toLocaleString('en-IN')}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Monthly Delivery / Billed</h3><p className="muted">Last 12 months</p></div></div>
      {(() => {
        const rows = d.monthly || [];
        const max = Math.max(1, ...(rows || []).flatMap(r => [Number(r.delivery_challan||0), Number(r.tax_invoice||0)]));
        return <div style={{display:'grid',gap:10}}>
          {rows.map(r => <div key={r.month} style={{display:'grid',gridTemplateColumns:'70px 1fr 70px',alignItems:'center',gap:10}}>
            <span className="muted">{monthLabel(r.month)}</span>
            <div>
              <div style={{height:9,borderRadius:8,background:'var(--border)',overflow:'hidden',marginBottom:5}}>
                <div style={{height:'100%',width:(Number(r.delivery_challan||0)/max*100)+'%',background:'var(--accent)',borderRadius:8}} />
              </div>
              <div style={{height:9,borderRadius:8,background:'var(--border)',overflow:'hidden'}}>
                <div style={{height:'100%',width:(Number(r.tax_invoice||0)/max*100)+'%',background:'var(--success,#16a34a)',borderRadius:8}} />
              </div>
            </div>
            <span style={{fontSize:11}}>{Number(r.delivery_challan||0)} DC / {Number(r.tax_invoice||0)} Bill</span>
          </div>)}
          {!rows.length && <EmptyState text="No monthly data found."/>}
        </div>;
      })()}
      <div className="muted" style={{fontSize:11,marginTop:10}}>Top bar = Delivery Challan, bottom bar = Tax Invoice billed.</div>
    </div>

    <div className="grid" style={{marginTop:14}}>
      <Card label="Today Challan" value={Number(d.today_challans?.length||0).toLocaleString('en-IN')} sub="Today's delivery challans" icon={Truck} onClick={()=>setActive('delivery-challan')} />
      <Card label="Today Bill" value={Number(d.today_bills?.length||0).toLocaleString('en-IN')} sub="Today's tax invoices" icon={Receipt} onClick={()=>setActive('tax-invoice')} />
      <Card label="Today Production" value={Number((d.today_production||[]).reduce((s,r)=>s+Number(r.quantity||0),0)).toLocaleString('en-IN')} sub="Vehicles produced today" icon={Factory} onClick={()=>setActive('production-voucher')} />
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Today Production</h3><p className="muted">Model name and quantity.</p></div></div>
      {!d.today_production?.length?<EmptyState text="No production today."/>:<div className="tablewrap"><table className="table">
        <thead><tr><th>Date</th><th>Model Name</th><th>Qty</th></tr></thead>
        <tbody>{d.today_production.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td><b>{r.model_name||'—'}</b></td><td>{Number(r.quantity||0).toLocaleString('en-IN')}</td></tr>)}</tbody>
      </table></div>}
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Today Delivery Challan</h3><p className="muted">Model, dealer, chassis and battery.</p></div></div>
      {!d.today_challans?.length?<EmptyState text="No challan today."/>:<div className="tablewrap"><table className="table">
        <thead><tr><th>Model</th><th>Dealer</th><th>Chassis</th><th>Battery Name</th></tr></thead>
        <tbody>{d.today_challans.map(r=><tr key={r.id}><td><b>{r.model_name||'—'}</b></td><td>{r.dealer_name||'—'}</td><td>{r.chassis_no||'—'}</td><td>{r.battery_name||'—'}</td></tr>)}</tbody>
      </table></div>}
    </div>

    <div className="card" style={{marginTop:14}}>
      <div className="pageHeader"><div><h3 style={{margin:0}}>Today Bills</h3><p className="muted">Dealer, financer, chassis and battery.</p></div></div>
      {!d.today_bills?.length?<EmptyState text="No bill today."/>:<div className="tablewrap"><table className="table">
        <thead><tr><th>Bill No.</th><th>Dealer</th><th>Financer</th><th>Chassis</th><th>Battery Name</th></tr></thead>
        <tbody>{d.today_bills.map(r=><tr key={r.id}><td><b>{r.bill_no||'—'}</b></td><td>{r.dealer_name||'—'}</td><td>{r.financer_name||'—'}</td><td>{r.chassis_no||'—'}</td><td>{r.battery_name||'—'}</td></tr>)}</tbody>
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

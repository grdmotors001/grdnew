'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { ErrorBanner, Field, EmptyState } from './ui';
import { formatDate } from '../lib/date';

const today=()=>new Date().toISOString().slice(0,10);

export function OldRickshawInventoryPage(){
  const [data,setData]=useState({rows:[],summary:{all:0,hold:0,available:0,sold:0},dealers:[]});
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState('');
  const [saleRow,setSaleRow]=useState(null),[sale,setSale]=useState({});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');

  const load=async()=>{
    try{
      setError('');
      const r=await get('/inventory/old-rickshaw?status='+encodeURIComponent(filter)+'&search='+encodeURIComponent(search));
      setData(r);
    }catch(e){setError(e.message||'Could not load Old Rickshaw Inventory.')}
  };
  useEffect(()=>{load()},[filter]);
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[search]);

  const makeAvailable=async(id)=>{
    if(!confirm('Vehicle ko Available for Sale karna hai? Iske baad Old Rickshaw Challan automatically generate hoga.'))return;
    setBusy(true);setError('');
    try{await post('/inventory/old-rickshaw/'+id+'/available',{});await load()}catch(e){setError(e.message||'Could not release vehicle.') }finally{setBusy(false)}
  };

  const openSale=(r)=>{
    setSaleRow(r);
    setSale({
      sale_date:r.date||today(),dealer_id:r.dealer_id||'',dealer_name:r.dealer_name||'',
      sp_no:r.sp_no||'',challan_no:r.challan_no||'',customer_name:r.customer_name||'',
      sale_amount:r.sale_amount||'',loan_amount:r.loan_amount||'0',
      balance_amount:r.balance_amount||'',file_charge:r.file_charge||'',
      do_number:r.do_number||'',ledger_no:r.ledger_no||''
    });
  };
  const setSaleField=(k,v)=>setSale(x=>({...x,[k]:v}));
  useEffect(()=>{
    const s=Number(sale.sale_amount||0),l=Number(sale.loan_amount||0);
    setSale(x=>({...x,balance_amount:Math.max(0,s-l)}));
  },[sale.sale_amount,sale.loan_amount]);

  const saveSale=async(e)=>{
    e.preventDefault();setBusy(true);setError('');
    try{await post('/inventory/old-rickshaw/'+saleRow.id+'/sale',sale);setSaleRow(null);await load()}catch(e){setError(e.message||'Could not create Old Rickshaw sale.')}finally{setBusy(false)}
  };

  const rows=data.rows||[];
  return <div className="page">
    <div className="card" style={{marginBottom:12}}>
      <div className="actions" style={{justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
        <div><h2 style={{margin:'0 0 4px'}}>Old Rickshaw Inventory</h2><div className="muted">CHFPL Repo / Seized Old Rickshaw — Hold, Available for Sale aur Sold stock.</div></div>
        <input className="input" style={{maxWidth:260}} placeholder="Search vehicle / battery / dealer…" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      <div className="actions" style={{marginTop:12,flexWrap:'wrap'}}>
        {[
          ['all','All',data.summary?.all||0],['unsold','Unsold',(Number(data.summary?.hold||0)+Number(data.summary?.available||0))],
          ['available','Available for Sale',data.summary?.available||0],['sold','Sold',data.summary?.sold||0]
        ].map(([k,l,n])=><button key={k} className={'btn '+(filter===k?'primary':'')} onClick={()=>setFilter(k)}>{l} {n}</button>)}
      </div>
    </div>
    <ErrorBanner message={error}/>
    {!rows.length?<EmptyState text="No Old Rickshaw found."/>:
    <div className="card"><div className="tablewrap"><table className="table">
      <thead><tr>
        <th>Status</th><th>Vehicle No.</th><th>Battery Make</th><th>Dealer / Parked At</th><th>Repo Date</th><th>SP No.</th><th>Challan No.</th><th>Date</th><th>Action</th>
      </tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}>
        <td><b>{String(r.status||'hold').toUpperCase()}</b></td>
        <td><b>{r.vehicle_no||r.vehicle_reg_no||'—'}</b></td>
        <td>{r.battery_maker||'—'}</td>
        <td>{r.dealer_name||'GRD Factory'}</td>
        <td>{r.repo_date?formatDate(r.repo_date):'—'}</td>
        <td>{r.sp_no||'—'}</td><td>{r.challan_no||'—'}</td>
        <td>{r.challan_date?formatDate(r.challan_date):r.date?formatDate(r.date):'—'}</td>
        <td style={{whiteSpace:'nowrap'}}>
          {r.status==='hold' && <button className="btn primary" disabled={busy} onClick={()=>makeAvailable(r.id)}>Available for Sale</button>}
          {r.status==='available' && <button className="btn primary" disabled={busy} onClick={()=>openSale(r)}>Create Sale</button>}
          {r.status==='sold' && <span className="muted">{r.customer_name||'Sold'}</span>}
        </td>
      </tr>)}</tbody>
    </table></div></div>}

    {saleRow&&<div className="modal"><form className="modalbox" onSubmit={saveSale}>
      <h2>Create Old Rickshaw Sale</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="SP No." value={sale.sp_no||'—'} readOnly/>
        <Field label="Challan No." value={sale.challan_no||'—'} readOnly/>
        <Field label="Date" type="date" value={sale.sale_date} readOnly/>
        <Field label="Dealer" value={sale.dealer_name||'—'} readOnly/>
        <Field label="Vehicle No." value={saleRow.vehicle_no||saleRow.vehicle_reg_no||'—'} readOnly/>
        <Field label="Battery Make" value={saleRow.battery_maker||'—'} readOnly/>
        <Field label="Customer Name" value={sale.customer_name} onChange={v=>setSaleField('customer_name',v)} required/>
        <Field label="Sale Amount" type="number" value={sale.sale_amount} onChange={v=>setSaleField('sale_amount',v)} required/>
        <Field label="Loan Amount" type="number" value={sale.loan_amount} onChange={v=>setSaleField('loan_amount',v)}/>
        <Field label="Balance" type="number" value={sale.balance_amount} readOnly/>
        <Field label="File Charge" type="number" value={sale.file_charge} onChange={v=>setSaleField('file_charge',v)}/>
        <Field label="DO No." value={sale.do_number} onChange={v=>setSaleField('do_number',v)}/>
        <Field label="Ledger No." value={sale.ledger_no} onChange={v=>setSaleField('ledger_no',v)}/>
      </div>
      <div className="actions" style={{marginTop:18,justifyContent:'flex-end'}}>
        <button type="button" className="btn" onClick={()=>setSaleRow(null)}>Cancel</button>
        <button className="btn primary" disabled={busy||!sale.customer_name||Number(sale.loan_amount||0)>Number(sale.sale_amount||0)}>{busy?'Saving…':'Create Sale'}</button>
      </div>
    </form></div>}
  </div>;
}

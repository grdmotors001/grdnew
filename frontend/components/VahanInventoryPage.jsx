'use client';
import { useEffect, useState } from 'react';
import { get, downloadBlob } from '../lib/api';
import { Field, ErrorBanner } from './ui';

export function VahanInventoryPage(){
  const [inventory,setInventory]=useState([]);
  const [selected,setSelected]=useState(new Set());
  const [fromDate,setFromDate]=useState('');
  const [toDate,setToDate]=useState('');
  const [name,setName]=useState('');
  const [search,setSearch]=useState('');
  const [showroom,setShowroom]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  const load=async()=>{
    setLoading(true); setError('');
    try{
      const p=new URLSearchParams();
      if(fromDate)p.set('from_date',fromDate);
      if(toDate)p.set('to_date',toDate);
      if(name)p.set('name',name);
      if(search)p.set('search',search);
      if(showroom)p.set('showroom',showroom);
      const r=await get('/billing/vehicle-inventory?'+p.toString());
      setInventory(r.vehicles||[]);
      setSelected(new Set());
    }catch(e){setError(e.message||'Could not load Vahan Inventory')}
    finally{setLoading(false)}
  };

  useEffect(()=>{load()},[]);

  const toggle=id=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n});
  const all=inventory.length>0&&selected.size===inventory.length;
  const toggleAll=()=>setSelected(all?new Set():new Set(inventory.map(x=>x.id)));
  const clear=()=>{setFromDate('');setToDate('');setName('');setSearch('');setShowroom('');setTimeout(load,0)};
  const downloadTxt=async()=>{
    if(!selected.size){setError('Select at least one vehicle.');return}
    try{
      await downloadBlob('/billing/vehicle-inventory/download-txt',{invoice_ids:[...selected]},'VahanInventoryTXT.TXT');
    }catch(e){setError(e.message||'Could not download TXT')}
  };

  return <div className="page">
    <div className="pageHeader">
      <div><h2>Vahan Inventory</h2><p className="muted">Tax Invoice vehicles ka Vahan TXT inventory register.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <div className="card" style={{marginBottom:14}}>
      <div className="toolbar">
        <Field label="From Date" type="date" value={fromDate} onChange={setFromDate}/>
        <Field label="To Date" type="date" value={toDate} onChange={setToDate}/>
        <Field label="Showroom / Dealer" value={showroom} onChange={setShowroom} placeholder="Showroom / Dealer"/><Field label="Name Filter" value={name} onChange={setName} placeholder="Customer / Model"/>
        <Field label="Search Chassis / Motor / UMRN" value={search} onChange={setSearch} placeholder="Search…"/>
        <div className="actions" style={{alignSelf:'end'}}>
          <button className="btn primary" onClick={load}>Search</button>
          <button className="btn" onClick={clear}>Clear</button>
          <button className="btn" disabled={!selected.size} onClick={downloadTxt}>Download Text File ({selected.size})</button>
        </div>
      </div>
    </div>
    <div className="card">
      <div className="tablewrap"><table className="table"><thead><tr>
        <th><input type="checkbox" checked={all} onChange={toggleAll}/></th>
        <th>Date</th><th>Showroom / Dealer</th><th>Customer</th><th>Model</th><th>Chassis No.</th><th>Motor No.</th><th>UMRN</th><th>Manufacturing</th><th>Colour Code</th>
      </tr></thead><tbody>
      {inventory.map(r=><tr key={r.id}>
        <td><input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggle(r.id)}/></td>
        <td>{r.date||'—'}</td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}</td><td>{r.model_name||'—'}</td><td><b>{r.chassis_no||'—'}</b></td><td>{r.motor_no||'—'}</td><td>{r.umrn||'—'}</td><td>{r.manufacturing_month||'—'}</td><td>{r.colour_code||'—'}</td>
      </tr>)}
      {!loading&&!inventory.length&&<tr><td colSpan="10" className="muted">No vehicle records found.</td></tr>}
      {loading&&<tr><td colSpan="9" className="muted">Loading…</td></tr>}
      </tbody></table></div>
    </div>
  </div>
}

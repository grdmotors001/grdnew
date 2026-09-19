'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Money } from './ui';

export function DealerPendingSalesPage(){
  const [data,setData]=useState(null),[open,setOpen]=useState(null),[form,setForm]=useState({dealer_description:'',vehicle_id:'',sale_amount:''}),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const load=()=>get('/dealer/pending-sales').then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load()},[]);
  const start=r=>{setOpen(r);setForm({dealer_description:r.dealer_description||'',vehicle_id:r.billing_vehicle_id?String(r.billing_vehicle_id):'',sale_amount:r.billing_sale_amount||''});setError('');};
  const save=async e=>{e.preventDefault();if(!open)return;setSaving(true);setError('');try{await post('/dealer/pending-sales/'+open.id,{...form,vehicle_id:Number(form.vehicle_id)});setOpen(null);load()}catch(e){setError(e.message)}finally{setSaving(false)}};
  const vehicles=data?.vehicles||[];
  return <div>
    <div className="dealerContentToolbar"><div className="dealerPageIntro"><span className="dealerSectionIcon">▤</span><div><strong>Pending Sales</strong><small>CHFPL approved loans — prepare sale details for GRD Billing</small></div></div><button className="btn" onClick={load}>↻ Refresh</button></div>
    {error&&<div className="error">{error}</div>}
    <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Application</th><th>Customer</th><th>DO No.</th><th>Status</th><th>Chassis</th><th>Sale Amount</th><th>Description</th><th></th></tr></thead><tbody>
      {(data?.applications||[]).map(r=><tr key={r.id}><td><b>{r.application_no}</b></td><td>{r.customer_name}</td><td>{r.do_no||'—'}</td><td>{r.billing_status||'Not Requested'}</td><td>{r.billing_chassis_no||'—'}</td><td><Money value={r.billing_sale_amount}/></td><td>{r.dealer_description||'—'}</td><td>{r.billing_status==='NOT_REQUESTED'?<button className="btn primary" onClick={()=>start(r)}>Make Pending Sale</button>:<span className="muted">Sent to Billing</span>}</td></tr>)}
      {!data?.applications?.length&&<tr><td colSpan="8"><div className="dealerEmpty">No approved loan pending for sale.</div></td></tr>}
    </tbody></table></div>
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}><h2>Pending Sale — {open.application_no}</h2><p className="muted">{open.dealer_name} · {open.customer_name}</p>
      <div className="formgrid"><div className="field"><label>Delivery Challan / Rickshaw</label><select className="input" value={form.vehicle_id} onChange={e=>setForm({...form,vehicle_id:e.target.value})} required><option value="">Select</option>{vehicles.map(v=><option key={v.challan_id} value={v.challan_id}>{v.challan_no} — {v.chassis_no} — {v.model_name}</option>)}</select></div>
      <div className="field"><label>Sale Amount</label><input className="input" type="number" value={form.sale_amount} onChange={e=>setForm({...form,sale_amount:e.target.value})} min="0"/></div>
      <div className="field" style={{gridColumn:'1 / -1'}}><label>Dealer Description</label><textarea className="input" rows="4" value={form.dealer_description} onChange={e=>setForm({...form,dealer_description:e.target.value})} placeholder="Customer / sale description…" required/></div></div>
      <div className="actions" style={{marginTop:16}}><button type="button" className="btn" onClick={()=>setOpen(null)}>Cancel</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Send to Billing'}</button></div>
    </form></div>}
  </div>;
}

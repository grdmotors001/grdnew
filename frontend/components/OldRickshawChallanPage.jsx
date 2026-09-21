'use client';
import { useEffect,useState } from 'react';
import { get,post } from '../lib/api';
import { Field,ErrorBanner,EmptyState } from './ui';

export function OldRickshawChallanPage(){
 const [rows,setRows]=useState([]),[dealers,setDealers]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[form,setForm]=useState({date:new Date().toISOString().slice(0,10),challan_no:'',model_name:'',vehicle_no:'',colour:'',toolkit:'',dealer_id:'',source:'manual',source_ref:''});
 const load=async()=>{try{const [r,d]=await Promise.all([get('/factory/old-rickshaw-challans'),get('/dealers')]);setRows(r.challans||[]);setDealers(d.dealers||[]);if(!form.challan_no)setForm(x=>({...x,challan_no:r.suggested_challan_no||''}))}catch(e){setError(e.message)}};
 useEffect(()=>{load()},[]);
 const save=async e=>{e.preventDefault();try{await post('/factory/old-rickshaw-challans',form);setOpen(false);setForm({date:new Date().toISOString().slice(0,10),challan_no:'',model_name:'',vehicle_no:'',colour:'',toolkit:'',dealer_id:'',source:'manual',source_ref:''});await load()}catch(e){setError(e.message)}};
 return <div className="page"><div className="pageHeader"><div><h2>Old Rickshaw Challan Voucher</h2><p className="muted">CHFPL seized / old rickshaw ko GRD resale stock me lane ke liye factory challan.</p></div><button className="btn primary" onClick={()=>setOpen(true)}>+ New Old Rickshaw Challan</button></div><ErrorBanner message={!open?error:''}/>
 <div className="card"><div className="tablewrap"><table className="table"><thead><tr><th>Challan No.</th><th>Date</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Toolkit</th><th>Dealer</th><th>Source</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.challan_no}</b></td><td>{r.date}</td><td>{r.model_name||'—'}</td><td>{r.vehicle_no||'—'}</td><td>{r.colour||'—'}</td><td>{r.toolkit||'—'}</td><td>{r.dealer_name||'—'}</td><td>{r.source}</td><td>{r.status}</td></tr>)}{!rows.length&&<tr><td colSpan="9"><EmptyState text="No Old Rickshaw challans." /></td></tr>}</tbody></table></div></div>
 {open&&<div className="modal"><form className="modalbox" onSubmit={save}><h2>New Old Rickshaw Challan</h2><ErrorBanner message={error}/><div className="formgrid">
 <Field label="Challan No." value={form.challan_no} onChange={v=>setForm({...form,challan_no:v})} required/>
 <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})} required/>
 <Field label="Model" value={form.model_name} onChange={v=>setForm({...form,model_name:v})} required/>
 <Field label="Vehicle No." value={form.vehicle_no} onChange={v=>setForm({...form,vehicle_no:v})} required/>
 <Field label="Colour" value={form.colour} onChange={v=>setForm({...form,colour:v})}/>
 <Field label="Tool Kit" value={form.toolkit} onChange={v=>setForm({...form,toolkit:v})}/>
 <Field label="Dealer / Sale To" type="select" value={form.dealer_id} options={[{value:'',label:'Select Dealer'},...dealers.map(d=>({value:d.id,label:(d.code?d.code+' — ':'')+d.name}))]} onChange={v=>setForm({...form,dealer_id:v})}/>
 <Field label="Source" type="select" value={form.source} options={[{value:'manual',label:'Manual'},{value:'chfpl',label:'CHFPL Seized'}]} onChange={v=>setForm({...form,source:v})}/>
 <Field label="CHFPL Reference" value={form.source_ref} onChange={v=>setForm({...form,source_ref:v})}/>
 </div><div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary">Create Challan</button></div></form></div>}
 </div>
}

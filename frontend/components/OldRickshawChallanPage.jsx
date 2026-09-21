'use client';
import { useEffect,useState } from 'react';
import { get,post } from '../lib/api';
import { Field,ErrorBanner,EmptyState } from './ui';

export function OldRickshawChallanPage(){
 const [rows,setRows]=useState([]),[available,setAvailable]=useState([]),[dealers,setDealers]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[form,setForm]=useState({date:new Date().toISOString().slice(0,10),challan_no:'',model_name:'',vehicle_no:'',colour:'',toolkit:'',dealer_id:'',source:'manual',source_ref:''});
 const load=async()=>{try{const [r,d]=await Promise.all([get('/factory/old-rickshaw-challans'),get('/dealers')]);setRows(r.challans||[]);setAvailable(r.available_for_sale||[]);setDealers(d.dealers||[]);if(!form.challan_no)setForm(x=>({...x,challan_no:r.suggested_challan_no||''}))}catch(e){setError(e.message)}};
 useEffect(()=>{load()},[]);
 const save=async e=>{e.preventDefault();try{await post('/factory/old-rickshaw-challans',form);setOpen(false);setForm({date:new Date().toISOString().slice(0,10),challan_no:'',model_name:'',vehicle_no:'',colour:'',toolkit:'',dealer_id:'',source:'manual',source_ref:''});await load()}catch(e){setError(e.message)}};
 return <div className="page grdOldFormPage">
 <style>{`
  .grdOldFormPage{padding:12px}
  .grdOldFormPage .pageHeader{background:#fff;border:1px solid #e4e9ef;border-radius:14px;padding:15px 16px;margin-bottom:12px;box-shadow:0 5px 18px rgba(31,55,79,.05)}
  .grdOldFormPage .pageHeader h2{margin:0;color:#172b45;font-size:18px}
  .grdOldFormPage .pageHeader p{margin:4px 0 0;font-size:11px;color:#748297}
  .grdOldFormPage>.card{background:#fff;border:1px solid #e4e9ef;border-radius:14px;box-shadow:0 5px 18px rgba(31,55,79,.05);overflow:hidden;margin-bottom:12px}
  .grdOldFormPage .tablewrap{overflow:auto}
  .grdOldFormPage .table{width:100%;border-collapse:collapse;font-size:11px}
  .grdOldFormPage .table th{background:#f6f8fb;color:#65758a;font-size:9px;text-transform:uppercase;letter-spacing:.3px;text-align:left;padding:8px;border-bottom:1px solid #e2e8ef}
  .grdOldFormPage .table td{padding:8px;border-bottom:1px solid #edf1f5;color:#33475b}
  .grdOldFormPage .btn{border:1px solid #d8e0e8;border-radius:8px;background:#fff;color:#33475b;padding:8px 13px;font-size:11px;font-weight:700;cursor:pointer}
  .grdOldFormPage .btn.primary{border-color:#246fe8;background:#246fe8;color:#fff}
  .grdOldFormPage .modal{position:fixed;inset:0;background:rgba(16,32,52,.42);display:grid;place-items:center;padding:14px;z-index:100}
  .grdOldFormPage .modalbox{width:min(720px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.22)}
  .grdOldFormPage .modalbox h2{margin:0 0 14px;color:#172b45;font-size:18px}
  .grdOldFormPage .formgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
  .grdOldFormPage .formgrid>*{min-width:0}
  .grdOldFormPage .formgrid label{font-size:11px;font-weight:700;color:#566a80}
  .grdOldFormPage .formgrid input,.grdOldFormPage .formgrid select{width:100%;box-sizing:border-box;min-height:40px;border:1px solid #d7e0e9;border-radius:8px;padding:9px 11px;font-size:12px;background:#fff}
  .grdOldFormPage .formgrid input:focus,.grdOldFormPage .formgrid select:focus{outline:none;border-color:#2d79df;box-shadow:0 0 0 2px rgba(45,121,223,.10)}
  @media(max-width:700px){.grdOldFormPage{padding:0}.grdOldFormPage .pageHeader{border-radius:0 0 12px 12px;padding:13px;margin-bottom:10px}.grdOldFormPage .pageHeader h2{font-size:15px}.grdOldFormPage .formgrid{grid-template-columns:1fr;gap:10px}.grdOldFormPage>.card{border-radius:12px}.grdOldFormPage .table{min-width:620px}.grdOldFormPage .modalbox{padding:15px;border-radius:13px}.grdOldFormPage .btn{font-size:10px;padding:7px 11px}}
 `}</style><div className="pageHeader"><div><h2>Old Rickshaw Challan Voucher</h2><p className="muted">CHFPL seized / old rickshaw ko GRD resale stock me lane ke liye factory challan.</p></div><button className="btn primary" onClick={()=>setOpen(true)}>+ New Old Rickshaw Challan</button></div><ErrorBanner message={!open?error:''}/>
 {available.length>0&&<div className="card" style={{marginBottom:14}}><div className="pageHeader"><div><h3>CHFPL — Available for Sale</h3><p className="muted">CHFPL ne release kiye hue seized vehicles. Challan banne tak ye GRD stock me transfer nahi honge.</p></div><span className="pill t">{available.length} Pending</span></div><div className="tablewrap"><table className="table"><thead><tr><th>Repo Date</th><th>Loan</th><th>Vehicle</th><th>Model</th><th>Colour</th><th>Parked At</th><th>Action</th></tr></thead><tbody>{available.map(v=>{const loan=v.loan_applications||{};const parked=v.dealer_master||{};return <tr key={v.id}><td>{v.repo_date||'—'}</td><td>{loan.loan_account_no||loan.application_no||'—'}</td><td><b>{v.vehicle_no||'—'}</b></td><td>{v.model_name||loan.grd_model_name||'—'}</td><td>{v.colour||'—'}</td><td>{parked.dealer_name||'GRD Factory'}</td><td><button className="btn primary" onClick={()=>{setForm({date:new Date().toISOString().slice(0,10),challan_no:'',model_name:v.model_name||loan.grd_model_name||'',vehicle_no:v.vehicle_no||'',colour:v.colour||'',toolkit:v.toolkit||'',dealer_id:'',source:'chfpl',source_ref:String(v.id)});const pn=parked.dealer_name?.trim().toLowerCase();const d=dealers.find(x=>(x.name||'').trim().toLowerCase()===pn);setForm(x=>({...x,dealer_id:d?d.id:''}));setOpen(true)}}>Create Challan</button></td></tr>})}</tbody></table></div></div>}<div className="card"><div className="tablewrap"><table className="table"><thead><tr><th>Challan No.</th><th>Date</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Toolkit</th><th>Dealer</th><th>Source</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.challan_no}</b></td><td>{r.date}</td><td>{r.model_name||'—'}</td><td>{r.vehicle_no||'—'}</td><td>{r.colour||'—'}</td><td>{r.toolkit||'—'}</td><td>{r.dealer_name||'GRD Factory'}</td><td>{r.source}</td><td>{r.status}</td></tr>)}{!rows.length&&<tr><td colSpan="9"><EmptyState text="No Old Rickshaw challans." /></td></tr>}</tbody></table></div></div>
 {open&&<div className="modal"><form className="modalbox" onSubmit={save}><h2>New Old Rickshaw Challan</h2><ErrorBanner message={error}/><div className="formgrid">
 <Field label="Challan No." value={form.challan_no} onChange={v=>setForm({...form,challan_no:v})} required/>
 <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})} required/>
 <Field label="Model" value={form.model_name} onChange={v=>setForm({...form,model_name:v})} required/>
 <Field label="Vehicle No." value={form.vehicle_no} onChange={v=>setForm({...form,vehicle_no:v})} required/>
 <Field label="Colour" value={form.colour} onChange={v=>setForm({...form,colour:v})}/>
 <Field label="Tool Kit" value={form.toolkit} onChange={v=>setForm({...form,toolkit:v})}/>
 <Field label="Parked / Sale To" type="select" value={form.dealer_id} options={[{value:'',label:'GRD Factory'},...dealers.map(d=>({value:d.id,label:(d.code?d.code+' — ':'')+d.name}))]} onChange={v=>setForm({...form,dealer_id:v})}/>
 <Field label="Source" type="select" value={form.source} options={[{value:'manual',label:'Manual'},{value:'chfpl',label:'CHFPL Seized'}]} onChange={v=>setForm({...form,source:v})}/>
 <Field label="CHFPL Reference" value={form.source_ref} onChange={v=>setForm({...form,source_ref:v})}/>
 <div className="muted" style={{gridColumn:'1/-1'}}>Dealer is prefilled from the existing parked location. Select <b>GRD Factory</b> if the vehicle is moved to factory before the challan is made.</div>
 </div><div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary">Create Challan</button></div></form></div>}
 </div>
}

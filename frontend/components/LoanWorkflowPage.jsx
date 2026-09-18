'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';

export function LoanWorkflowPage() {
  const [apps,setApps]=useState([]),[fes,setFes]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState(null),[fe,setFe]=useState(''),[remark,setRemark]=useState('');
  const [photos,setPhotos]=useState([]);

  const load=async()=>{setBusy(true);setError('');try{const [a,f]=await Promise.all([get('/loan-workflow'),get('/loan-workflow/field-executives')]);setApps(a.applications||[]);setFes(f.field_executives||[]);}catch(e){setError(e.message)}finally{setBusy(false)}};
  useEffect(()=>{load()},[]);

  const userDept=typeof window!=='undefined' ? '' : '';
  const pending=useMemo(()=>apps.filter(a=>a.status!=='DO_EXPIRED'),[apps]);

  const assign=async()=>{if(!selected||!fe)return;try{await post('/loan-workflow/'+selected.id+'/assign-fe',{fe_user_id:Number(fe)});setSelected(null);setFe('');await load()}catch(e){setError(e.message)}};
  const feSubmit=async()=>{if(!selected||!photos.length||!remark.trim())return;try{await post('/loan-workflow/'+selected.id+'/fe-submit',{live_photos:photos.map(p=>({name:p.name,type:p.type,size:p.size,data_url:p.data_url})),remark});setSelected(null);setRemark('');setPhotos([]);await load()}catch(e){setError(e.message)}};
  const decide=async(decision)=>{if(!selected||!remark.trim())return;try{await post('/loan-workflow/'+selected.id+'/decision',{decision,remark});setSelected(null);setRemark('');await load()}catch(e){setError(e.message)}};
  const addPhotos=async(files)=>Promise.all(Array.from(files).map(f=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:f.name,type:f.type,size:f.size,data_url:r.result});r.onerror=reject;r.readAsDataURL(f)}))).then(setPhotos).catch(e=>setError(e.message));

  return <div className="page">
    <div className="pageHeader"><div><h2>Loan Applications</h2><p className="muted">DO → FE → DO verification workflow</p></div><button className="btn" onClick={load} disabled={busy}>↻ Refresh</button></div>
    {error&&<div className="error">{error}</div>}
    <div className="card" style={{marginBottom:16}}>
      <div className="tableWrap"><table><thead><tr><th>Application</th><th>Dealer</th><th>Customer</th><th>Status</th><th>DO Validity</th><th>Action</th></tr></thead>
      <tbody>{pending.map(a=><tr key={a.id}><td><strong>{a.application_no}</strong></td><td>{a.dealer_name}</td><td>{a.customer_name}</td><td><span className="badge">{a.status.replaceAll('_',' ')}</span></td><td>{a.do_expiry_at?new Date(a.do_expiry_at).toLocaleDateString('en-IN'):'—'}</td><td><button className="btn small" onClick={()=>{setSelected(a);setRemark('');setFe(a.fe_user_id||'');setPhotos([])}}>Open</button></td></tr>)}</tbody></table></div>
      {!pending.length&&<div className="empty">No loan applications found.</div>}
    </div>

    {selected&&<div className="modal"><div className="modalbox" style={{maxWidth:760}}>
      <div className="pageHeader"><div><h2>{selected.application_no}</h2><p className="muted">{selected.dealer_name} · {selected.customer_name}</p></div><button className="btn" onClick={()=>setSelected(null)}>Close</button></div>
      {selected.status==='DO_PENDING'&&<><h3>Assign Field Executive</h3><div className="formgrid"><label>Field Executive<select className="input" value={fe} onChange={e=>setFe(e.target.value)}><option value="">Select FE</option>{fes.map(x=><option key={x.id} value={x.id}>{x.username}</option>)}</select></label></div><div className="actions"><button className="btn primary" onClick={assign} disabled={!fe}>Assign FE</button></div></>}
      {selected.status==='FE_ASSIGNED'&&<><h3>FE Verification</h3><p>Assigned FE: <strong>{fes.find(x=>x.id===selected.fe_user_id)?.username||'FE'}</strong></p><label>Live Photos *<input className="input" type="file" accept="image/*" capture="environment" multiple onChange={e=>addPhotos(e.target.files)}/></label>{photos.length>0&&<p className="muted">{photos.length} photo(s) selected</p>}<label>FE Remark *<textarea className="input" rows="3" value={remark} onChange={e=>setRemark(e.target.value)}/></label><div className="actions"><button className="btn primary" onClick={feSubmit} disabled={!photos.length||!remark.trim()}>Submit Verification</button></div></>}
      {selected.status==='FE_SUBMITTED'&&<><h3>DO Decision</h3><p>FE Remark: {selected.fe_remark||'—'}</p><label>DO Remark *<textarea className="input" rows="3" value={remark} onChange={e=>setRemark(e.target.value)} placeholder="Decision remark"/></label><div className="actions"><button className="btn" onClick={()=>decide('HOLD')} disabled={!remark.trim()}>Hold</button><button className="btn danger" onClick={()=>decide('REJECT')} disabled={!remark.trim()}>Reject</button><button className="btn primary" onClick={()=>decide('APPROVE')} disabled={!remark.trim()}>Approve</button></div></>}
      {(selected.status==='DO_APPROVED'||selected.status==='DO_HOLD'||selected.status==='DO_REJECTED'||selected.status==='DO_EXPIRED')&&<><h3>Application Status</h3><p>{selected.status.replaceAll('_',' ')}</p>{selected.do_remark&&<p className="muted">DO Remark: {selected.do_remark}</p>}{selected.do_expiry_at&&<p className="muted">Valid until: {new Date(selected.do_expiry_at).toLocaleString('en-IN')}</p>}</>}
    </div></div>}
  </div>;
}

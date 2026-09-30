 'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {get,post,put,del} from '../lib/api';
import {Field,ErrorBanner,Money,EmptyState} from './ui';

const today=()=>new Date().toISOString().slice(0,10);
const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

export function InsuranceRtoRegisterPage(){
  const [tab,setTab]=useState('NEW');
  const [rows,setRows]=useState([]),[insurers,setInsurers]=useState([]),[summaryRows,setSummaryRows]=useState([]),[editId,setEditId]=useState(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[importing,setImporting]=useState(false);
  const [error,setError]=useState(''),[msg,setMsg]=useState(''),[search,setSearch]=useState('');
  const [status,setStatus]=useState('all'),[open,setOpen]=useState(false);
  const fileRef=useRef(null);
  const empty=()=>({date:today(),customer_name:'',total_premium:'',discount_rate:'',net_premium:'',payable_amount:'',insurer:'',chassis_no:'',bill_no:'',sp_no:'',vehicle:'',remarks:''});
  const [form,setForm]=useState(empty());

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({type:tab});
      if(search.trim())q.set('search',search.trim());
      if(status!=='all')q.set('status',status);
      const x=await get('/insurance-register?'+q);
      setRows(x.rows||[]);setInsurers(x.insurers||[]);setSummaryRows(x.insurer_summary||[]);
    }catch(e){setError(e.message||'Could not load insurance register')}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[tab,status]);
  useEffect(()=>{const t=setTimeout(load,300);return()=>clearTimeout(t)},[search]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const calc=(f)=>{
    const total=Number(f.total_premium||0),disc=Number(f.discount_rate||0);
    const net=f.net_premium!==''&&f.net_premium!=null?Number(f.net_premium):total*(1-disc/100);
    const payable=f.payable_amount!==''&&f.payable_amount!=null?Number(f.payable_amount):net;
    return {net,payable};
  };
  const onTotal=v=>{
    const f={...form,total_premium:v,net_premium:'',payable_amount:''};
    const c=calc(f);setForm({...f,net_premium:c.net.toFixed(2),payable_amount:c.payable.toFixed(2)});
  };
  const onDiscount=v=>{
    const f={...form,discount_rate:v,net_premium:'',payable_amount:''};
    const c=calc(f);setForm({...f,net_premium:c.net.toFixed(2),payable_amount:c.payable.toFixed(2)});
  };

  async function save(e){
    e.preventDefault();setSaving(true);setError('');setMsg('');
    try{
      const c=calc(form);
      if(!form.customer_name.trim())throw new Error('Customer Name required.');
      if(!form.insurer.trim())throw new Error('Insurer required.');
      if(Number(form.total_premium)<0)throw new Error('Invalid premium.');
      if(tab==='NEW' && !String(form.chassis_no||'').trim())throw new Error('New Insurance me Chassis No. required hai. Bill No. optional hai.');
      if(tab==='OLD' && !String(form.sp_no||form.vehicle).trim())throw new Error('Old Insurance me SP No. ya Vehicle required hai.');
      const payload={...form,insurance_type:tab,net_premium:c.net,payable_amount:c.payable};
      if(editId)await put('/insurance-register/'+editId,payload);else await post('/insurance-register',payload);
      setOpen(false);setForm(empty());setEditId(null);setMsg(editId?'Insurance record updated.':'Insurance record saved.');await load();
    }catch(e){setError(e.message||'Could not save insurance')}finally{setSaving(false)}
  }

  async function doImport(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setImporting(true);setError('');setMsg('');
    try{
      const XLSX=await import('xlsx');
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});
      if(!data.length)throw new Error('Import file is empty.');
      const r=await post('/insurance-register/import',{insurance_type:tab,rows:data});
      setMsg(`${r.inserted||0} imported, ${r.duplicates||0} duplicate skipped, ${r.rejected_count||0} rejected. ${tab==='NEW'?`${r.mapped||0} already mapped to billing.`:''}`+((r.rejected||[]).length?' Rejected rows: '+r.rejected.slice(0,10).map(x=>`row ${x.row} (${x.reason})`).join('; '):''));
      await load();
    }catch(e){setError(e.message||'Could not import file')}finally{setImporting(false)}
  }

  function startEdit(r){setEditId(r.id);setForm({date:String(r.date||'').slice(0,10),customer_name:r.customer_name||'',total_premium:r.total_premium,discount_rate:r.discount_rate,net_premium:r.net_premium,payable_amount:r.payable_amount,insurer:r.insurer||'',chassis_no:r.chassis_no||'',bill_no:r.bill_no||'',sp_no:r.sp_no||'',vehicle:r.vehicle||'',remarks:r.remarks||''});setOpen(true)}
  async function removeRow(r){if(!confirm('Delete this insurance record?'))return;try{await del('/insurance-register/'+r.id);setMsg('Record deleted.');await load()}catch(e){setError(e.message||'Delete failed')}}

  const summary=useMemo(()=>rows.reduce((a,r)=>{
    a.count++;a.total+=Number(r.total_premium||0);a.net+=Number(r.net_premium||0);a.payable+=Number(r.payable_amount||0);
    if(r.mapping_status==='BILLED'||r.mapping_status==='TAGGED')a.billed++;else a.unbilled++;
    return a
  },{count:0,billed:0,unbilled:0,total:0,net:0,payable:0}),[rows]);

  return <div className="page">
    <div className="pageHeader">
      <div><h1>Insurance Register</h1><p className="muted">New and Old insurance records, billing mapping and insurer payment tracking</p></div>
      <div className="actions">
        <button className="btn" onClick={()=>fileRef.current?.click()} disabled={importing}>{importing?'Importing…':'Import Excel / CSV'}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
        <button className="btn primary" onClick={()=>{setEditId(null);setForm(empty());setOpen(true)}}>+ Add Insurance</button>
      </div>
    </div>
    <ErrorBanner message={error}/>{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <div className="card" style={{marginBottom:12}}>
      <div className="actions">
        <button className={'btn '+(tab==='NEW'?'primary':'')} onClick={()=>setTab('NEW')}>New Insurance</button>
        <button className={'btn '+(tab==='OLD'?'primary':'')} onClick={()=>setTab('OLD')}>Old Insurance</button>
        <input className="input" placeholder="Search customer / chassis / bill / SP / insurer" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:360}}/>
        <select className="input" value={status} onChange={e=>setStatus(e.target.value)} style={{maxWidth:180}}>
          <option value="all">All</option><option value="billed">{tab==='NEW'?'Billed / Mapped':'Tagged to Old Rickshaw'}</option><option value="unbilled">{tab==='NEW'?'Unbilled':'Not Tagged'}</option>
        </select>
      </div>
      <div className="actions" style={{marginTop:10,flexWrap:'wrap'}}>
        <span>Total Records: <b>{summary.count}</b></span>
        <span>{tab==='NEW'?'Billed':'Tagged'}: <b>{summary.billed}</b></span><span>{tab==='NEW'?'Unbilled':'Not Tagged'}: <b>{summary.unbilled}</b></span>
        <span>Total Premium: <b>{money(summary.total)}</b></span><span>Net Premium: <b>{money(summary.net)}</b></span><span>Payable: <b>{money(summary.payable)}</b></span>
      </div>
    </div>
    {summaryRows.length>0&&<div className="card" style={{marginBottom:12}}><b>Insurer On-Account Ledger</b> <span className="muted">(payments are on account; not tied to individual records)</span>
      <div className="tablewrap"><table className="table"><thead><tr><th>Insurer</th><th>Records</th><th>New Payable</th><th>Old Payable</th><th>Total Payable</th><th>Paid (Expense Vouchers)</th><th>Balance</th></tr></thead>
      <tbody>{summaryRows.map(x=><tr key={x.insurer}><td><b>{x.insurer}</b></td><td>{x.records}</td><td>{money(x.new_payable)}</td><td>{money(x.old_payable)}</td><td>{money(x.payable)}</td><td>{money(x.paid)}</td><td><b style={{color:x.balance>0?'#b45309':'#15803d'}}>{money(x.balance)}{x.balance<0?' (Advance)':''}</b></td></tr>)}</tbody></table></div></div>}
    {loading?<div className="card">Loading…</div>:!rows.length?<EmptyState text="No insurance records found."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th><th>Customer</th><th>Total Premium</th><th>Net Premium</th><th>Discount %</th><th>Payable</th><th>Insurer</th>
        {tab==='NEW'?<><th>Chassis No.</th><th>Bill No.</th><th>Billing</th></>:<><th>SP No.</th><th>Vehicle</th><th>Old Rickshaw Tag</th></>}
        <th>Payment</th><th>Action</th>
      </tr></thead><tbody>{rows.map(r=><tr key={r.id}>
        <td>{r.date?String(r.date).slice(0,10):'—'}</td><td><b>{r.customer_name||'—'}</b></td>
        <td>{money(r.total_premium)}</td><td>{money(r.net_premium)}</td><td>{Number(r.discount_rate||0)}%</td><td><b>{money(r.payable_amount)}</b></td>
        <td>{r.insurer||'—'}</td>
        {tab==='NEW'?<><td>{r.chassis_no||'—'}</td><td>{r.bill_no||'—'}</td><td>{r.mapping_status==='BILLED'?'Billed':'Unbilled'}</td></>:<><td>{r.sp_no||'—'}</td><td>{r.vehicle||'—'}</td><td>{r.mapping_status==='TAGGED'?'Tagged':'Not tagged'}</td></>}
        <td>On Account</td><td><button className="btn" onClick={()=>startEdit(r)}>Edit</button> <button className="btn" onClick={()=>removeRow(r)}>Delete</button></td>
      </tr>)}</tbody></table></div>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{editId?'Edit ':''}{tab==='NEW'?'New Insurance':'Old Insurance'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v=>set('date',v)} required/>
        <Field label="Customer Name" value={form.customer_name} onChange={v=>set('customer_name',v)} required/>
        <Field label="Total Premium" type="number" value={form.total_premium} onChange={onTotal} required/>
        <Field label="Discount Rate %" type="number" value={form.discount_rate} onChange={onDiscount}/>
        <Field label="Net Premium" type="number" value={form.net_premium} onChange={v=>set('net_premium',v)}/>
        <Field label="Payable Amount" type="number" value={form.payable_amount} onChange={v=>set('payable_amount',v)}/>
        <Field label="Insurer (jis se karwaya)" value={form.insurer} onChange={v=>set('insurer',v)} required/>
        {tab==='NEW'?<><Field label="Chassis No." value={form.chassis_no} onChange={v=>set('chassis_no',v)}/><Field label="Bill No." value={form.bill_no} onChange={v=>set('bill_no',v)}/></>:<><Field label="SP No." value={form.sp_no} onChange={v=>set('sp_no',v)}/><Field label="Vehicle" value={form.vehicle} onChange={v=>set('vehicle',v)}/></>}
        <Field label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)}/>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button type="button" className="btn" onClick={()=>{setOpen(false);setEditId(null)}}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Insurance'}</button></div>
    </form></div>}
  </div>
}

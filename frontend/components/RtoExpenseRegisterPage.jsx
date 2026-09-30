'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {get,post,put,del} from '../lib/api';
import {Field,ErrorBanner,EmptyState} from './ui';

const today=()=>new Date().toISOString().slice(0,10);
const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

// RTO Expense Register: outside expense (agent / passing person). Never shown on invoice; Registration Fee on invoice is separate.
export function RtoExpenseRegisterPage(){
  const [tab,setTab]=useState('NEW');
  const [rows,setRows]=useState([]),[agents,setAgents]=useState([]),[summaryRows,setSummaryRows]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[importing,setImporting]=useState(false);
  const [error,setError]=useState(''),[msg,setMsg]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('all');
  const [open,setOpen]=useState(false),[editId,setEditId]=useState(null);
  const fileRef=useRef(null);
  const empty=()=>({date:today(),customer_name:'',amount:'',work_type:'',rto_agent:'',chassis_no:'',bill_no:'',sp_no:'',vehicle:'',remarks:''});
  const [form,setForm]=useState(empty());
  const set=(k,v)=>setForm(x=>({...x,[k]:v}));

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({type:tab});
      if(search.trim())q.set('search',search.trim());
      if(status!=='all')q.set('status',status);
      const x=await get('/rto-register?'+q);
      setRows(x.rows||[]);setAgents(x.agents||[]);setSummaryRows(x.agent_summary||[]);
    }catch(e){setError(e.message||'Could not load RTO register')}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[tab,status]);
  useEffect(()=>{const t=setTimeout(load,300);return()=>clearTimeout(t)},[search]);

  async function save(e){
    e.preventDefault();setSaving(true);setError('');setMsg('');
    try{
      if(!form.customer_name.trim())throw new Error('Customer Name required.');
      if(!form.rto_agent.trim())throw new Error('RTO Agent / Passing Person required.');
      if(!(Number(form.amount)>0))throw new Error('Enter RTO expense amount.');
      if(tab==='NEW'&&!form.chassis_no.trim())throw new Error('New RTO Expense me Chassis No. required hai. Bill No. optional hai.');
      if(tab==='OLD'&&!(form.sp_no.trim()||form.vehicle.trim()))throw new Error('Old RTO Expense me SP No. ya Vehicle required hai.');
      const payload={...form,rto_type:tab};
      if(editId)await put('/rto-register/'+editId,payload);else await post('/rto-register',payload);
      setOpen(false);setForm(empty());setEditId(null);setMsg(editId?'RTO record updated.':'RTO record saved.');await load();
    }catch(e){setError(e.message||'Could not save')}finally{setSaving(false)}
  }
  function startEdit(r){setEditId(r.id);setForm({date:String(r.date||'').slice(0,10),customer_name:r.customer_name||'',amount:r.amount,work_type:r.work_type||'',rto_agent:r.rto_agent||'',chassis_no:r.chassis_no||'',bill_no:r.bill_no||'',sp_no:r.sp_no||'',vehicle:r.vehicle||'',remarks:r.remarks||''});setOpen(true)}
  async function removeRow(r){if(!confirm('Delete this RTO expense record?'))return;try{await del('/rto-register/'+r.id);setMsg('Record deleted.');await load()}catch(e){setError(e.message||'Delete failed')}}

  async function doImport(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setImporting(true);setError('');setMsg('');
    try{
      const XLSX=await import('xlsx');
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
      const data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:true});
      if(!data.length)throw new Error('Import file is empty.');
      const r=await post('/rto-register/import',{rto_type:tab,rows:data});
      setMsg(`${r.inserted||0} imported, ${r.duplicates||0} duplicate skipped, ${r.rejected_count||0} rejected. ${tab==='NEW'?`${r.mapped||0} already mapped to billing.`:''}`+((r.rejected||[]).length?' Rejected rows: '+r.rejected.slice(0,10).map(x=>`row ${x.row} (${x.reason})`).join('; '):''));
      await load();
    }catch(err){setError(err.message||'Could not import file')}finally{setImporting(false)}
  }

  const summary=useMemo(()=>rows.reduce((a,r)=>{a.count++;a.amount+=Number(r.amount||0);if(['BILLED','TAGGED'].includes(r.mapping_status))a.linked++;else a.unlinked++;return a},{count:0,linked:0,unlinked:0,amount:0}),[rows]);

  return <div className="page">
    <div className="pageHeader">
      <div><h1>RTO Expense Register</h1><p className="muted">Outside RTO expense (not on invoice, Registration Fee alag). Payment on account to RTO agent.</p></div>
      <div className="actions">
        <button className="btn" onClick={()=>fileRef.current?.click()} disabled={importing}>{importing?'Importing…':'Import Excel / CSV'}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
        <button className="btn primary" onClick={()=>{setEditId(null);setForm(empty());setOpen(true)}}>+ Add RTO Expense</button>
      </div>
    </div>
    <ErrorBanner message={error}/>{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <div className="card" style={{marginBottom:12}}>
      <div className="actions" style={{flexWrap:'wrap'}}>
        <button className={'btn '+(tab==='NEW'?'primary':'')} onClick={()=>setTab('NEW')}>New Rickshaw</button>
        <button className={'btn '+(tab==='OLD'?'primary':'')} onClick={()=>setTab('OLD')}>Old Rickshaw</button>
        <input className="input" placeholder="Search customer / chassis / bill / SP / agent / work" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:360}}/>
        <select className="input" value={status} onChange={e=>setStatus(e.target.value)} style={{maxWidth:200}}>
          <option value="all">All</option><option value="billed">{tab==='NEW'?'Billed / Mapped':'Tagged to Old Rickshaw'}</option><option value="unbilled">{tab==='NEW'?'Unbilled':'Not Tagged'}</option>
        </select>
      </div>
      <div className="actions" style={{marginTop:10,flexWrap:'wrap'}}>
        <span>Records: <b>{summary.count}</b></span><span>{tab==='NEW'?'Billed':'Tagged'}: <b>{summary.linked}</b></span><span>{tab==='NEW'?'Unbilled':'Not Tagged'}: <b>{summary.unlinked}</b></span><span>Total RTO Expense: <b>{money(summary.amount)}</b></span>
      </div>
    </div>
    {summaryRows.length>0&&<div className="card" style={{marginBottom:12}}><b>RTO Agent On-Account Ledger</b> <span className="muted">(Expense Voucher type RTO Expense; payment record se link nahi hoti)</span>
      <div className="tablewrap"><table className="table"><thead><tr><th>RTO Agent</th><th>Records</th><th>New</th><th>Old</th><th>Total Expense</th><th>Paid</th><th>Balance</th></tr></thead>
      <tbody>{summaryRows.map(x=><tr key={x.agent}><td><b>{x.agent}</b></td><td>{x.records}</td><td>{money(x.new_amount)}</td><td>{money(x.old_amount)}</td><td>{money(x.total)}</td><td>{money(x.paid)}</td><td><b style={{color:x.balance>0?'#b45309':'#15803d'}}>{money(x.balance)}{x.balance<0?' (Advance)':''}</b></td></tr>)}</tbody></table></div></div>}
    {loading?<div className="card">Loading…</div>:!rows.length?<EmptyState text="No RTO expense records found."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th><th>Customer</th><th>Work</th><th>RTO Expense</th><th>RTO Agent</th>
        {tab==='NEW'?<><th>Chassis No.</th><th>Bill No.</th><th>Billing</th></>:<><th>SP No.</th><th>Vehicle</th><th>Old Rickshaw Tag</th></>}
        <th>Payment</th><th>Action</th>
      </tr></thead><tbody>{rows.map(r=><tr key={r.id}>
        <td>{r.date?String(r.date).slice(0,10):'—'}</td><td><b>{r.customer_name||'—'}</b></td><td>{r.work_type||'—'}</td><td><b>{money(r.amount)}</b></td><td>{r.rto_agent||'—'}</td>
        {tab==='NEW'?<><td>{r.chassis_no||'—'}</td><td>{r.bill_no||r.mapped_bill_no||'—'}</td><td>{r.mapping_status==='BILLED'?'Billed':'Unbilled'}</td></>:<><td>{r.sp_no||'—'}</td><td>{r.vehicle||'—'}</td><td>{r.mapping_status==='TAGGED'?'Tagged':'Not tagged'}</td></>}
        <td>On Account</td><td><button className="btn" onClick={()=>startEdit(r)}>Edit</button> <button className="btn" onClick={()=>removeRow(r)}>Delete</button></td>
      </tr>)}</tbody></table></div>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{editId?'Edit ':''}{tab==='NEW'?'RTO Expense - New Rickshaw':'RTO Expense - Old Rickshaw'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v=>set('date',v)} required/>
        <Field label="Customer Name" value={form.customer_name} onChange={v=>set('customer_name',v)} required/>
        <Field label="RTO Expense Amount" type="number" value={form.amount} onChange={v=>set('amount',v)} required/>
        <Field label="Work / Particulars (optional)" value={form.work_type} onChange={v=>set('work_type',v)}/>
        <div className="field"><label>RTO Agent / Passing Person</label><input className="input" list="rto-agents" value={form.rto_agent} onChange={e=>set('rto_agent',e.target.value)} required/><datalist id="rto-agents">{agents.map(a=><option key={a} value={a}/>)}</datalist></div>
        {tab==='NEW'?<><Field label="Chassis No." value={form.chassis_no} onChange={v=>set('chassis_no',v)}/><Field label="Bill No." value={form.bill_no} onChange={v=>set('bill_no',v)}/></>:<><Field label="SP No." value={form.sp_no} onChange={v=>set('sp_no',v)}/><Field label="Vehicle" value={form.vehicle} onChange={v=>set('vehicle',v)}/></>}
        <Field label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)}/>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button type="button" className="btn" onClick={()=>{setOpen(false);setEditId(null)}}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save'}</button></div>
    </form></div>}
  </div>
}

'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {get,post,put,del} from '../lib/api';
import {Field,ErrorBanner,EmptyState} from './ui';

const today=()=>new Date().toISOString().slice(0,10);
const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

// Khali cell me seedha click karke paste/type karo; Enter ya bahar click karte hi save ho jata hai, fir cell lock.
function InlineCell({value,placeholder,onSave,upper}){
  const [text,setText]=useState(''),[busy,setBusy]=useState(false);
  if(String(value||'').trim())return <span>{value}</span>;
  const commit=async()=>{
    const v=(upper?text.trim().toUpperCase():text.trim());
    if(!v||busy)return;
    setBusy(true);
    try{await onSave(v);setText('')}finally{setBusy(false)}
  };
  return <input className="input" value={text} disabled={busy} placeholder={busy?'Saving…':placeholder}
    onChange={e=>setText(e.target.value)} onBlur={commit}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur()}}}
    style={{minWidth:150,height:34,padding:'4px 8px',borderStyle:'dashed'}}/>;
}

// RTO Expense Register: outside expense (agent / passing person). Never shown on invoice; Registration Fee on invoice is separate.
export function RtoExpenseRegisterPage(){
  const [tab,setTab]=useState('NEW');
  const [rows,setRows]=useState([]),[agents,setAgents]=useState([]),[summaryRows,setSummaryRows]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[importing,setImporting]=useState(false);
  const [error,setError]=useState(''),[msg,setMsg]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('all');
  const [open,setOpen]=useState(false),[editId,setEditId]=useState(null);
  const fileRef=useRef(null);
  const [agentFilter,setAgentFilter]=useState(''),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
  const [orig,setOrig]=useState(null),[unlocked,setUnlocked]=useState(false),[ledger,setLedger]=useState(null);
  const empty=()=>({date:today(),customer_name:'',amount:'',work_type:'',rto_agent:'',chassis_no:'',bill_no:'',sp_no:'',vehicle:'',remarks:''});
  const [form,setForm]=useState(empty());
  const set=(k,v)=>setForm(x=>({...x,[k]:v}));

  const load=async(quiet)=>{
    if(quiet!==true)setLoading(true);setError('');
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
      if(tab==='OLD'&&!(form.sp_no.trim()||form.vehicle.trim()))throw new Error('Old RTO Expense me SP No. ya Vehicle required hai.');
      const payload={...form,rto_type:tab};
      if(editId)await put('/rto-register/'+editId,payload);else await post('/rto-register',payload);
      setOpen(false);setForm(empty());setEditId(null);setOrig(null);setMsg(editId?'RTO record updated.':'RTO record saved.');await load();
    }catch(e){setError(e.message||'Could not save')}finally{setSaving(false)}
  }
  function startEdit(r){setUnlocked(false);setOrig({date:String(r.date||'').slice(0,10),customer_name:r.customer_name,amount:r.amount,work_type:r.work_type,rto_agent:r.rto_agent,chassis_no:r.chassis_no,bill_no:r.bill_no,sp_no:r.sp_no,vehicle:r.vehicle,remarks:r.remarks});setEditId(r.id);setForm({date:String(r.date||'').slice(0,10),customer_name:r.customer_name||'',amount:r.amount,work_type:r.work_type||'',rto_agent:r.rto_agent||'',chassis_no:r.chassis_no||'',bill_no:r.bill_no||'',sp_no:r.sp_no||'',vehicle:r.vehicle||'',remarks:r.remarks||''});setOpen(true)}
  async function removeRow(r){if(!confirm('Delete this RTO expense record?'))return;try{await del('/rto-register/'+r.id);setMsg('Record deleted.');await load()}catch(e){setError(e.message||'Delete failed')}}

  const locked=k=>!!editId&&!!orig&&!unlocked&&String(orig[k]??'').trim()!==''&&String(orig[k]??'').trim()!=='0';
  async function saveInline(r,field,val){
    setError('');setMsg('');
    try{
      await put('/rto-register/'+r.id,{rto_type:tab,date:String(r.date||'').slice(0,10),customer_name:r.customer_name,amount:r.amount,work_type:r.work_type||'',rto_agent:r.rto_agent,chassis_no:r.chassis_no||'',bill_no:r.bill_no||'',sp_no:r.sp_no||'',vehicle:r.vehicle||'',remarks:r.remarks||'',[field]:val});
      setMsg('Saved.');await load(true);
    }catch(e){setError(e.message||'Could not save')}
  }
  async function openLedger(name){
    setLedger({agent:name,loading:true,rows:[]});
    try{const x=await get('/rto-register/ledger?agent='+encodeURIComponent(name));setLedger({agent:name,loading:false,...x})}
    catch(e){setLedger(null);setError(e.message||'Could not load ledger')}
  }
  async function doImport(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setImporting(true);setError('');setMsg('');
    try{
      const XLSX=await import('xlsx');
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
      const data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:true});
      if(!data.length)throw new Error('Import file is empty.');
      const r=await post('/rto-register/import',{rto_type:tab,rows:data});
      setMsg(`${r.inserted||0} imported, ${r.duplicates||0} duplicate skipped, ${r.skipped_payments||0} payment rows skipped, ${r.rejected_count||0} rejected. ${tab==='NEW'?`${r.mapped||0} already mapped to billing.`:''}`+((r.rejected||[]).length?' Rejected rows: '+r.rejected.slice(0,10).map(x=>`row ${x.row} (${x.reason})`).join('; '):''));
      await load();
    }catch(err){setError(err.message||'Could not import file')}finally{setImporting(false)}
  }

  const visibleRows=useMemo(()=>rows.filter(r=>{
    if(agentFilter&&String(r.rto_agent||'').trim().toLowerCase()!==agentFilter.toLowerCase())return false;
    const d=String(r.date||'').slice(0,10);
    if(fromDate&&d&&d<fromDate)return false;
    if(toDate&&d&&d>toDate)return false;
    return true;
  }),[rows,agentFilter,fromDate,toDate]);
  const anyFilter=!!(search||agentFilter||fromDate||toDate||status!=='all');
  const clearAll=()=>{setSearch('');setAgentFilter('');setFromDate('');setToDate('');setStatus('all')};
  const agentOptions=[...new Set([...agents,...(form.rto_agent&&!agents.includes(form.rto_agent)?[form.rto_agent]:[])])];
  const summary=useMemo(()=>visibleRows.reduce((a,r)=>{a.count++;a.amount+=Number(r.amount||0);if(['BILLED','TAGGED'].includes(r.mapping_status))a.linked++;else a.unlinked++;return a},{count:0,linked:0,unlinked:0,amount:0}),[visibleRows]);

  return <div className="page">
    <div className="pageHeader">
      <div><h1>RTO Expense Register</h1><p className="muted">Outside RTO expense (not on invoice, Registration Fee alag). Payment on account to RTO agent.</p></div>
      <div className="actions">
        <button className="btn" onClick={()=>fileRef.current?.click()} disabled={importing}>{importing?'Importing…':'Import Excel / CSV'}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={doImport}/>
        <button className="btn primary" onClick={()=>{setOrig(null);setUnlocked(false);setEditId(null);setForm(empty());setOpen(true)}}>+ Add RTO Expense</button>
      </div>
    </div>
    <ErrorBanner message={error}/>{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <div className="card" style={{marginBottom:12}}>
      <div className="actions" style={{flexWrap:'wrap'}}>
        <button className={'btn '+(tab==='NEW'?'primary':'')} onClick={()=>setTab('NEW')}>New Rickshaw</button>
        <button className={'btn '+(tab==='OLD'?'primary':'')} onClick={()=>setTab('OLD')}>Old Rickshaw</button>
        <div style={{position:'relative',flex:'1 1 320px',maxWidth:480}}>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',opacity:.55,pointerEvents:'none'}}>🔍</span>
          <input className="input" placeholder="Search customer, chassis, bill no, SP no, agent, work…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',paddingLeft:36,paddingRight:search?34:12,height:40}}/>
          {search&&<button type="button" onClick={()=>setSearch('')} aria-label="Clear search" style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',border:0,background:'transparent',cursor:'pointer',fontSize:18,lineHeight:1,opacity:.6}}>×</button>}
        </div>
        <select className="input" value={agentFilter} onChange={e=>setAgentFilter(e.target.value)} style={{maxWidth:200,height:40}}>
          <option value="">All RTO Agents</option>{[...new Set([...agents,...rows.map(r=>String(r.rto_agent||'').trim()).filter(Boolean)])].sort((x,y)=>x.localeCompare(y)).map(x=><option key={x} value={x}>{x}</option>)}
        </select>
        <input type="date" className="input" value={fromDate} onChange={e=>setFromDate(e.target.value)} title="From date" style={{maxWidth:150,height:40}}/>
        <input type="date" className="input" value={toDate} onChange={e=>setToDate(e.target.value)} title="To date" style={{maxWidth:150,height:40}}/>
        {anyFilter&&<button type="button" className="btn" onClick={clearAll}>Clear filters</button>}
        <select className="input" value={status} onChange={e=>setStatus(e.target.value)} style={{maxWidth:200}}>
          <option value="all">All</option><option value="billed">{tab==='NEW'?'Billed / Mapped':'Tagged to Old Rickshaw'}</option><option value="unbilled">{tab==='NEW'?'Unbilled':'Not Tagged'}</option>
        </select>
      </div>
      <div className="actions" style={{marginTop:10,flexWrap:'wrap'}}>
        <span>Records: <b>{summary.count}</b></span><span>{tab==='NEW'?'Billed':'Tagged'}: <b>{summary.linked}</b></span><span>{tab==='NEW'?'Unbilled':'Not Tagged'}: <b>{summary.unlinked}</b></span><span>Total RTO Expense: <b>{money(summary.amount)}</b></span>
      </div>
    </div>
    {summaryRows.length>0&&<div className="card" style={{marginBottom:12}}><b>RTO Agent On-Account Ledger</b> <span className="muted">(Expense Voucher type RTO Expense; payment record se link nahi hoti)</span>
      <div className="tablewrap"><table className="table"><thead><tr><th>RTO Agent</th><th>Records</th><th>New</th><th>Old</th><th>Total Expense</th><th>Paid</th><th>Balance</th><th>Ledger</th></tr></thead>
      <tbody>{summaryRows.map(x=><tr key={x.agent}><td><a onClick={()=>openLedger(x.agent)} style={{cursor:'pointer',color:'var(--accent)'}}><b>{x.agent}</b></a></td><td>{x.records}</td><td>{money(x.new_amount)}</td><td>{money(x.old_amount)}</td><td>{money(x.total)}</td><td>{money(x.paid)}</td><td><b style={{color:x.balance>0?'#b45309':'#15803d'}}>{money(x.balance)}{x.balance<0?' (Advance)':''}</b></td><td><button className="btn" onClick={()=>openLedger(x.agent)}>Open Ledger</button></td></tr>)}</tbody></table></div></div>}
    {loading?<div className="card">Loading…</div>:!visibleRows.length?<EmptyState text="No RTO expense records found."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th><th>Customer</th><th>Work</th><th>RTO Expense</th><th>RTO Agent</th>
        {tab==='NEW'?<><th>Chassis No.</th><th>Bill No.</th><th>Billing</th></>:<><th>SP No.</th><th>Vehicle</th><th>Old Rickshaw Tag</th></>}
        <th>Payment</th><th>Action</th>
      </tr></thead><tbody>{visibleRows.map(r=><tr key={r.id}>
        <td>{r.date?String(r.date).slice(0,10):'—'}</td><td><b>{r.customer_name||'—'}</b></td><td>{r.work_type||'—'}</td><td><b>{money(r.amount)}</b></td><td>{r.rto_agent||'—'}</td>
        {tab==='NEW'?<><td><InlineCell key={'c'+r.id+(r.chassis_no||'')} value={r.chassis_no} placeholder="Click & paste chassis" upper onSave={v=>saveInline(r,'chassis_no',v)}/></td><td>{!r.bill_no&&r.mapped_bill_no?<span>{r.mapped_bill_no} <span className="muted">(auto)</span></span>:<InlineCell key={'b'+r.id+(r.bill_no||'')} value={r.bill_no} placeholder="Click & paste bill no" onSave={v=>saveInline(r,'bill_no',v)}/>}</td><td>{r.mapping_status==='BILLED'?'Billed':'Unbilled'}</td></>:<><td><InlineCell key={'s'+r.id+(r.sp_no||'')} value={r.sp_no} placeholder="Click & paste SP no" onSave={v=>saveInline(r,'sp_no',v)}/></td><td><InlineCell key={'v'+r.id+(r.vehicle||'')} value={r.vehicle} placeholder="Click & paste vehicle" upper onSave={v=>saveInline(r,'vehicle',v)}/></td><td>{r.mapping_status==='TAGGED'?'Tagged':'Not tagged'}</td></>}
        <td>On Account</td><td><button className="btn" onClick={()=>startEdit(r)}>Edit</button> <button className="btn" onClick={()=>removeRow(r)}>Delete</button></td>
      </tr>)}</tbody></table></div>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <div className="actions" style={{justifyContent:'space-between',alignItems:'center'}}><h2 style={{margin:0}}>{editId?'Edit ':''}{tab==='NEW'?'RTO Expense - New Rickshaw':'RTO Expense - Old Rickshaw'}</h2>{editId&&<button type="button" className="btn" onClick={()=>setUnlocked(u=>!u)}>{unlocked?'🔒 Lock filled fields':'✎ Edit filled fields'}</button>}</div>{editId&&!unlocked&&<div className="muted" style={{margin:'6px 0'}}>Bhare hue fields locked hain. Khali fields (jaise Chassis / Bill No.) seedha bhar sakte ho.</div>}<ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Date" type="date" value={form.date} onChange={v=>set('date',v)} required readOnly={locked('date')}/>
        <Field label="Customer Name" value={form.customer_name} onChange={v=>set('customer_name',v)} required readOnly={locked('customer_name')}/>
        <Field label="RTO Expense Amount (dalali)" type="number" value={form.amount} onChange={v=>set('amount',v)} required readOnly={locked('amount')}/>
        <Field label="Work / Particulars (optional)" value={form.work_type} onChange={v=>set('work_type',v)} readOnly={locked('work_type')}/>
        <Field label="RTO Agent / Passing Person" type="select" options={agentOptions} value={form.rto_agent} onChange={v=>set('rto_agent',v)} required readOnly={locked('rto_agent')}/>
        {tab==='NEW'?<><Field label="Chassis No." value={form.chassis_no} onChange={v=>set('chassis_no',v)} readOnly={locked('chassis_no')}/><Field label="Bill No." value={form.bill_no} onChange={v=>set('bill_no',v)} readOnly={locked('bill_no')}/></>:<><Field label="SP No." value={form.sp_no} onChange={v=>set('sp_no',v)} readOnly={locked('sp_no')}/><Field label="Vehicle" value={form.vehicle} onChange={v=>set('vehicle',v)} readOnly={locked('vehicle')}/></>}
        <Field label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)} readOnly={locked('remarks')}/>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button type="button" className="btn" onClick={()=>{setOpen(false);setEditId(null)}}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save'}</button></div>
    </form></div>}
    {ledger&&<div className="modal"><div className="modalbox" style={{maxWidth:980,width:'95%'}}>
      <div className="actions" style={{justifyContent:'space-between',alignItems:'center'}}><h2 style={{margin:0}}>Ledger — {ledger.agent}</h2><div className="actions"><button className="btn" onClick={()=>window.print()}>Print</button><button className="btn" onClick={()=>setLedger(null)}>Close</button></div></div>
      {ledger.loading?<div style={{padding:16}}>Loading…</div>:<>
        <div className="actions" style={{margin:'10px 0',flexWrap:'wrap'}}>
          <span>Total Expense (Cr): <b>{money(ledger.total_credit)}</b></span><span>Total Paid (Dr): <b>{money(ledger.total_debit)}</b></span>
          <span>Balance: <b style={{color:ledger.balance>0?'#b45309':'#15803d'}}>{money(Math.abs(ledger.balance))} {ledger.balance>0?'Cr (dena hai)':ledger.balance<0?'Dr (Advance)':''}</b></span>
        </div>
        <div className="tablewrap" style={{maxHeight:'60vh',overflow:'auto'}}><table className="table"><thead><tr><th>Date</th><th>Particulars</th><th>Ref / Voucher</th><th style={{textAlign:'right'}}>Dr (Paid)</th><th style={{textAlign:'right'}}>Cr (Expense)</th><th style={{textAlign:'right'}}>Running Balance</th></tr></thead>
        <tbody>{ledger.rows.map((x,i)=><tr key={i}>
          <td>{x.date}</td><td>{x.particulars}{x.status&&String(x.status).toLowerCase()==='pending'?<span className="muted"> · approval pending</span>:''}</td><td>{x.ref||'—'}</td>
          <td style={{textAlign:'right'}}>{x.debit?money(x.debit):''}</td><td style={{textAlign:'right'}}>{x.credit?money(x.credit):''}</td>
          <td style={{textAlign:'right'}}><b>{money(Math.abs(x.balance))}</b> {x.balance>0?'Cr':x.balance<0?'Dr':''}</td>
        </tr>)}
        {!ledger.rows.length&&<tr><td colSpan="6" className="muted">No entries.</td></tr>}</tbody>
        {ledger.rows.length>0&&<tfoot><tr><td colSpan="3"><b>Total</b></td><td style={{textAlign:'right'}}><b>{money(ledger.total_debit)}</b></td><td style={{textAlign:'right'}}><b>{money(ledger.total_credit)}</b></td><td style={{textAlign:'right'}}><b>{money(Math.abs(ledger.balance))} {ledger.balance>0?'Cr':ledger.balance<0?'Dr':''}</b></td></tr></tfoot>}
        </table></div></>}
    </div></div>}
  </div>
}

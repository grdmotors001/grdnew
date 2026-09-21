'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const today=()=>new Date().toISOString().slice(0,10);

export function ExpensePaymentVoucherPage(){
  const [masters,setMasters]=useState({expense_types:[],pay_to_types:[],dealers:[],staff:[],mechanics:[],fabricators:[]});
  const [rickshaws,setRickshaws]=useState([]),[incentiveRows,setIncentiveRows]=useState([]),[partyRickshaws,setPartyRickshaws]=useState([]),[selected,setSelected]=useState([]);
  const [rows,setRows]=useState([]),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[msg,setMsg]=useState(''),[statusFilter,setStatusFilter]=useState('');
  const [form,setForm]=useState({date:today(),pay_to_type:'dealer',pay_to_name:'',dealer_id:'',staff_name:'',expense_type:'office_exp',vehicle_id:'',vehicle_ids:[],payment_mode:'cash',amount:'',bill_no:'',attachment_url:'',remarks:'',work_model_name:'',work_qty:1,rate_per_unit:''});

  async function load(){
    setLoading(true);setError('');
    try{
      const [m,v]=await Promise.all([get('/expense-payment-voucher/masters'),get('/expense-payment-voucher'+(statusFilter?'?status='+statusFilter:'') )]);
      setMasters(m);setRows(v.vouchers||[]);
    }catch(e){setError(e.message||'Could not load voucher data')}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[statusFilter]);

  useEffect(()=>{
    const et=form.expense_type;
    if(et==='incentive'){
      if(!form.dealer_id){setIncentiveRows([]);setSelected([]);return}
      get('/expense-payment-voucher/incentive-pending?'+new URLSearchParams({dealer_id:form.dealer_id,page:1,per_page:100}))
        .then(x=>{setIncentiveRows(x.rows||[]);setSelected([])}).catch(e=>setError(e.message||'Could not load unpaid incentives'));
    }else if(et==='assembly'){
      get('/expense-payment-voucher/work-pending?work_type=assembly')
        .then(x=>{setRickshaws(x.rickshaws||[]);setSelected([])}).catch(e=>setError(e.message||'Could not load unpaid assembly rickshaws'));
    }else{
      setRickshaws([]);setIncentiveRows([]);setPartyRickshaws([]);setSelected([]);
      if(et==='insurance'||et==='rto_expense'){
        const party=(form.pay_to_name||'').trim();
        if(party) get('/expense-payment-voucher/party-rickshaws?'+new URLSearchParams({expense_type:et,party_name:party}))
          .then(x=>setPartyRickshaws(x.rickshaws||[])).catch(e=>setError(e.message||'Could not load rickshaws'));
        return;
      }
      const needs=et==='passing_exp';
      if(needs){
        const qs=form.pay_to_type==='dealer'&&form.dealer_id?'?dealer_id='+form.dealer_id:form.pay_to_type==='staff'&&form.staff_name?'?staff_name='+encodeURIComponent(form.staff_name):'';
        if(qs)get('/expense-payment-voucher/rickshaws'+qs).then(x=>setRickshaws(x.rickshaws||[])).catch(e=>setError(e.message));
      }
    }
  },[form.expense_type,form.pay_to_type,form.dealer_id,form.staff_name,form.pay_to_name]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const onExpenseType=v=>{
    if(v==='assembly'){
      setForm(x=>({...x,expense_type:v,pay_to_type:'staff',pay_to_name:'',staff_name:'',vehicle_id:'',vehicle_ids:[],amount:'',rate_per_unit:''}));
    }else if(v==='fabrication'){
      setForm(x=>({...x,expense_type:v,pay_to_type:'other',pay_to_name:'',staff_name:'',vehicle_id:'',vehicle_ids:[],amount:'',work_qty:1,rate_per_unit:''}));
    }else if(v==='incentive'){
      setForm(x=>({...x,expense_type:v,pay_to_type:'dealer',pay_to_name:'',vehicle_id:'',vehicle_ids:[],amount:''}));
    }else if(v==='insurance'||v==='rto_expense'){
      setForm(x=>({...x,expense_type:v,pay_to_type:'other',pay_to_name:'',dealer_id:'',vehicle_id:'',vehicle_ids:[],amount:''}));
    }else setForm(x=>({...x,expense_type:v,vehicle_id:'',vehicle_ids:[],amount:''}));
  };
  const onDealer=v=>{const d=masters.dealers.find(x=>String(x.id)===v);setForm(x=>({...x,dealer_id:v,pay_to_name:d?.name||'',vehicle_id:''}))};
  const toggle=id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const allSelected=rickshaws.length>0&&rickshaws.every(r=>selected.includes(r.vehicle_id));
  const toggleAll=()=>setSelected(allSelected?[]:rickshaws.map(r=>r.vehicle_id));

  async function save(e){
    e.preventDefault();setSaving(true);setError('');setMsg('');
    try{
      let payload={...form};
      if(form.expense_type==='assembly'){
        if(!form.staff_name)throw new Error('Select Assembler / Mechanic.');
        if(!selected.length)throw new Error('Select at least one rickshaw.');
        if(Number(form.rate_per_unit)<=0)throw new Error('Enter rate per rickshaw.');
        payload={...form,vehicle_ids:selected,pay_to_type:'staff',pay_to_name:form.staff_name};
      }else if(form.expense_type==='fabrication'){
        if(!form.pay_to_name)throw new Error('Select Fabricator.');
        if(Number(form.work_qty)<=0)throw new Error('Enter fabrication quantity.');
        if(Number(form.rate_per_unit)<=0)throw new Error('Enter rate per rickshaw.');
        payload={...form,pay_to_type:'other',amount:Number(form.work_qty)*Number(form.rate_per_unit)};
      }else if(form.expense_type==='incentive'){
        if(!selected.length)throw new Error('Select at least one unpaid rickshaw.');
        payload={...form,vehicle_ids:selected};
      }else if(form.expense_type==='insurance'||form.expense_type==='rto_expense'){
        if(!form.pay_to_name.trim())throw new Error(form.expense_type==='insurance'?'Enter Insurance Provider.':'Enter RTO Passing Person / Provider.');
        if(!selected.length)throw new Error('Select at least one rickshaw.');
        if(Number(form.amount)<=0)throw new Error('Enter amount per rickshaw.');
        payload={...form,pay_to_type:'other',vehicle_ids:selected};
      }
      const r=await post('/expense-payment-voucher',payload);
      const added=r.vouchers||[r.voucher]; setRows(x=>[...added,...x]);
      setMsg(added.length>1?added.length+' work/payment vouchers saved — sent for Head Office approval':'Voucher saved — sent for Head Office approval');
      set('amount','');set('vehicle_id','');set('vehicle_ids',[]);set('remarks','');setSelected([]);
      if(form.expense_type==='incentive'){
        const p=await get('/expense-payment-voucher/incentive-pending?'+new URLSearchParams({dealer_id:form.dealer_id,page:1,per_page:100}));setIncentiveRows(p.rows||[]);
      }else if(form.expense_type==='assembly'){
        const p=await get('/expense-payment-voucher/work-pending?work_type=assembly');setRickshaws(p.rickshaws||[]);
      }
    }catch(e){setError(e.message||'Could not save voucher')}finally{setSaving(false)}
  }

  async function approval(id,action){
    let reason='';if(action==='reject'){reason=window.prompt('Enter rejection reason')||'';if(!reason)return}
    try{const r=await post('/expense-payment-voucher/'+id+'/approval',{action,reason});setRows(x=>x.map(v=>v.id===id?r.voucher:v));}
    catch(e){setError(e.message||'Could not update approval')}
  }
  async function markPaid(id){
    try{const r=await post('/expense-payment-voucher/'+id+'/mark-paid',{});setRows(x=>x.map(v=>v.id===id?r.voucher:v));}
    catch(e){setError(e.message||'Could not mark Paid')}
  }

  const et=form.expense_type;
  const showRick=et==='passing_exp'||et==='assembly'||et==='incentive';
  const selectedTotal=selected.length*Number(form.rate_per_unit||form.amount||0);
  return <div className="page">
    <div className="pageHeader"><div><h1>Expense Payment Voucher</h1><p className="muted">Head Office controlled payment, fabrication and assembly work register</p></div></div>
    {error&&<div className="error">{error}</div>}{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <form className="card" onSubmit={save}><h2>New Expense / Work Payment</h2>
      <div className="grid">
        <input className="input" type="date" value={form.date} onChange={e=>set('date',e.target.value)} required/>
        <select className="input" value={form.expense_type} onChange={e=>onExpenseType(e.target.value)}>{masters.expense_types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {et==='assembly'&&<select className="input" value={form.staff_name} onChange={e=>{set('staff_name',e.target.value);set('pay_to_name',e.target.value)}} required><option value="">Select Assembler / Mechanic</option>{masters.mechanics.map(x=><option key={x.id} value={x.name}>{x.name}</option>)}</select>}
        {et==='fabrication'&&<select className="input" value={form.pay_to_name} onChange={e=>set('pay_to_name',e.target.value)} required><option value="">Select Fabricator</option>{masters.fabricators.map(x=><option key={x.id} value={x.name}>{x.name}</option>)}</select>}
        {et!=='assembly'&&et!=='fabrication'&&<select className="input" value={form.pay_to_type} onChange={e=>set('pay_to_type',e.target.value)}><option value="dealer">Dealer</option><option value="staff">Staff / Salesman</option><option value="other">Other</option></select>}
        {et!=='assembly'&&et!=='fabrication'&&form.pay_to_type==='dealer'&&<select className="input" value={form.dealer_id} onChange={e=>onDealer(e.target.value)}><option value="">Select Dealer</option>{masters.dealers.map(d=><option key={d.id} value={d.id}>{d.code?d.code+' — ':''}{d.name}</option>)}</select>}
        {et!=='assembly'&&et!=='fabrication'&&form.pay_to_type==='staff'&&<select className="input" value={form.staff_name} onChange={e=>{set('staff_name',e.target.value);set('pay_to_name',e.target.value)}}><option value="">Select Staff / Salesman</option>{masters.staff.map(x=><option key={x.name} value={x.name}>{x.name}</option>)}</select>}
        {et!=='assembly'&&et!=='fabrication'&&form.pay_to_type==='other'&&<input className="input" placeholder="Pay To Name" value={form.pay_to_name} onChange={e=>set('pay_to_name',e.target.value)}/>}
        {et==='fabrication'&&<><input className="input" placeholder="Model Name" value={form.work_model_name} onChange={e=>set('work_model_name',e.target.value)} required/><input className="input" type="number" min="1" step="1" placeholder="Qty (rickshaws)" value={form.work_qty} onChange={e=>set('work_qty',e.target.value)} required/><input className="input" type="number" min="0.01" step="0.01" placeholder="Rate per Rickshaw" value={form.rate_per_unit} onChange={e=>set('rate_per_unit',e.target.value)} required/></>}
        {et==='assembly'&&<input className="input" type="number" min="0.01" step="0.01" placeholder="Rate per Rickshaw" value={form.rate_per_unit} onChange={e=>set('rate_per_unit',e.target.value)} required/>}
        {et==='incentive'&&<input className="input" type="number" min="0.01" step="0.01" placeholder="Incentive Amount per Rickshaw" value={form.amount} onChange={e=>set('amount',e.target.value)} required/>}
        {et!=='fabrication'&&et!=='assembly'&&et!=='incentive'&&<input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={e=>set('amount',e.target.value)} required/>}
        <select className="input" value={form.payment_mode} onChange={e=>set('payment_mode',e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select>
        <input className="input" placeholder="Bill / Receipt No." value={form.bill_no} onChange={e=>set('bill_no',e.target.value)}/>
        <input className="input" placeholder="Remarks / Narration" value={form.remarks} onChange={e=>set('remarks',e.target.value)}/>
      </div>

      {et==='assembly'&&<div className="card" style={{marginTop:14}}><div className="actions" style={{justifyContent:'space-between'}}><b>Unpaid Rickshaws for Assembly ({rickshaws.length})</b><button type="button" className="btn" onClick={toggleAll}>{allSelected?'Unselect All':'Select All'}</button></div>
        <div className="tablewrap"><table className="table"><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th><th>Date</th><th>Chassis</th><th>Model</th><th>Dealer</th></tr></thead><tbody>{rickshaws.map(r=><tr key={r.vehicle_id} onClick={()=>toggle(r.vehicle_id)} style={{cursor:'pointer'}}><td><input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={()=>toggle(r.vehicle_id)} onClick={e=>e.stopPropagation()}/></td><td>{r.date}</td><td><b>{r.chassis_no}</b></td><td>{r.model_name||'—'}</td><td>{r.dealer_name||'—'}</td></tr>)}</tbody></table></div>
        <div className="muted" style={{marginTop:8}}>Selected: <b>{selected.length}</b> · Total: <b>{money(selectedTotal)}</b></div>
      </div>}

      {et==='incentive'&&<div className="card" style={{marginTop:14}}><div className="actions" style={{justifyContent:'space-between'}}><b>Unpaid Incentive Rickshaws</b><button type="button" className="btn" onClick={()=>setSelected(selected.length===incentiveRows.length?[]:incentiveRows.map(r=>r.vehicle_id))}>{selected.length===incentiveRows.length?'Unselect All':'Select All'}</button></div>
        {!form.dealer_id?<div className="muted">Select dealer above.</div>:<div className="tablewrap"><table className="table"><thead><tr><th></th><th>Date</th><th>Chassis</th><th>Model</th><th>Customer</th></tr></thead><tbody>{incentiveRows.map(r=><tr key={r.vehicle_id} onClick={()=>toggle(r.vehicle_id)}><td><input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={()=>toggle(r.vehicle_id)}/></td><td>{r.date}</td><td><b>{r.chassis_no}</b></td><td>{r.model||'—'}</td><td>{r.customer||'—'}</td></tr>)}</tbody></table></div>}
        <div className="muted" style={{marginTop:8}}>Selected: <b>{selected.length}</b> · Total: <b>{money(selected.length*Number(form.amount||0))}</b></div>
      </div>}

      {(et==='insurance'||et==='rto_expense')&&<div className="muted" style={{marginTop:10}}>Select rickshaws for this {et==='insurance'?'Insurance':'RTO'} expense.</div>}
      {(et==='insurance'||et==='rto_expense')&&<div className="card" style={{marginTop:10}}><div className="actions" style={{justifyContent:'space-between'}}><b>Eligible Rickshaws ({partyRickshaws.length})</b><button type="button" className="btn" onClick={()=>setSelected(selected.length===partyRickshaws.length?[]:partyRickshaws.map(r=>r.vehicle_id))}>{selected.length===partyRickshaws.length?'Unselect All':'Select All'}</button></div><div className="tablewrap"><table className="table"><thead><tr><th></th><th>Date</th><th>Chassis</th><th>Model</th><th>Dealer</th></tr></thead><tbody>{partyRickshaws.map(r=><tr key={r.vehicle_id} onClick={()=>toggle(r.vehicle_id)} style={{cursor:'pointer'}}><td><input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={()=>toggle(r.vehicle_id)} onClick={e=>e.stopPropagation()}/></td><td>{r.date}</td><td><b>{r.chassis_no}</b></td><td>{r.model_name||'—'}</td><td>{r.dealer_name||'—'}</td></tr>)}{!partyRickshaws.length&&<tr><td colSpan="5" className="muted">Enter provider/person name to load eligible rickshaws.</td></tr>}</tbody></table></div><div className="muted" style={{marginTop:8}}>Selected: <b>{selected.length}</b> · Total: <b>{money(selected.length*Number(form.amount||0))}</b></div></div>}
      {et==='passing_exp'&&<div className="muted" style={{marginTop:10}}>Select one rickshaw below for Passing Expense.</div>}
      {et==='passing_exp'&&<select className="input" style={{marginTop:8}} value={form.vehicle_id} onChange={e=>set('vehicle_id',e.target.value)} required><option value="">Select Rickshaw</option>{rickshaws.map(r=><option key={r.vehicle_id} value={r.vehicle_id}>{r.chassis_no} — {r.model_name}</option>)}</select>}
      <button className="btn primary" disabled={saving} style={{marginTop:14}}>{saving?'Saving…':'Save Voucher'}</button>
    </form>

    <div className="card"><div className="actions" style={{justifyContent:'space-between',flexWrap:'wrap'}}><h2 style={{margin:0}}>Payment / Work Register</h2>
      <div className="actions"><button className={'btn '+(!statusFilter?'primary':'')} onClick={()=>setStatusFilter('')}>All</button><button className={'btn '+(statusFilter==='unpaid'?'primary':'')} onClick={()=>setStatusFilter('unpaid')}>Unpaid</button><button className={'btn '+(statusFilter==='paid'?'primary':'')} onClick={()=>setStatusFilter('paid')}>Paid</button></div></div>
      {loading?<div className="muted">Loading…</div>:<div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Voucher</th><th>Work / Expense</th><th>Pay To</th><th>Model</th><th>Chassis</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td><b>{r.voucher_no}</b></td><td>{r.expense_type_name}</td><td>{r.pay_to_name}</td><td>{r.work_model_name||'—'}</td><td>{r.chassis_no||'—'}</td><td>{r.work_qty||'—'}</td><td>{r.rate_per_unit?money(r.rate_per_unit):'—'}</td><td>{money(r.amount)}</td><td>{r.status}</td><td><b>{r.payment_status}</b>{r.paid_at?' · '+r.paid_at:''}</td><td>{r.status==='pending'?<><button type="button" className="btn" onClick={()=>approval(r.id,'approve')} style={{marginRight:5}}>Approve</button><button type="button" className="btn" onClick={()=>approval(r.id,'reject')}>Reject</button></>:r.status==='approved'&&!r.paid_at?<button type="button" className="btn primary" onClick={()=>markPaid(r.id)}>Mark Paid</button>:'—'}</td></tr>)}{!rows.length&&<tr><td colSpan="12" className="muted">No vouchers found.</td></tr>}</tbody></table></div>}
    </div>
  </div>
}

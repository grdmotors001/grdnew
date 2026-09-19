'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})`;
const today=()=>new Date().toISOString().slice(0,10);

export function ExpensePaymentVoucherPage(){
  const [masters,setMasters]=useState({expense_types:[],pay_to_types:[],dealers:[],staff:[]});
  const [rickshaws,setRickshaws]=useState([]),[incentiveRows,setIncentiveRows]=useState([]),[selectedIncentives,setSelectedIncentives]=useState([]);
  const [rows,setRows]=useState([]);
  const [saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[msg,setMsg]=useState('');
  const [form,setForm]=useState({date:today(),pay_to_type:'dealer',pay_to_name:'',dealer_id:'',staff_name:'',expense_type:'office_exp',vehicle_id:'',payment_mode:'cash',amount:'',bill_no:'',attachment_url:'',remarks:''});

  async function load(){
    setLoading(true);setError('');
    try{
      const [m,v]=await Promise.all([get('/expense-payment-voucher/masters'),get('/expense-payment-voucher')]);
      setMasters(m);setRows(v.vouchers||[]);
      const d=m.dealers?.[0];
      if(d)setForm(x=>({...x,dealer_id:String(d.id),pay_to_name:d.name}));
    }catch(e){setError(e.message||'Could not load voucher data')}
    finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);

  useEffect(()=>{
    const needs=form.expense_type==='passing_exp'||form.expense_type==='incentive';
    if(!needs){setRickshaws([]);setIncentiveRows([]);setSelectedIncentives([]);return}
    if(form.expense_type==='incentive'){
      if(form.pay_to_type!=='dealer'||!form.dealer_id){setIncentiveRows([]);setSelectedIncentives([]);return}
      const qs=new URLSearchParams({dealer_id:form.dealer_id,page:1,per_page:100});
      get('/expense-payment-voucher/incentive-pending?'+qs.toString())
        .then(x=>{setIncentiveRows(x.rows||[]);setSelectedIncentives([])})
        .catch(e=>setError(e.message||'Could not load unpaid incentives'));
      return;
    }
    const qs=form.pay_to_type==='dealer'&&form.dealer_id?'?dealer_id='+form.dealer_id:form.pay_to_type==='staff'&&form.staff_name?'?staff_name='+encodeURIComponent(form.staff_name):'';
    if(!qs){setRickshaws([]);return}
    get('/expense-payment-voucher/rickshaws'+qs).then(x=>setRickshaws(x.rickshaws||[])).catch(e=>setError(e.message||'Could not load rickshaws'));
  },[form.expense_type,form.pay_to_type,form.dealer_id,form.staff_name]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const onPayType=v=>setForm(x=>({...x,pay_to_type:v,pay_to_name:'',dealer_id:'',staff_name:'',vehicle_id:''}));
  const onDealer=v=>{const d=masters.dealers.find(x=>String(x.id)===v);setForm(x=>({...x,dealer_id:v,pay_to_name:d?.name||'',vehicle_id:''}));};

  const onExpenseType=v=>{
    if(v==='incentive'){
      const d=masters.dealers.find(x=>String(x.id)===String(form.dealer_id));
      setForm(x=>({...x,expense_type:v,pay_to_type:'dealer',pay_to_name:d?.name||x.pay_to_name,vehicle_id:''}));
      setSelectedIncentives([]);
    }else{
      setForm(x=>({...x,expense_type:v,vehicle_id:''}));
      setSelectedIncentives([]);
    }
  };

  const toggleIncentive=id=>setSelectedIncentives(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const allIncentivesSelected=incentiveRows.length>0&&incentiveRows.every(r=>selectedIncentives.includes(r.vehicle_id));
  const toggleAllIncentives=()=>setSelectedIncentives(allIncentivesSelected?[]:incentiveRows.map(r=>r.vehicle_id));

  async function save(e){
    e.preventDefault();setSaving(true);setError('');setMsg('');
    try{
      let payload={...form};
      if(form.expense_type==='incentive'){
        if(!selectedIncentives.length)throw new Error('Select at least one unpaid rickshaw for Incentive.');
        if(!form.dealer_id)throw new Error('Select Dealer for Incentive.');
        payload={...form,vehicle_ids:selectedIncentives};
      }
      const r=await post('/expense-payment-voucher',payload);
      if(r.vouchers?.length){
        setRows(x=>[...r.vouchers,...x]);
        setMsg((r.vouchers.length)+' incentive voucher(s) saved — sent for Head Office approval');
      }else{
        setRows(x=>[r.voucher,...x]);
        setMsg('Voucher '+r.voucher.voucher_no+' saved — sent for Head Office approval');
      }
      set('amount','');set('bill_no','');set('attachment_url','');set('remarks','');set('vehicle_id','');setSelectedIncentives([]);
      if(form.expense_type==='incentive'){
        const qs=new URLSearchParams({dealer_id:form.dealer_id,page:1,per_page:100});
        const p=await get('/expense-payment-voucher/incentive-pending?'+qs.toString());
        setIncentiveRows(p.rows||[]);
      }
    }catch(e){setError(e.message||'Could not save voucher')}
    finally{setSaving(false)}
  }

  async function approval(id,action){
    let reason='';
    if(action==='reject'){reason=window.prompt('Enter rejection reason')||'';if(!reason)return}
    try{const r=await post('/expense-payment-voucher/'+id+'/approval',{action,reason});setRows(x=>x.map(v=>v.id===id?r.voucher:v));}
    catch(e){setError(e.message||'Could not update approval')}
  }

  const needsRick=form.expense_type==='passing_exp'||form.expense_type==='incentive';

  return <div className="page">
    <div className="pageHeader"><div><h1>Expense Payment Voucher</h1><p className="muted">Head Office controlled payment and expense voucher</p></div></div>
    {error&&<div className="error">{error}</div>}{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}

    <form className="card" onSubmit={save}>
      <h2>New Expense Payment Voucher</h2>
      <div className="grid">
        <input className="input" type="date" value={form.date} onChange={e=>set('date',e.target.value)} required/>
        <select className="input" value={form.pay_to_type} onChange={e=>onPayType(e.target.value)} disabled={form.expense_type==='incentive'}>
          {masters.pay_to_types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {form.pay_to_type==='dealer'&&<select className="input" value={form.dealer_id} onChange={e=>onDealer(e.target.value)} required><option value="">Select Dealer</option>{masters.dealers.map(d=><option key={d.id} value={d.id}>{d.code?d.code+' — ':''}{d.name}</option>)}</select>}
        {form.pay_to_type==='staff'&&<select className="input" value={form.staff_name} onChange={e=>{set('staff_name',e.target.value);set('pay_to_name',e.target.value);set('vehicle_id','')}} required><option value="">Select Staff / Salesman</option>{masters.staff.map(x=><option key={x.name} value={x.name}>{x.name}</option>)}</select>}
        {form.pay_to_type==='other'&&<input className="input" placeholder="Pay To Name" value={form.pay_to_name} onChange={e=>set('pay_to_name',e.target.value)} required/>}
        <select className="input" value={form.expense_type} onChange={e=>onExpenseType(e.target.value)} required>{masters.expense_types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>

        {form.expense_type!=='incentive'&&needsRick&&
          <select className="input" value={form.vehicle_id} onChange={e=>set('vehicle_id',e.target.value)} required>
            <option value="">Select Rickshaw</option>{rickshaws.map(r=><option key={r.vehicle_id} value={r.vehicle_id}>{r.chassis_no} — {r.model_name}{form.pay_to_type==='staff'&&r.dealer_name?' — '+r.dealer_name:''}</option>)}
          </select>
        }

        <select className="input" value={form.payment_mode} onChange={e=>set('payment_mode',e.target.value)} required><option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select>
        <input className="input" type="number" min="0.01" step="0.01" placeholder={form.expense_type==='incentive'?'Incentive Amount per Rickshaw':'Amount'} value={form.amount} onChange={e=>set('amount',e.target.value)} required/>
        <input className="input" placeholder="Bill / Receipt No." value={form.bill_no} onChange={e=>set('bill_no',e.target.value)}/>
        <input className="input" placeholder="Receipt Attachment URL (optional)" value={form.attachment_url} onChange={e=>set('attachment_url',e.target.value)}/>
        <input className="input" placeholder="Remarks / Narration" value={form.remarks} onChange={e=>set('remarks',e.target.value)}/>
      </div>

      {form.expense_type==='incentive'&&<div style={{marginTop:16}}>
        <div className="actions" style={{justifyContent:'space-between',marginBottom:8}}>
          <div><b>Unpaid Incentive Rickshaws</b> <span className="muted">({incentiveRows.length})</span></div>
          <button type="button" className="btn" onClick={toggleAllIncentives} disabled={!incentiveRows.length}>{allIncentivesSelected?'Unselect All':'Select All'}</button>
        </div>
        {!form.dealer_id?<div className="muted">Select a dealer to see only rickshaws whose incentive has not been paid.</div>:
          incentiveRows.length===0?<div className="muted">No unpaid incentive found for this dealer.</div>:
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th><input type="checkbox" checked={allIncentivesSelected} onChange={toggleAllIncentives}/></th><th>Date</th><th>Chassis No.</th><th>Customer</th><th>Mobile</th><th>Bill No.</th><th>Value Amt.</th></tr></thead>
              <tbody>{incentiveRows.map(r=><tr key={r.vehicle_id} onClick={()=>toggleIncentive(r.vehicle_id)} style={{cursor:'pointer'}}>
                <td onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selectedIncentives.includes(r.vehicle_id)} onChange={()=>toggleIncentive(r.vehicle_id)}/></td>
                <td>{r.date}</td><td><b>{r.chassis_no}</b></td><td>{r.customer||'—'}</td><td>{r.mobile_no||'—'}</td><td>{r.bill_no||'—'}</td><td>{money(r.value_amt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        }
        <div className="muted" style={{marginTop:8}}>Selected: <b>{selectedIncentives.length}</b> | Total incentive: <b>{money(Number(form.amount||0)*selectedIncentives.length)}</b></div>
      </div>}

      {needsRick&&form.expense_type!=='incentive'&&<div className="muted" style={{margin:'8px 0 14px'}}>Rickshaw selection is required for Passing Expense.</div>}
      <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Expense Voucher'}</button>
    </form>

    <div className="card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><h2>Voucher History</h2><strong>Total: {money(rows.reduce((a,x)=>a+Number(x.amount||0),0))}</strong></div>
      {loading?<div className="muted">Loading…</div>:<div className="tablewrap"><table className="table">
        <thead><tr><th>Date</th><th>Voucher</th><th>Pay To</th><th>Expense</th><th>Mode</th><th>Amount</th><th>Status</th><th>Bill</th><th>Action</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td><b>{r.voucher_no}</b></td><td>{r.pay_to_name}</td><td>{r.expense_type_name}{r.chassis_no?' — '+r.chassis_no:''}</td><td>{r.payment_mode}</td><td>{money(r.amount)}</td><td><b>{r.status}</b>{r.rejection_reason?' — '+r.rejection_reason:''}</td><td>{r.bill_no||'—'}</td><td>{r.status==='pending'?<><button type="button" className="btn" onClick={()=>approval(r.id,'approve')} style={{marginRight:6}}>Approve</button><button type="button" className="btn" onClick={()=>approval(r.id,'reject')}>Reject</button></>: '—'}</td></tr>)}{!rows.length&&<tr><td colSpan="9" className="muted">No expense vouchers found.</td></tr>}</tbody>
      </table></div>}
    </div>
  </div>
}

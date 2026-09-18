'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const today=()=>new Date().toISOString().slice(0,10);

export function ExpensePaymentVoucherPage(){
  const [masters,setMasters]=useState({expense_types:[],pay_to_types:[],dealers:[],staff:[]});
  const [rickshaws,setRickshaws]=useState([]);
  const [rows,setRows]=useState([]);
  const [saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[msg,setMsg]=useState('');
  const [form,setForm]=useState({date:today(),pay_to_type:'dealer',pay_to_name:'',dealer_id:'',staff_name:'',expense_type:'office_exp',vehicle_id:'',amount:'',remarks:''});
  async function load(){setLoading(true);setError('');try{const [m,v]=await Promise.all([get('/expense-payment-voucher/masters'),get('/expense-payment-voucher')]);setMasters(m);setRows(v.vouchers||[]);const d=m.dealers?.[0];if(d)setForm(x=>({...x,dealer_id:String(d.id),pay_to_name:d.name}));}catch(e){setError(e.message||'Could not load voucher data')}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  useEffect(()=>{const needs=form.expense_type==='passing_exp'||form.expense_type==='incentive';if(!needs){setRickshaws([]);return}const qs=form.pay_to_type==='dealer'&&form.dealer_id?`?dealer_id=${form.dealer_id}`:form.pay_to_type==='staff'&&form.staff_name?`?staff_name=${encodeURIComponent(form.staff_name)}`:' ';if(!qs.trim()){setRickshaws([]);return}get('/expense-payment-voucher/rickshaws'+qs).then(x=>setRickshaws(x.rickshaws||[])).catch(e=>setError(e.message||'Could not load rickshaws'))},[form.expense_type,form.pay_to_type,form.dealer_id,form.staff_name]);
  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const onPayType=v=>setForm(x=>({...x,pay_to_type:v,pay_to_name:'',dealer_id:'',staff_name:'',vehicle_id:''}));
  const onDealer=v=>{const d=masters.dealers.find(x=>String(x.id)===v);setForm(x=>({...x,dealer_id:v,pay_to_name:d?.name||'',vehicle_id:''}))};
  async function save(e){e.preventDefault();setSaving(true);setError('');setMsg('');try{const r=await post('/expense-payment-voucher',form);setRows(x=>[r.voucher,...x]);setMsg('Voucher '+r.voucher.voucher_no+' saved successfully');set('amount','');set('remarks','');set('vehicle_id','')}catch(e){setError(e.message||'Could not save voucher')}finally{setSaving(false)}}
  const needsRick=form.expense_type==='passing_exp'||form.expense_type==='incentive';
  return <div className="page">
    <div className="pageHeader"><div><h1>Expense Payment Voucher</h1><p className="muted">Head Office payment and expense voucher</p></div></div>
    {error&&<div className="error">{error}</div>}{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <form className="card" onSubmit={save}><h2>New Expense Payment Voucher</h2><div className="grid">
      <input className="input" type="date" value={form.date} onChange={e=>set('date',e.target.value)} required/>
      <select className="input" value={form.pay_to_type} onChange={e=>onPayType(e.target.value)}>{masters.pay_to_types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
      {form.pay_to_type==='dealer'&&<select className="input" value={form.dealer_id} onChange={e=>onDealer(e.target.value)} required><option value="">Select Dealer</option>{masters.dealers.map(d=><option key={d.id} value={d.id}>{d.code?d.code+' — ':''}{d.name}</option>)}</select>}
      {form.pay_to_type==='staff'&&<select className="input" value={form.staff_name} onChange={e=>{set('staff_name',e.target.value);set('pay_to_name',e.target.value);set('vehicle_id','')}} required><option value="">Select Staff / Salesman</option>{masters.staff.map(x=><option key={x.name} value={x.name}>{x.name}</option>)}</select>}
      {form.pay_to_type==='other'&&<input className="input" placeholder="Pay To Name" value={form.pay_to_name} onChange={e=>set('pay_to_name',e.target.value)} required/>}
      <select className="input" value={form.expense_type} onChange={e=>{set('expense_type',e.target.value);set('vehicle_id','')}} required>{masters.expense_types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
      {needsRick&&<select className="input" value={form.vehicle_id} onChange={e=>set('vehicle_id',e.target.value)} required><option value="">Select Rickshaw</option>{rickshaws.map(r=><option key={r.vehicle_id} value={r.vehicle_id}>{r.chassis_no} — {r.model_name}{form.pay_to_type==='staff'&&r.dealer_name?' — '+r.dealer_name:''}</option>)}</select>}
      <input className="input" type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={e=>set('amount',e.target.value)} required/>
      <input className="input" placeholder="Remarks" value={form.remarks} onChange={e=>set('remarks',e.target.value)}/>
    </div>{needsRick&&<div className="muted" style={{margin:'8px 0 14px'}}>Rickshaw selection is required for {form.expense_type==='incentive'?'Incentive':'Passing Expense'}.</div>}
    <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Expense Voucher'}</button></form>
    <div className="card"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><h2>Voucher History</h2><strong>Total: {money(rows.reduce((a,x)=>a+Number(x.amount||0),0))}</strong></div>
    {loading?<div className="muted">Loading…</div>:<div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Voucher</th><th>Pay To</th><th>Expense</th><th>Rickshaw</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td><b>{r.voucher_no}</b></td><td>{r.pay_to_name}</td><td>{r.expense_type_name}</td><td>{r.chassis_no||'—'}</td><td>{money(r.amount)}</td><td>{r.remarks||'—'}</td></tr>)}{!rows.length&&<tr><td colSpan="7" className="muted">No expense vouchers found.</td></tr>}</tbody></table></div>}</div>
  </div>
}
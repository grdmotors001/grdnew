'use client';
import {useEffect,useState} from 'react';
import {get,post} from '../lib/api';
import {Field,ErrorBanner,Money,EmptyState} from './ui';
import {formatDate} from '../lib/date';

const today=()=>new Date().toISOString().slice(0,10);

export function IncentiveRegisterPage(){
  const [dealers,setDealers]=useState([]),[dealerId,setDealerId]=useState('');
  const [status,setStatus]=useState('unpaid'),[rows,setRows]=useState([]),[pending,setPending]=useState([]);
  const [selected,setSelected]=useState([]),[open,setOpen]=useState(false);
  const [amount,setAmount]=useState(''),[date,setDate]=useState(today()),[paymentMode,setPaymentMode]=useState('cash'),[remarks,setRemarks]=useState('');
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[dealerPromptOpen,setDealerPromptOpen]=useState(true);
  const [tab,setTab]=useState('register'),[vouchers,setVouchers]=useState([]),[viewV,setViewV]=useState(null);

  useEffect(()=>{get('/dealer-list').then(x=>setDealers(x.dealers||[])).catch(e=>setError(e.message))},[]);
  const load=async()=>{
    setError('');
    if(!dealerId){setRows([]);return}
    try{
      const x=await get('/expense-payment-voucher/incentive-register?dealer_id='+dealerId+'&status='+status);
      setRows(x.rows||[]);
    }catch(e){setError(e.message||'Could not load incentive register')}
  };
  useEffect(()=>{load()},[dealerId,status]);
  // Voucher tab: Payment Voucher No., Dealer, Amount, Date + View (rickshaw list). Dealer select ho to sirf us dealer ke, warna sabhi.
  const loadVouchers=async()=>{
    try{
      const q=new URLSearchParams({status});if(dealerId)q.set('dealer_id',dealerId);
      const x=await get('/expense-payment-voucher/incentive-vouchers?'+q.toString());
      setVouchers(x.vouchers||x.rows||[]);
    }catch(e){setError(e.message||'Could not load incentive vouchers')}
  };
  useEffect(()=>{if(tab==='vouchers')loadVouchers()},[tab,dealerId,status]);
  const vStatus=v=>v.status==='rejected'?'Rejected':v.payment_status==='paid'?'Paid':v.status==='approved'?'Approved · Unpaid':'Pending Approval';
  const vTotal=vouchers.reduce((a,v)=>a+(v.status==='rejected'?0:Number(v.amount||0)),0);

  const openNew=async()=>{
    if(!dealerId)return setError('Select a dealer first.');
    setError('');
    try{
      const x=await get('/expense-payment-voucher/incentive-pending?dealer_id='+dealerId+'&page=1&per_page=200');
      setPending(x.rows||[]);setSelected([]);setAmount('');setDate(today());setRemarks('');setOpen(true);
    }catch(e){setError(e.message||'Could not load unpaid rickshaws')}
  };
  const toggle=id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const all=pending.length>0&&pending.every(r=>selected.includes(r.vehicle_id));
  const toggleAll=()=>setSelected(all?[]:pending.map(r=>r.vehicle_id));
  const save=async e=>{
    e.preventDefault();
    if(!selected.length)return setError('Select at least one rickshaw.');
    if(Number(amount)<=0)return setError('Enter incentive amount per rickshaw.');
    setSaving(true);setError('');
    try{
      // ONE voucher for all selected rickshaws — same voucher is approved once and paid once.
      await post('/expense-payment-voucher',{
        date,pay_to_type:'dealer',pay_to_name:dealers.find(d=>String(d.id)===String(dealerId))?.name||'',
        dealer_id:Number(dealerId),expense_type:'incentive',vehicle_ids:selected,
        payment_mode:paymentMode,single_voucher:true,per_vehicle_amount:Number(amount),
        amount:Number(amount)*selected.length,remarks
      });
      setOpen(false);setSelected([]);await load();if(tab==='vouchers')await loadVouchers();
    }catch(e){setError(e.message||'Could not create incentive voucher')}finally{setSaving(false)}
  };

  const dealer=dealers.find(d=>String(d.id)===String(dealerId));
  const total=rows.reduce((a,r)=>a+Number(r.amount||0),0);

  return <div className="page">
    <div className="pageHeader"><div><h1>Incentive Register</h1><p className="muted">Dealer select karne ke baad Paid / Unpaid incentive running list.</p></div></div>
    <ErrorBanner message={error}/>
    <div className="actions" style={{marginBottom:10}}>
      <button className={'btn '+(tab==='register'?'primary':'')} onClick={()=>setTab('register')}>Rickshaw Register</button>
      <button className={'btn '+(tab==='vouchers'?'primary':'')} onClick={()=>setTab('vouchers')}>Payment Vouchers</button>
    </div>
    <div className="card">
      <div className="toolbar">
        <Field label="Dealer" type="select" value={dealerId} options={[{value:'',label:'Select Dealer'},...dealers.map(d=>({value:d.id,label:d.name}))]} onChange={v=>{setDealerId(v);setDealerPromptOpen(false)}}/>
        <div className="actions" style={{alignSelf:'end'}}>
          <button className={'btn '+(status==='all'?'primary':'')} onClick={()=>setStatus('all')}>All</button>
          <button className={'btn '+(status==='paid'?'primary':'')} onClick={()=>setStatus('paid')}>Paid</button>
          <button className={'btn '+(status==='unpaid'?'primary':'')} onClick={()=>setStatus('unpaid')}>Unpaid</button>
        </div>
        <button className="btn primary" style={{alignSelf:'end'}} disabled={!dealerId} onClick={openNew}>+ New Incentive Voucher</button>
      </div>
      {dealerId&&<div className="actions" style={{marginTop:10}}>Dealer: <b>{dealer?.name}</b> · Showing: <b>{status.toUpperCase()}</b> · Total: <b><Money value={total}/></b></div>}
    </div>
    {dealerPromptOpen&&<div className="modal"><div className="modalbox">
      <h2>Incentive — Select Dealer</h2>
      <p className="muted">Pehle dealer select karein. Uske baad us dealer ki Paid / Unpaid incentive list khulegi.</p>
      <Field label="Dealer" type="select" value={dealerId}
        options={[{value:'',label:'Select Dealer'},...dealers.map(d=>({value:d.id,label:d.name}))]}
        onChange={v=>{setDealerId(v);if(v)setDealerPromptOpen(false)}} required/>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}>
        <button className="btn" onClick={()=>setDealerPromptOpen(false)}>Close</button>
      </div>
    </div></div>}
    {tab==='vouchers'?(!vouchers.length?<EmptyState text={'No '+status+' incentive vouchers'+(dealerId?' for this dealer.':'.')}/>:<div className="tablewrap">
      <table className="table"><thead><tr><th>Payment Voucher No.</th><th>Date</th><th>Dealer</th><th>Rickshaws</th><th>Amount</th><th>Status</th><th>View</th></tr></thead>
      <tbody>{vouchers.map(v=><tr key={v.id}><td><b>{v.voucher_no}</b></td><td>{formatDate(v.date)}</td><td>{v.pay_to_name||'—'}</td><td>{v.vehicle_count||0}</td><td><Money value={v.amount}/></td><td>{vStatus(v)}</td><td><button className="btn" onClick={()=>setViewV(v)}>View</button></td></tr>)}</tbody>
      <tfoot><tr><td colSpan="4"><b>Total (excl. rejected)</b></td><td><b><Money value={vTotal}/></b></td><td colSpan="2"></td></tr></tfoot></table>
    </div>):!dealerId?<EmptyState text="Select a dealer to open the incentive account."/>:!rows.length?<EmptyState text={'No '+status+' incentive vouchers for this dealer.'}/>:<div className="tablewrap">
      <table className="table"><thead><tr><th>Payment Voucher No.</th><th>Date</th><th>Chassis</th><th>Customer / Dealer</th><th>Per Rickshaw Amount</th><th>Status</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.voucher_no}</b></td><td>{formatDate(r.date)}</td><td>{r.chassis_no||'—'}</td><td>{r.pay_to_name}</td><td><Money value={r.amount}/></td><td>{r.paid_at?'Paid':'Unpaid'}</td></tr>)}</tbody></table>
    </div>}

    {viewV&&<div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setViewV(null)}}><div className="modalbox">
      <h2>Voucher {viewV.voucher_no}</h2>
      <div className="actions" style={{flexWrap:'wrap',gap:16,margin:'6px 0 12px'}}>
        <span>Date: <b>{formatDate(viewV.date)}</b></span><span>Dealer: <b>{viewV.pay_to_name||'—'}</b></span>
        <span>Total: <b><Money value={viewV.amount}/></b></span><span>Status: <b>{vStatus(viewV)}</b></span>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr><th>#</th><th>Chassis</th><th>Model</th><th>Customer</th><th>Bill No.</th><th>Amount</th></tr></thead>
        <tbody>{(viewV.vehicles||[]).map((x,i)=><tr key={x.id||i}><td>{i+1}</td><td><b>{x.chassis_no||'—'}</b></td><td>{x.model_name||'—'}</td><td>{x.customer_name||'—'}</td><td>{x.bill_no||'—'}</td><td><Money value={x.amount}/></td></tr>)}
        {!(viewV.vehicles||[]).length&&<tr><td colSpan="6" className="muted">No rickshaw linked.</td></tr>}</tbody></table></div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button className="btn" onClick={()=>setViewV(null)}>Close</button></div>
    </div></div>}

    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>New Incentive — {dealer?.name}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Payment Date" type="date" value={date} onChange={setDate} required/>
        <Field label="Incentive Per Rickshaw" type="number" value={amount} onChange={setAmount} required/>
        <Field label="Payment Mode" type="select" value={paymentMode} options={['cash','bank','upi','cheque'].map(x=>({value:x,label:x.toUpperCase()}))} onChange={setPaymentMode}/>
        <Field label="Remarks" value={remarks} onChange={setRemarks}/>
      </div>
      <div className="card" style={{marginTop:12}}>
        <div className="actions" style={{justifyContent:'space-between'}}><b>Select Rickshaws for New Voucher</b><button type="button" className="btn" onClick={toggleAll}>{all?'Unselect All':'Select All'}</button></div>
        <div className="tablewrap"><table className="table"><thead><tr><th></th><th>Date</th><th>Chassis</th><th>Customer</th><th>Bill No.</th><th>Value</th></tr></thead><tbody>
        {pending.map(r=><tr key={r.vehicle_id} onClick={()=>toggle(r.vehicle_id)} style={{cursor:'pointer'}}><td><input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={()=>toggle(r.vehicle_id)} onClick={e=>e.stopPropagation()}/></td><td>{formatDate(r.date)}</td><td><b>{r.chassis_no}</b></td><td>{r.customer||'—'}</td><td>{r.bill_no||'—'}</td><td><Money value={r.value_amt}/></td></tr>)}
        {!pending.length&&<tr><td colSpan="6" className="muted">No unpaid rickshaw available.</td></tr>}</tbody></table></div>
        <div className="muted" style={{marginTop:8}}>Selected: <b>{selected.length}</b> · Total incentive: <b><Money value={selected.length*Number(amount||0)}/></b></div>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Create 1 Voucher'}</button></div>
    </form></div>}
  </div>
}

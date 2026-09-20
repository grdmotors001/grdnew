'use client';
import {useEffect,useState} from 'react';
import {get,post} from '../lib/api';
import {Field,ErrorBanner,Money,EmptyState} from './ui';
import {formatDate} from '../lib/date';

const today=()=>new Date().toISOString().slice(0,10);

export function InsuranceRtoRegisterPage(){
  const [tab,setTab]=useState('insurance'),[party,setParty]=useState(''),[status,setStatus]=useState('unpaid');
  const [parties,setParties]=useState([]),[rows,setRows]=useState([]),[rickshaws,setRickshaws]=useState([]);
  const [selected,setSelected]=useState([]),[amount,setAmount]=useState(''),[date,setDate]=useState(today());
  const [paymentMode,setPaymentMode]=useState('cash'),[billNo,setBillNo]=useState(''),[billAmount,setBillAmount]=useState(''),[remarks,setRemarks]=useState('');
  const [open,setOpen]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);

  const et=tab==='insurance'?'insurance':'rto_expense';
  const loadParties=async()=>{
    const x=await get('/expense-payment-voucher?expense_type='+et+'&status=all');
    const names=[...new Set((x.vouchers||[]).map(v=>v.pay_to_name).filter(Boolean))];
    setParties(names);
  };
  const load=async()=>{
    setError('');
    try{
      await loadParties();
      const x=await get('/expense-payment-voucher/party-pending?expense_type='+et+(party?'&party_name='+encodeURIComponent(party):'')+'&status='+status);
      setRows(x.vouchers||[]);
      if(party){
        const y=await get('/expense-payment-voucher/party-rickshaws?expense_type='+et+'&party_name='+encodeURIComponent(party));
        setRickshaws(y.rickshaws||[]);
      }else setRickshaws([]);
      setSelected([]);
    }catch(e){setError(e.message||'Could not load register')}
  };
  useEffect(()=>{load()},[tab,party,status]);

  const toggle=id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const all=rickshaws.length>0&&rickshaws.every(r=>selected.includes(r.vehicle_id));
  const toggleAll=()=>setSelected(all?[]:rickshaws.map(r=>r.vehicle_id));

  const save=async e=>{
    e.preventDefault();setError('');
    if(!party)return setError(tab==='insurance'?'Select Insurance Provider / Agent':'Select RTO Passing Person');
    if(!selected.length)return setError('Select at least one rickshaw.');
    if(Number(amount)<=0)return setError('Enter amount per rickshaw.');
    setSaving(true);
    try{
      await post('/expense-payment-voucher',{
        date,pay_to_type:'other',pay_to_name:party,expense_type:et,
        vehicle_ids:selected,amount:Number(amount),bill_amount:Number(billAmount||amount),payment_mode:paymentMode,bill_no:billNo,remarks
      });
      setOpen(false);setSelected([]);setAmount('');setBillAmount('');setBillNo('');setRemarks('');
      setStatus('unpaid');await load();
    }catch(e){setError(e.message||'Could not create voucher')}finally{setSaving(false)}
  };

  const paidTotal=rows.filter(x=>x.paid_at).reduce((a,x)=>a+Number(x.amount||0),0);
  const unpaidTotal=rows.filter(x=>!x.paid_at).reduce((a,x)=>a+Number(x.amount||0),0);
  const billTotal=rows.reduce((a,x)=>a+Number(x.bill_amount||x.amount||0),0);
  const runningBalance=unpaidTotal;

  return <div className="page">
    <div className="pageHeader"><div><h1>{tab==='insurance'?'Insurance':'RTO Expense'}</h1>
      <p className="muted">{tab==='insurance'?'Insurance provider/agent wise running account':'RTO passing person wise running account'}</p></div></div>
    <ErrorBanner message={error}/>
    <div className="card" style={{marginBottom:12}}>
      <div className="actions">
        <button className={'btn '+(tab==='insurance'?'primary':'')} onClick={()=>{setTab('insurance');setParty('')}}>Insurance</button>
        <button className={'btn '+(tab==='rto'?'primary':'')} onClick={()=>{setTab('rto');setParty('')}}>RTO Expense</button>
      </div>
      <div className="toolbar" style={{marginTop:12}}>
        <Field label={tab==='insurance'?'Insurance Provider / Agent':'Passing By / RTO Person'} type="select" value={party}
          options={[{value:'',label:'Select Party'},...parties.map(x=>({value:x,label:x}))]} onChange={setParty}/>
        <div className="actions" style={{alignSelf:'end'}}>
          <button className={'btn '+(status==='all'?'primary':'')} onClick={()=>setStatus('all')}>All</button>
          <button className={'btn '+(status==='paid'?'primary':'')} onClick={()=>setStatus('paid')}>Paid</button>
          <button className={'btn '+(status==='unpaid'?'primary':'')} onClick={()=>setStatus('unpaid')}>Unpaid</button>
        </div>
        <button className="btn primary" style={{alignSelf:'end'}} disabled={!party} onClick={()=>setOpen(true)}>+ New Voucher</button>
      </div>
      <div className="actions" style={{marginTop:10}}>
        <span>Paid: <b><Money value={paidTotal}/></b></span>
        <span>Unpaid / On Account: <b><Money value={unpaidTotal}/></b></span>
        <span>Bill/Charge Total: <b><Money value={billTotal}/></b> · Running Balance: <b><Money value={runningBalance}/></b></span>
      </div>
    </div>

    {!rows.length?<EmptyState text={party?'No entries for this party.':'Select a party to view the running account.'}/>:<div className="tablewrap">
      <table className="table"><thead><tr><th>Voucher No.</th><th>Date</th><th>Rickshaw / Chassis</th><th>{tab==='insurance'?'Insurance From':'Passing By'}</th><th>Bill Amount</th><th>Charge / Per Rickshaw</th><th>Status</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.voucher_no}</b></td><td>{formatDate(r.date)}</td><td>{r.chassis_no||'—'}</td><td>{r.pay_to_name}</td><td><Money value={r.bill_amount||r.amount}/></td><td><Money value={r.amount}/></td><td>{r.paid_at?'Paid':'Unpaid / On Account'}</td></tr>)}</tbody></table>
    </div>}

    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>{tab==='insurance'?'New Insurance Voucher':'New RTO Expense Voucher'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label={tab==='insurance'?'Insurance Provider / Agent':'Passing By / RTO Person'} value={party} onChange={setParty} required/>
        <Field label="Date" type="date" value={date} onChange={setDate} required/>
        <Field label="Charge / Payable Per Rickshaw" type="number" value={amount} onChange={setAmount} required/>
        {tab==='insurance'&&<Field label="Original Insurance Bill Amount" type="number" value={billAmount} onChange={setBillAmount}/>}
        <Field label="Payment Mode" type="select" value={paymentMode} options={['cash','bank','upi','cheque'].map(x=>({value:x,label:x.toUpperCase()}))} onChange={setPaymentMode}/>
        <Field label="Bill / Receipt No." value={billNo} onChange={setBillNo}/>
        <Field label="Remarks" value={remarks} onChange={setRemarks}/>
      </div>
      <div className="card" style={{marginTop:12}}>
        <div className="actions" style={{justifyContent:'space-between'}}><b>Select Rickshaws</b><button type="button" className="btn" onClick={toggleAll}>{all?'Unselect All':'Select All'}</button></div>
        <div className="tablewrap"><table className="table"><thead><tr><th></th><th>Chassis</th><th>Model</th><th>Dealer</th><th>Date</th></tr></thead><tbody>
        {rickshaws.map(r=><tr key={r.vehicle_id} onClick={()=>toggle(r.vehicle_id)} style={{cursor:'pointer'}}><td><input type="checkbox" checked={selected.includes(r.vehicle_id)} onChange={()=>toggle(r.vehicle_id)} onClick={e=>e.stopPropagation()}/></td><td><b>{r.chassis_no}</b></td><td>{r.model_name}</td><td>{r.dealer_name||'—'}</td><td>{formatDate(r.date)}</td></tr>)}
        {!rickshaws.length&&<tr><td colSpan="5" className="muted">No unused rickshaws for this party.</td></tr>}</tbody></table></div>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Close</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Create Voucher'}</button></div>
    </form></div>}
  </div>
}

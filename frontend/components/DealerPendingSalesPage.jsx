'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { Money } from './ui';
import { relationOptionsFor } from './invoiceHelpers';

const today=()=>new Date().toISOString().slice(0,10);
const initial={dealer_id:'',delivery_challan_id:'',application_id:'',date:today(),
  buyer_name:'',buyer_mobile:'',buyer_relation:'',buyer_father_name:'',buyer_address:'',buyer_gst_no:'',buyer_pan:'',buyer_aadhar:'',buyer_dob:'',buyer_state:'',buyer_state_code:'',
  state_type:'I',mode_term:'',bank_name:'',bank_account_no:'',bank_ifsc:'',rto_name:'',despatch_through:'',eway_bill_no:'',license_no:'',cvr_no:'',cancelled_cheque_no:'',remarks:'',
  dealer_page_no:'',sale_amount:'',amount_received:'',financer_name:'',hypothecation_amount:'',vehicle_reg_no:'',ledger_no:'',chassis_record_no:'',voucher_no:'',subsidy_amount:'',
  gst_sale_amount:'',gst_rate:5,insurance_amount:'',registration_amount:'',discount:'',
  sale_type:'',page_no:'',do_no:'',internal_sale_details:''};

const Input=({label,...p})=><label className="field"><span>{label}</span><input className="input" {...p}/></label>;
const Text=({label,...p})=><label className="field"><span>{label}</span><textarea className="input" rows="2" {...p}/></label>;

export function DealerPendingSalesPage(){
  const [data,setData]=useState({applications:[],vehicles:[],dealers:[]});
  const [open,setOpen]=useState(false),[step,setStep]=useState(0),[form,setForm]=useState(initial);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);

  const load=async()=>{
    setError('');
    try{
      const d=await get('/dealer/pending-sales',{noClientCache:true,timeoutMs:15000});
      setData({applications:d.applications||[],vehicles:d.vehicles||[],dealers:d.dealers||[]});
    }catch(e){setError(e.message||'Could not load Pending Sales');}
  };
  useEffect(()=>{load()},[]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const vehicle=useMemo(()=>data.vehicles.find(v=>String(v.challan_id)===String(form.delivery_challan_id)),[data.vehicles,form.delivery_challan_id]);
  const loan=useMemo(()=>data.applications.find(v=>String(v.id)===String(form.application_id)),[data.applications,form.application_id]);
  const balance=Math.max(0,Number(form.sale_amount||0)-Number(form.hypothecation_amount||form.loan_amount||0)-Number(form.amount_received||0));

  const openCreate=(x=null)=>{
    const dealer=String(x?.dealer_id||data.dealers[0]?.id||'');
    setForm({...initial,dealer_id:dealer,application_id:x?.id?String(x.id):'',buyer_name:x?.customer_name||'',buyer_mobile:x?.customer_phone||'',buyer_address:x?.customer_address||'',buyer_state:x?.customer_state||'',sale_amount:x?.loan_amount?String(x.loan_amount):'',gst_sale_amount:x?.loan_amount?String(x.loan_amount):'',hypothecation_amount:x?.loan_amount?String(x.loan_amount):'',sale_type:x?.loan_vehicle_type||''});
    setStep(0);setOpen(true);setError('');
  };

  const applyLoan=(id)=>{
    const x=data.applications.find(v=>String(v.id)===String(id));
    if(!x){setForm(f=>({...f,application_id:'',buyer_name:'',buyer_mobile:'',buyer_address:'',buyer_state:''}));return;}
    setForm(f=>({...f,application_id:String(x.id),dealer_id:String(x.dealer_id||f.dealer_id),buyer_name:x.customer_name||'',buyer_mobile:x.customer_phone||'',buyer_address:x.customer_address||'',buyer_state:x.customer_state||'',sale_amount:x.loan_amount?String(x.loan_amount):f.sale_amount,gst_sale_amount:x.loan_amount?String(x.loan_amount):f.gst_sale_amount,hypothecation_amount:x.loan_amount?String(x.loan_amount):f.hypothecation_amount,sale_type:x.loan_vehicle_type||f.sale_type}));
  };

  const applyVehicle=(id)=>{
    const v=data.vehicles.find(x=>String(x.challan_id)===String(id));if(!v)return;
    setForm(f=>({...f,delivery_challan_id:String(v.challan_id),dealer_id:String(v.dealer_id||f.dealer_id),sale_amount:f.sale_amount||String(v.sale_value||''),gst_sale_amount:f.gst_sale_amount||String(v.sale_value||''),sale_type:f.sale_type||v.model_name||'New Rickshaw',dealer_page_no:v.dealer_page_no||f.dealer_page_no}));
  };

  const save=async(e)=>{
    e.preventDefault();setSaving(true);setError('');
    try{
      if(!form.dealer_id)throw new Error('Dealer select karo.');
      if(!form.delivery_challan_id)throw new Error('Chassis / Delivery Challan select karo.');
      if(!form.buyer_name.trim())throw new Error('Customer Name required hai.');
      if(Number(form.hypothecation_amount||0)>Number(form.sale_amount||0))throw new Error('Hypothecation/Loan Amount Sale Amount se zyada nahi ho sakta.');
      await post('/billing/pending-sales/create',{...form,dealer_id:Number(form.dealer_id),delivery_challan_id:Number(form.delivery_challan_id),application_id:form.application_id?Number(form.application_id):null,
        customer_name:form.buyer_name,customer_phone:form.buyer_mobile,customer_address:form.buyer_address,customer_state:form.buyer_state,
        sale_amount:Number(form.sale_amount||0),loan_amount:Number(form.hypothecation_amount||0),description:form.internal_sale_details||'Internal Sale'});
      setOpen(false);await load();
    }catch(e2){setError(e2.message||'Could not save Pending Sale');}
    finally{setSaving(false);}
  };

  return <div>
    <div className="dealerContentToolbar"><div className="dealerPageIntro"><span className="dealerSectionIcon">▤</span><div><strong>Pending Sales</strong><small>Full Tax Invoice Details — Bill No. intentionally removed</small></div></div><button className="btn" onClick={load}>↻ Refresh</button></div>
    {error&&!open&&<div className="error">{error}</div>}
    <div className="actions" style={{marginBottom:12}}><button className="btn primary" onClick={()=>openCreate(null)}>＋ Create Pending Sale</button><span className="muted" style={{alignSelf:'center'}}>Billed sales yahan nahi dikhengi.</span></div>

    <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Application</th><th>Customer</th><th>Dealer</th><th>Sale Value</th><th>Loan</th><th>Status</th><th></th></tr></thead><tbody>
      {data.applications.map(r=><tr key={r.id}><td><b>{r.application_no||('Loan #'+r.id)}</b></td><td>{r.customer_name||'—'}<div className="muted">{r.customer_phone||''}</div></td><td>{r.dealer_name||'—'}</td><td><Money value={r.loan_amount}/></td><td><Money value={r.loan_amount}/></td><td><span className="pill d">Loan Approved</span></td><td><button className="btn primary" onClick={()=>openCreate(r)}>Create Pending Sale</button></td></tr>)}
      {!data.applications.length&&<tr><td colSpan="7"><div className="dealerEmpty">No unbilled Loan Approved application found.</div></td></tr>}
    </tbody></table></div>

    {open&&<div className="modal" style={{zIndex:10000}}><form className="modalbox tiModal" onSubmit={save} style={{maxWidth:1000}}>
      <div className="tiHeader"><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}><div><h2 style={{margin:0}}>New Pending Sale</h2><p className="muted" style={{margin:'6px 0 0'}}>Tax Invoice jaisa complete form — <b>Bill No. nahi hai</b>. Save hone ke baad Billing approval workflow me jayega.</p></div><button type="button" className="btn" onClick={()=>setOpen(false)}>✕</button></div>
      <div className="formgrid" style={{marginTop:12}}>
        <label className="field"><span>Dealer</span><select className="input" value={form.dealer_id} onChange={e=>{set('dealer_id',e.target.value);set('delivery_challan_id','')}} required><option value="">Select Dealer</option>{data.dealers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="field"><span>Delivery Challan / Chassis</span><select className="input" value={form.delivery_challan_id} onChange={e=>applyVehicle(e.target.value)} required><option value="">Select Chassis No.</option>{data.vehicles.filter(v=>!form.dealer_id||String(v.dealer_id)===String(form.dealer_id)).map(v=><option key={v.challan_id} value={v.challan_id}>{v.chassis_no||'No Chassis'} — {v.challan_no||'DC'} — {v.model_name||v.product_name||''}</option>)}</select></label>
      </div>
      {vehicle&&<div className="tiHeaderStrip"><span><b>Dealer:</b> {vehicle.dealer_name||'—'}</span><span><b>Chassis:</b> {vehicle.chassis_no||'—'}</span><span><b>Model:</b> {vehicle.model_name||vehicle.product_name||'—'}</span><span><b>Colour:</b> {vehicle.colour||vehicle.vehicle_colour||'—'}</span><span><b>Battery:</b> {vehicle.battery_maker||'—'} {vehicle.battery_no1||''}</span></div>}
      </div>
      {error&&<div className="error">{error}</div>}
      <div className="tiTabs">{['Applicant Details','Internal','Amount / Tax'].map((x,i)=><button type="button" key={x} className={'tiTab'+(step===i?' active':'')} onClick={()=>setStep(i)}>{i+1}. {x}</button>)}</div>
      <div className="tiStepBody">
        {step===0&&<><div className="actions" style={{margin:'10px 0'}}><label className="field" style={{minWidth:300}}><span>Approved / Pending Loan Customer</span><select className="input" value={form.application_id} onChange={e=>applyLoan(e.target.value)}><option value="">Manual Customer / No Loan Approved</option>{data.applications.map(x=><option key={x.id} value={x.id}>{x.application_no||x.id} — {x.customer_name||''} — {x.customer_phone||''}</option>)}</select></label>{loan&&<span className="muted" style={{alignSelf:'center'}}>Loan Approved se customer details auto-filled.</span>}</div>
          <div className="formgrid">
            <Input label="Dealer Page No." value={form.dealer_page_no} onChange={e=>set('dealer_page_no',e.target.value)}/>
            <Input label="Customer Name" value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)} required/>
            <label className="field"><span>Relation (S/O, D/O, C/O)</span><select className="input" value={form.buyer_relation||''} onChange={e=>set('buyer_relation',e.target.value)}><option value="">— (Firm / none)</option>{relationOptionsFor(form.buyer_relation).filter(o=>o.value).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <Input label="Buyer Father/Husband Name" value={form.buyer_father_name} onChange={e=>set('buyer_father_name',e.target.value)}/>
            <Input label="Buyer Address" value={form.buyer_address} onChange={e=>set('buyer_address',e.target.value)}/>
            <Input label="Buyer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/>
            <Input label="Buyer GSTIN (if any)" value={form.buyer_gst_no} onChange={e=>set('buyer_gst_no',e.target.value)}/>
            <Input label="Buyer PAN" value={form.buyer_pan} onChange={e=>set('buyer_pan',e.target.value)}/>
            <Input label="Buyer Aadhar" value={form.buyer_aadhar} onChange={e=>set('buyer_aadhar',e.target.value)}/>
            <Input label="Buyer Date of Birth" type="date" value={form.buyer_dob} onChange={e=>set('buyer_dob',e.target.value)}/>
            <Input label="Buyer State" value={form.buyer_state} onChange={e=>set('buyer_state',e.target.value)}/>
            <Input label="Buyer State Code" value={form.buyer_state_code} onChange={e=>set('buyer_state_code',e.target.value)}/>
            <label className="field"><span>Intra / Inter State</span><select className="input" value={form.state_type} onChange={e=>set('state_type',e.target.value)}><option value="I">Intra-state (CGST + SGST)</option><option value="O">Inter-state (IGST)</option></select></label>
            <Input label="Mode / Term" value={form.mode_term} onChange={e=>set('mode_term',e.target.value)}/>
            <Input label="Bank Name" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/>
            <Input label="Bank Account No." value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/>
            <Input label="Bank IFSC" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value)}/>
            <Input label="RTO Name" value={form.rto_name} onChange={e=>set('rto_name',e.target.value)}/>
            <Input label="Despatch Through" value={form.despatch_through} onChange={e=>set('despatch_through',e.target.value)}/>
            <Input label="E-Way Bill No." value={form.eway_bill_no} onChange={e=>set('eway_bill_no',e.target.value)}/>
            <Input label="License No." value={form.license_no} onChange={e=>set('license_no',e.target.value)}/>
            <Input label="CVR No." value={form.cvr_no} onChange={e=>set('cvr_no',e.target.value)}/>
            <Input label="Cancelled Cheque No." value={form.cancelled_cheque_no} onChange={e=>set('cancelled_cheque_no',e.target.value)}/>
            <Text label="Remarks" value={form.remarks} onChange={e=>set('remarks',e.target.value)} style={{gridColumn:'1 / -1'}}/>
          </div>
        </>}

        {step===1&&<div className="formgrid">
          <Input label="Sale Amount (Internal / Balance)" type="number" min="0" value={form.sale_amount} onChange={e=>set('sale_amount',e.target.value)} required/>
          <Input label="Amount Received" type="number" min="0" value={form.amount_received} onChange={e=>set('amount_received',e.target.value)}/>
          <Input label="Financer Name (Hypothecation)" value={form.financer_name} onChange={e=>set('financer_name',e.target.value)}/>
          <Input label="Hypothecation / Loan Amount" type="number" min="0" value={form.hypothecation_amount} onChange={e=>set('hypothecation_amount',e.target.value)}/>
          <label className="field"><span>Balance (Sale − Hypothecation − Received)</span><input className="input" value={balance.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})} readOnly/></label>
          <Input label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={e=>set('vehicle_reg_no',e.target.value)}/>
          <Input label="Ledger No." value={form.ledger_no} onChange={e=>set('ledger_no',e.target.value)}/>
          <Input label="Chassis Record No." value={form.chassis_record_no} onChange={e=>set('chassis_record_no',e.target.value)}/>
          <Input label="Voucher No." value={form.voucher_no} onChange={e=>set('voucher_no',e.target.value)}/>
          <Input label="Subsidy Amount" type="number" min="0" value={form.subsidy_amount} onChange={e=>set('subsidy_amount',e.target.value)}/>
          <Input label="Sale Type" value={form.sale_type} onChange={e=>set('sale_type',e.target.value)}/>
          <Input label="DO No." value={form.do_no} onChange={e=>set('do_no',e.target.value)}/>
          <Text label="Internal Sale Details" value={form.internal_sale_details} onChange={e=>set('internal_sale_details',e.target.value)} style={{gridColumn:'1 / -1'}}/>
        </div>}

        {step===2&&<div className="formgrid">
          <Input label="GST Sale Amount" type="number" min="0" value={form.gst_sale_amount} onChange={e=>set('gst_sale_amount',e.target.value)} required/>
          <Input label="GST Rate %" type="number" min="0" value={form.gst_rate} onChange={e=>set('gst_rate',e.target.value)}/>
          <Input label="Insurance Amount" type="number" min="0" value={form.insurance_amount} onChange={e=>set('insurance_amount',e.target.value)}/>
          <Input label="Registration Amount" type="number" min="0" value={form.registration_amount} onChange={e=>set('registration_amount',e.target.value)}/>
          <Input label="Discount" type="number" min="0" value={form.discount} onChange={e=>set('discount',e.target.value)}/>
          <div className="card" style={{gridColumn:'1 / -1'}}><b>Vehicle / Internal Details</b><div className="muted" style={{marginTop:6}}>Dealer, chassis, model, colour, battery aur customer details Pending Sale ke saath save honge. <b>Bill No. field intentionally nahi hai.</b></div></div>
        </div>}
      </div>
      <div className="tiFooter"><div className="actions" style={{marginRight:'auto'}}><button type="button" className="btn" disabled={step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← Back</button><button type="button" className="btn" disabled={step===2} onClick={()=>setStep(s=>Math.min(2,s+1))}>Next →</button></div><div className="actions"><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Pending Sale'}</button></div></div>
    </form></div>}
  </div>;
}

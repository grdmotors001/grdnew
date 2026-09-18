'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const blankPerson = {
  full_name:'', phone:'', email:'', dob:'', gender:'', pan:'', aadhaar:'',
  occupation:'', monthly_income:'', pincode:'', city:'', state:'', address:'',
  relation_with_customer:'', remarks:''
};

function PersonFields({ value, setValue, title, relationLabel }) {
  const set=(k,v)=>setValue({...value,[k]:v});
  return <div className="card">
    <h2>{title}</h2>
    <div className="grid">
      <input className="input" placeholder="Full Name *" value={value.full_name} onChange={e=>set('full_name',e.target.value)} required/>
      <input className="input" placeholder="Phone Number *" value={value.phone} onChange={e=>set('phone',e.target.value.replace(/\D/g,'').slice(0,10))} required/>
      <input className="input" placeholder="Email" value={value.email} onChange={e=>set('email',e.target.value)}/>
      <input className="input" type="date" value={value.dob} onChange={e=>set('dob',e.target.value)}/>
      <select className="input" value={value.gender} onChange={e=>set('gender',e.target.value)}><option value="">Gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
      <input className="input" placeholder="PAN" maxLength={10} value={value.pan} onChange={e=>set('pan',e.target.value.toUpperCase())}/>
      <input className="input" placeholder="Aadhaar Number" maxLength={12} value={value.aadhaar} onChange={e=>set('aadhaar',e.target.value.replace(/\D/g,'').slice(0,12))}/>
      <input className="input" placeholder="Occupation" value={value.occupation} onChange={e=>set('occupation',e.target.value)}/>
      <input className="input" type="number" min="0" placeholder="Monthly Income" value={value.monthly_income} onChange={e=>set('monthly_income',e.target.value)}/>
      <input className="input" placeholder="Pincode" maxLength={6} value={value.pincode} onChange={e=>set('pincode',e.target.value.replace(/\D/g,'').slice(0,6))}/>
      <input className="input" placeholder="City" value={value.city} onChange={e=>set('city',e.target.value)}/>
      <input className="input" placeholder="State" value={value.state} onChange={e=>set('state',e.target.value)}/>
      {relationLabel && <input className="input" placeholder={relationLabel} value={value.relation_with_customer} onChange={e=>set('relation_with_customer',e.target.value)}/>}
      <textarea className="input" placeholder="Address" rows="3" value={value.address} onChange={e=>set('address',e.target.value)}/>
      <textarea className="input" placeholder="Remarks" rows="2" value={value.remarks} onChange={e=>set('remarks',e.target.value)}/>
    </div>
  </div>;
}

export function DealerNewLoanForm({ onBack }) {
  const [tab,setTab]=useState('borrower');
  const [borrower,setBorrower]=useState(blankPerson);
  const [guarantor,setGuarantor]=useState(blankPerson);
  const [coBorrower,setCoBorrower]=useState(blankPerson);
  const [customerId,setCustomerId]=useState('');
  const [customerSearch,setCustomerSearch]=useState('');
  const [customers,setCustomers]=useState([]);
  const [vehicleLoan,setVehicleLoan]=useState({vehicle_model_id:'',vehicle_price:'',down_payment:'',loan_amount_requested:'',tenure_months:''});
  const [registerPage,setRegisterPage]=useState('');
  const [saving,setSaving]=useState(false), [error,setError]=useState(''), [success,setSuccess]=useState(null);

  useEffect(()=>{
    let cancelled=false;
    const timer=setTimeout(()=>get('/dealer/customers?search='+encodeURIComponent(customerSearch))
      .then(d=>{if(!cancelled)setCustomers(d.customers||[])})
      .catch(()=>{}),250);
    return()=>{cancelled=true;clearTimeout(timer)};
  },[customerSearch]);

  function selectCustomer(c){
    setCustomerId(String(c.id));
    setBorrower({
      ...borrower, full_name:c.full_name||'', phone:c.phone||'', email:c.email||'',
      dob:c.dob||'', gender:c.gender||'', pan:c.pan||'', occupation:c.occupation||'',
      monthly_income:c.monthly_income||'', pincode:c.pincode||'', city:c.city||'',
      state:c.state||'', address:c.address||'', aadhaar:''
    });
    setCustomerSearch(c.full_name);
    setCustomers([]);
  }

  function setVehicle(k,v){
    const next={...vehicleLoan,[k]:v};
    if(k==='vehicle_price'||k==='down_payment'){
      next.loan_amount_requested=Math.max((Number(next.vehicle_price)||0)-(Number(next.down_payment)||0),0);
    }
    setVehicleLoan(next);
  }

  async function submit(){
    setError('');
    if(!borrower.full_name || !/^\d{10}$/.test(borrower.phone)){setError('Borrower name aur 10-digit phone required hai.');setTab('borrower');return;}
    if(!vehicleLoan.vehicle_price || !vehicleLoan.loan_amount_requested || !vehicleLoan.tenure_months){setError('Vehicle price, loan amount aur tenure required hai.');return;}
    setSaving(true);
    try{
      const d=await post('/dealer/submit-loan',{
        customer_id:customerId||null, borrower, guarantor, co_borrower,
        vehicle_loan:vehicleLoan, dealer_register_page_no:registerPage
      });
      setSuccess(d);
    }catch(e){setError(e.message||'Loan application save nahi hui.')}
    finally{setSaving(false);}
  }

  if(success) return <div className="card">
    <h2>Loan Application Submitted</h2>
    <p>Customer: <b>{success.customer?.full_name}</b></p>
    <p>Application No.: <b>{success.application_no}</b></p>
    <p>Dealer Register Page No.: <b>{registerPage||'—'}</b></p>
    <p className="muted">Borrower, Guarantor aur Co-Borrower CHFPL database mein save/link ho gaye.</p>
    <button className="btn primary" onClick={onBack}>Back to Dealer Portal</button>
  </div>;

  const tabs=[['borrower','Borrower / Customer / Applicant'],['guarantor','Guaranter'],['coBorrower','Co-Borrower']];

  return <div className="dealerPortal">
    <div className="dealerPortalHeader"><div><h1>New Loan Application</h1><div className="muted">Customer select karein; na mile to Submit par GRD mein automatically create hoga.</div></div><button className="btn" onClick={onBack}>Back</button></div>

    <div className="card">
      <h2>Customer</h2>
      <div style={{position:'relative'}}>
        <input className="input" placeholder="Customer Name type/search karein" value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);if(customerId)setCustomerId('')}} />
        {customers.length>0 && <div className="card" style={{position:'absolute',zIndex:20,left:0,right:0,top:'100%',padding:6,maxHeight:240,overflowY:'auto'}}>
          {customers.map(c=><button type="button" key={c.id} className="btn" style={{display:'block',width:'100%',textAlign:'left',marginBottom:4}} onClick={()=>selectCustomer(c)}>{c.full_name} · {c.phone}{c.pan?' · '+c.pan:''}</button>)}
        </div>}
      </div>
      <div className="muted" style={{marginTop:8}}>{customerId ? 'Existing GRD customer selected.' : 'Existing customer select nahi kiya to Submit par new customer auto-create hoga.'}</div>
    </div>

    <div className="dealerLoanTabs">
      {tabs.map(([key,label],i)=><button key={key} className={'btn'+(tab===key?' primary':'')} type="button" onClick={()=>setTab(key)}>{i+1}. {label}</button>)}
    </div>

    {tab==='borrower' && <PersonFields value={borrower} setValue={setBorrower} title="Borrower / Customer / Applicant" />}
    {tab==='guarantor' && <PersonFields value={guarantor} setValue={setGuarantor} title="Guaranter" relationLabel="Relation with Borrower" />}
    {tab==='coBorrower' && <PersonFields value={coBorrower} setValue={setCoBorrower} title="Co-Borrower" relationLabel="Relation with Borrower" />}

    <div className="card">
      <h2>Vehicle & Loan Details</h2>
      <div className="grid">
        <input className="input" placeholder="Vehicle Model / Model ID" value={vehicleLoan.vehicle_model_id} onChange={e=>setVehicle('vehicle_model_id',e.target.value)}/>
        <input className="input" type="number" min="0" placeholder="Vehicle Price" value={vehicleLoan.vehicle_price} onChange={e=>setVehicle('vehicle_price',e.target.value)}/>
        <input className="input" type="number" min="0" placeholder="Down Payment" value={vehicleLoan.down_payment} onChange={e=>setVehicle('down_payment',e.target.value)}/>
        <input className="input" readOnly placeholder="Loan Amount Requested" value={vehicleLoan.loan_amount_requested}/>
        <select className="input" value={vehicleLoan.tenure_months} onChange={e=>setVehicle('tenure_months',e.target.value)}><option value="">Tenure (Months)</option><option>12</option><option>18</option><option>24</option><option>30</option><option>36</option><option>48</option></select>
        <input className="input" placeholder="Dealer Register Page No. (sirf page no.)" value={registerPage} onChange={e=>setRegisterPage(e.target.value)}/>
      </div>
    </div>

    {error && <div className="error">{error}</div>}
    <div className="card"><button className="btn primary" type="button" disabled={saving} onClick={submit}>{saving?'Submitting…':'Submit Loan Application'}</button><span className="muted" style={{marginLeft:10}}>Submit par Customer + CHFPL Loan + Guarantor + Co-Borrower save honge.</span></div>
  </div>;
}

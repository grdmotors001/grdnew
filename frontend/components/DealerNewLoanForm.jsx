'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const blankPerson = {
  full_name:'', phone:'', email:'', dob:'', gender:'', pan:'', aadhaar:'',
  occupation:'', monthly_income:'', pincode:'', city:'', state:'', address:'',
  relation_with_customer:'', remarks:''
};

function PersonFields({ value, setValue, title, relationLabel, compact=false }) {
  const set=(k,v)=>setValue({...value,[k]:v});
  return <div className="dealerFormCard">
    <div className="dealerFormCardHead"><div><span className="dealerFormEyebrow">CUSTOMER DETAILS</span><h2>{title}</h2></div></div>
    <div className={'dealerPersonGrid'+(compact?' compact':'')}>
      <label>Full Name *<input className="input" placeholder="Enter full name" value={value.full_name} onChange={e=>set('full_name',e.target.value)} /></label>
      <label>Phone Number *<input className="input" inputMode="numeric" placeholder="10 digit mobile" value={value.phone} onChange={e=>set('phone',e.target.value.replace(/\D/g,'').slice(0,10))}/></label>
      <label>Email<input className="input" type="email" placeholder="Email address" value={value.email} onChange={e=>set('email',e.target.value)}/></label>
      <label>Date of Birth<input className="input" type="date" value={value.dob} onChange={e=>set('dob',e.target.value)}/></label>
      <label>Gender<select className="input" value={value.gender} onChange={e=>set('gender',e.target.value)}><option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
      <label>PAN<input className="input" maxLength={10} placeholder="ABCDE1234F" value={value.pan} onChange={e=>set('pan',e.target.value.toUpperCase())}/></label>
      <label>Aadhaar Number<input className="input" inputMode="numeric" maxLength={12} placeholder="12 digit Aadhaar" value={value.aadhaar} onChange={e=>set('aadhaar',e.target.value.replace(/\D/g,'').slice(0,12))}/></label>
      <label>Occupation<input className="input" placeholder="Occupation" value={value.occupation} onChange={e=>set('occupation',e.target.value)}/></label>
      <label>Monthly Income<input className="input" type="number" min="0" placeholder="₹ Monthly income" value={value.monthly_income} onChange={e=>set('monthly_income',e.target.value)}/></label>
      <label>Pincode<input className="input" inputMode="numeric" maxLength={6} placeholder="6 digit pincode" value={value.pincode} onChange={e=>set('pincode',e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
      <label>City<input className="input" placeholder="City" value={value.city} onChange={e=>set('city',e.target.value)}/></label>
      <label>State<input className="input" placeholder="State" value={value.state} onChange={e=>set('state',e.target.value)}/></label>
      {relationLabel && <label>{relationLabel}<input className="input" placeholder="Relation" value={value.relation_with_customer} onChange={e=>set('relation_with_customer',e.target.value)}/></label>}
      <label className="dealerSpan2">Address<textarea className="input" placeholder="Complete address" rows="3" value={value.address} onChange={e=>set('address',e.target.value)}/></label>
      <label className="dealerSpan2">Remarks<textarea className="input" placeholder="Optional remarks" rows="2" value={value.remarks} onChange={e=>set('remarks',e.target.value)}/></label>
    </div>
  </div>;
}

async function fileToDataUrl(file){
  // Vercel/serverless request bodies are limited; camera photos can easily be
  // several MB. Compress browser images before embedding them in JSON.
  if(String(file?.type||'').startsWith('image/')){
    try{
      const bitmap=await createImageBitmap(file);
      const max=1600;
      const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg',0.72);
    }catch{}
  }
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
}

export function DealerNewLoanForm({ onBack }) {
  const [step,setStep]=useState('borrower');
  const [borrower,setBorrower]=useState(blankPerson);
  const [guarantor,setGuarantor]=useState(blankPerson);
  const [coBorrower,setCoBorrower]=useState(blankPerson);
  const [customerId,setCustomerId]=useState('');
  const [customerSearch,setCustomerSearch]=useState('');
  const [customers,setCustomers]=useState([]);
  const [vehicleLoan,setVehicleLoan]=useState({vehicle_model_id:'',loan_amount_requested:'80000',tenure_months:'36'});
  const [loanType,setLoanType]=useState('NEW');
  const [loanMasters,setLoanMasters]=useState({models:[],loan_types:[]});
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(null);
  const [customerPhoto,setCustomerPhoto]=useState(null);
  const [documents,setDocuments]=useState([]);
  const [documentPreviews,setDocumentPreviews]=useState([]);

  useEffect(()=>{
    let cancelled=false;
    get('/dealer/loan-masters').then(d=>{
      if(cancelled)return;
      const masters=d||{};
      setLoanMasters(masters);
      setVehicleLoan(prev=>({
        ...prev,
        vehicle_model_id:prev.vehicle_model_id || String(masters.models?.[0]?.id || ''),
      }));
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const timer=setTimeout(()=>get('/dealer/customers?search='+encodeURIComponent(customerSearch))
      .then(d=>{if(!cancelled)setCustomers(d.customers||[])}).catch(()=>{}),250);
    return()=>{cancelled=true;clearTimeout(timer)};
  },[customerSearch]);

  function selectCustomer(c){
    setCustomerId(String(c.id));
    setBorrower({...borrower,full_name:c.full_name||'',phone:c.phone||'',email:c.email||'',dob:c.dob||'',gender:c.gender||'',pan:c.pan||'',occupation:c.occupation||'',monthly_income:c.monthly_income||'',pincode:c.pincode||'',city:c.city||'',state:c.state||'',address:c.address||'',aadhaar:''});
    setCustomerSearch(c.full_name);
    setCustomers([]);
  }

  function setVehicle(k,v){
    setVehicleLoan(prev=>({...prev,[k]:v}));
  }

  async function submit(){
    setError('');
    if(!borrower.full_name||!/^[0-9]{10}$/.test(borrower.phone)){setError('Borrower name aur 10-digit phone required hai.');setStep('borrower');return;}
    if(!/^[0-9]{12}$/.test(borrower.aadhaar||'')){setError('12-digit Aadhaar required hai.');setStep('borrower');return;}
    if(!customerPhoto){setError('Customer photo mandatory hai.');setStep('borrower');return;}
    if(!documents.length){setError('At least one customer document mandatory hai.');setStep('borrower');return;}
    if(!vehicleLoan.loan_amount_requested||!vehicleLoan.tenure_months){setError('Loan amount aur tenure mandatory hai.');setStep('loan');return;}
    setSaving(true);
    try{
      const photoData=customerPhoto ? await fileToDataUrl(customerPhoto) : null;
      const documentData=await Promise.all(documents.map(async f=>({
        name:f.name,
        type:String(f.type||'application/octet-stream').startsWith('image/')?'image/jpeg':f.type,
        data_url:await fileToDataUrl(f)
      })));
      const approxBytes=[photoData,...documentData.map(x=>x.data_url)].filter(Boolean)
        .reduce((n,x)=>n+Math.ceil(String(x).length*0.75),0);
      if(approxBytes>3*1024*1024){
        throw new Error('Photo/documents ka total size 3 MB se kam rakhein. Mobile photo automatically compress hoti hai.');
      }
      const d=await post('/dealer/submit-loan',{
        customer_id:customerId||null,borrower,guarantor,co_borrower:coBorrower,vehicle_loan:vehicleLoan,
        loan_type:loanType,
        customer_photo:customerPhoto ? {name:customerPhoto.name,type:'image/jpeg',data_url:photoData} : null,
        documents:documentData
      }, { timeoutMs: 60000 });
      setSuccess(d);
    }catch(e){setError(e.message||'Loan application save nahi hui.')}
    finally{setSaving(false);}
  }

  if(success) return <div className="dealerLoanPage"><div className="dealerSuccessCard">
    <div className="dealerSuccessIcon">✓</div><span className="dealerFormEyebrow">APPLICATION SAVED</span><h1>Loan Application Submitted</h1>
    <div className="dealerSuccessGrid"><div><small>Customer</small><b>{success.customer?.full_name||borrower.full_name}</b></div><div><small>Application No.</small><b>{success.application_no||'Pending CHFPL sync'}</b></div></div>
    <p className="muted">Borrower, Guaranter aur Co-Borrower details submission ke saath linked hain.</p><button className="btn primary" onClick={onBack}>Back to Dealer Dashboard</button>
  </div></div>;

  const steps=[
    ['borrower','01','Borrower','Customer / Applicant'],
    ['guarantor','02','Guaranter','Required party details'],
    ['coBorrower','03','Co-Borrower','Optional party details'],
    ['loan','04','Loan','Vehicle & loan details']
  ];

  return <div className="dealerLoanPage">
    <div className="dealerLoanTop"><div><button className="dealerBackBtn" onClick={onBack}>← Back to Dashboard</button><span className="dealerFormEyebrow">DEALER WORKSPACE</span><h1>New Loan Application</h1><p>Create/select customer, enter loan details, then submit once.</p></div><div className="dealerDraftBadge">Dealer Form</div></div>

    <div className="dealerStepBar">{steps.map(([key,no,label,sub])=><button key={key} className={'dealerStep'+(step===key?' active':'')+(steps.findIndex(x=>x[0]===step)>steps.findIndex(x=>x[0]===key)?' done':'')} onClick={()=>setStep(key)}><span>{no}</span><div><b>{label}</b><small>{sub}</small></div></button>)}</div>

    <div className="dealerLoanLayout">
      <div className="dealerLoanMain">
        <div className="dealerCustomerPicker">
          <div><span className="dealerFormEyebrow">CUSTOMER LINK</span><h2>Find Existing Customer</h2><p>Select an existing GRD customer or enter a new borrower below.</p></div>
          <div className="dealerSearchWrap"><span>⌕</span><input className="input" placeholder="Search name, mobile or PAN…" value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);if(customerId)setCustomerId('')}} />
            {customers.length>0&&<div className="dealerCustomerResults">{customers.map(c=><button type="button" key={c.id} onClick={()=>selectCustomer(c)}><b>{c.full_name}</b><span>{c.phone}{c.pan?' · '+c.pan:''}</span></button>)}</div>}
          </div>
          <div className={'dealerCustomerStatus '+(customerId?'selected':'')}>{customerId?'✓ Existing GRD customer selected':'＋ No customer selected — Submit will create the customer in GRD'}</div>
        </div>

        {step==='borrower'&&<><PersonFields value={borrower} setValue={setBorrower} title="Borrower / Customer / Applicant"/><div className="dealerFormCard"><div className="dealerFormCardHead"><div><span className="dealerFormEyebrow">KYC DOCUMENTS</span><h2>Photo & Documents</h2></div></div><div className="dealerPersonGrid"><label>Customer Photo *<input className="input" type="file" accept="image/*" capture="environment" onChange={e=>setCustomerPhoto(e.target.files?.[0]||null)} required/><small className="muted">Customer photo required</small></label><label className="dealerSpan2">Documents *<input className="input" type="file" multiple accept="image/*,.pdf" onChange={e=>{const files=Array.from(e.target.files||[]);setDocuments(files);setDocumentPreviews(files.map(f=>f.name));}} required/><small className="muted">KYC/other required documents upload karein</small>{documentPreviews.length>0&&<div className="muted" style={{marginTop:6}}>{documentPreviews.join(' • ')}</div>}</label></div></div></>}
        {step==='guarantor'&&<PersonFields value={guarantor} setValue={setGuarantor} title="Guaranter" relationLabel="Relation with Borrower"/>}
        {step==='coBorrower'&&<PersonFields value={coBorrower} setValue={setCoBorrower} title="Co-Borrower" relationLabel="Relation with Borrower" compact/>}
        {step==='loan'&&<LoanDetails vehicleLoan={vehicleLoan} setVehicle={setVehicle} loanType={loanType} setLoanType={setLoanType} loanMasters={loanMasters}/>}

        {error&&<div className="error dealerError">{error}</div>}
        <div className="dealerFormFooter"><button className="btn" type="button" onClick={onBack}>Cancel</button><div className="dealerFooterRight">
          {step!=='loan'&&<button className="btn" type="button" onClick={()=>setStep(steps[steps.findIndex(x=>x[0]===step)+1][0])}>Continue →</button>}
          {step==='loan'&&<button className="dealerSubmitBtn" type="button" disabled={saving} onClick={submit}>{saving?'Submitting…':'✓ Submit Loan Application'}</button>}
        </div></div>
      </div>

      <aside className="dealerLoanSide">
        <div className="dealerSideCard"><span className="dealerFormEyebrow">APPLICATION SUMMARY</span><h3>At a glance</h3>
          <div className="dealerSummaryRow"><span>Customer</span><b>{borrower.full_name||'Not entered'}</b></div>
          <div className="dealerSummaryRow"><span>Phone</span><b>{borrower.phone||'—'}</b></div>
          
          <div className="dealerSummaryRow"><span>Loan Amount</span><b>₹ {(Number(vehicleLoan.loan_amount_requested)||0).toLocaleString('en-IN')}</b></div>
          <div className="dealerSummaryRow"><span>Tenure</span><b>{vehicleLoan.tenure_months ? `${vehicleLoan.tenure_months} Months` : '—'}</b></div>
        </div>
        <div className="dealerSideCard dealerTip"><b>Important</b><p>Model Name, loan amount aur tenure submit ke saath CHFPL loan application mein linked honge.</p></div>
      </aside>
    </div>
  </div>;
}

function LoanDetails({vehicleLoan,setVehicle,loanType,setLoanType,loanMasters}){
  const setV=(k,v)=>setVehicle(k,v);
  return <div className="dealerLoanDetails">
    <div className="dealerFormCard"><div className="dealerFormCardHead"><div><span className="dealerFormEyebrow">VEHICLE & LOAN</span><h2>Loan Details</h2></div></div>
      <div className="dealerPersonGrid"><label>Loan Type *<select className="input" value={loanType} onChange={e=>setLoanType(e.target.value)}><option value="NEW">NEW MODEL</option><option value="OLD">OLD MODEL</option></select></label>
      <label>Model Name *<select className="input" value={vehicleLoan.vehicle_model_id} onChange={e=>setV('vehicle_model_id',e.target.value)}><option value="">Select model</option>{(loanMasters.models||[]).map(m=><option key={m.id} value={m.id}>{m.name}{m.code?' · '+m.code:''}</option>)}</select></label>
      <label>Loan Amount Requested *<input className="input" type="number" min="1" placeholder="₹ Loan amount" value={vehicleLoan.loan_amount_requested} onChange={e=>setV('loan_amount_requested',e.target.value)}/></label>
      <label>Tenure (Months) *<select className="input" value={vehicleLoan.tenure_months} onChange={e=>setV('tenure_months',e.target.value)}><option value="">Select tenure</option>{[12,18,24,30,36,48].map(x=><option key={x}>{x}</option>)}</select></label>
      </div>
    </div>
  </div>;
}

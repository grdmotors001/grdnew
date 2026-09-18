'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function DealerNewLoanForm({ onBack }) {
  const [step,setStep]=useState('borrower');
  const [borrower,setBorrower]=useState(blankPerson);
  const [guarantor,setGuarantor]=useState(blankPerson);
  const [coBorrower,setCoBorrower]=useState(blankPerson);
  const [customerId,setCustomerId]=useState('');
  const [customerSearch,setCustomerSearch]=useState('');
  const [customers,setCustomers]=useState([]);
  const [vehicleLoan,setVehicleLoan]=useState({vehicle_model_id:'',vehicle_price:'',down_payment:'',loan_amount_requested:'',tenure_months:''});
  const [sale,setSale]=useState({sale_amount:'',file_charge:'',booking_amount:'',register_page_no:''});
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(null);

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
    const next={...vehicleLoan,[k]:v};
    if(k==='vehicle_price'||k==='down_payment') next.loan_amount_requested=Math.max((Number(next.vehicle_price)||0)-(Number(next.down_payment)||0),0);
    setVehicleLoan(next);
  }

  const totalDeal=useMemo(()=>Math.max((Number(sale.sale_amount)||0)+(Number(sale.file_charge)||0),0),[sale]);
  const balance=useMemo(()=>Math.max(totalDeal-(Number(vehicleLoan.loan_amount_requested)||0)-(Number(sale.booking_amount)||0),0),[totalDeal,vehicleLoan.loan_amount_requested,sale.booking_amount]);

  async function submit(){
    setError('');
    if(!borrower.full_name||!/^[0-9]{10}$/.test(borrower.phone)){setError('Borrower name aur 10-digit phone required hai.');setStep('borrower');return;}
    if(!vehicleLoan.vehicle_price||!vehicleLoan.loan_amount_requested||!vehicleLoan.tenure_months){setError('Vehicle price, loan amount aur tenure required hai.');setStep('loan');return;}
    setSaving(true);
    try{
      const d=await post('/dealer/submit-loan',{
        customer_id:customerId||null,borrower,guarantor,co_borrower,vehicle_loan:vehicleLoan,
        dealer_register_page_no:sale.register_page_no,
        sale_details:{sale_amount:Number(sale.sale_amount)||0,file_charge:Number(sale.file_charge)||0,total_deal_amount:totalDeal,booking_amount:Number(sale.booking_amount)||0,balance_before_billing:balance}
      });
      setSuccess(d);
    }catch(e){setError(e.message||'Loan application save nahi hui.')}
    finally{setSaving(false);}
  }

  if(success) return <div className="dealerLoanPage"><div className="dealerSuccessCard">
    <div className="dealerSuccessIcon">✓</div><span className="dealerFormEyebrow">APPLICATION SAVED</span><h1>Loan Application Submitted</h1>
    <div className="dealerSuccessGrid"><div><small>Customer</small><b>{success.customer?.full_name||borrower.full_name}</b></div><div><small>Application No.</small><b>{success.application_no||'Pending CHFPL sync'}</b></div><div><small>Dealer Register Page</small><b>{sale.register_page_no||'—'}</b></div><div><small>Balance Before Billing</small><b>₹ {balance.toLocaleString('en-IN')}</b></div></div>
    <p className="muted">Borrower, Guaranter aur Co-Borrower details submission ke saath linked hain.</p><button className="btn primary" onClick={onBack}>Back to Dealer Dashboard</button>
  </div></div>;

  const steps=[
    ['borrower','01','Borrower','Customer / Applicant'],
    ['guarantor','02','Guaranter','Required party details'],
    ['coBorrower','03','Co-Borrower','Optional party details'],
    ['loan','04','Loan & Sale','Vehicle, booking & register']
  ];

  return <div className="dealerLoanPage">
    <div className="dealerLoanTop"><div><button className="dealerBackBtn" onClick={onBack}>← Back to Dashboard</button><span className="dealerFormEyebrow">DEALER WORKSPACE</span><h1>New Loan Application</h1><p>Create/select customer, enter sale & loan details, then submit once.</p></div><div className="dealerDraftBadge">Dealer Form</div></div>

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

        {step==='borrower'&&<PersonFields value={borrower} setValue={setBorrower} title="Borrower / Customer / Applicant"/>}
        {step==='guarantor'&&<PersonFields value={guarantor} setValue={setGuarantor} title="Guaranter" relationLabel="Relation with Borrower"/>}
        {step==='coBorrower'&&<PersonFields value={coBorrower} setValue={setCoBorrower} title="Co-Borrower" relationLabel="Relation with Borrower" compact/>}
        {step==='loan'&&<LoanAndSale vehicleLoan={vehicleLoan} setVehicle={setVehicle} sale={sale} setSale={setSale} totalDeal={totalDeal} balance={balance}/>}

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
          <div className="dealerSummaryRow"><span>Vehicle Price</span><b>₹ {(Number(vehicleLoan.vehicle_price)||0).toLocaleString('en-IN')}</b></div>
          <div className="dealerSummaryRow"><span>Loan Amount</span><b>₹ {(Number(vehicleLoan.loan_amount_requested)||0).toLocaleString('en-IN')}</b></div>
          <div className="dealerSummaryRow"><span>Total Deal</span><b>₹ {totalDeal.toLocaleString('en-IN')}</b></div>
          <div className="dealerSummaryRow"><span>Booking</span><b>₹ {(Number(sale.booking_amount)||0).toLocaleString('en-IN')}</b></div>
          <div className="dealerSummaryTotal"><span>Balance Before Billing</span><strong>₹ {balance.toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="dealerSideCard dealerTip"><b>Important</b><p>Dealer Register Page No. physical register ke page number ko represent karta hai. Ye system Application No. se alag hai.</p></div>
      </aside>
    </div>
  </div>;
}

function LoanAndSale({vehicleLoan,setVehicle,sale,setSale,totalDeal,balance}){
  const setV=(k,v)=>{const next={...vehicleLoan,[k]:v};if(k==='vehicle_price'||k==='down_payment')next.loan_amount_requested=Math.max((Number(next.vehicle_price)||0)-(Number(next.down_payment)||0),0);setVehicle(k,v)};
  const setS=(k,v)=>setSale({...sale,[k]:v});
  return <div className="dealerLoanDetails">
    <div className="dealerFormCard"><div className="dealerFormCardHead"><div><span className="dealerFormEyebrow">VEHICLE & LOAN</span><h2>Loan Details</h2></div></div>
      <div className="dealerPersonGrid"><label>Vehicle Model / Model ID<input className="input" placeholder="Model / Model ID" value={vehicleLoan.vehicle_model_id} onChange={e=>setV('vehicle_model_id',e.target.value)}/></label>
      <label>Vehicle Price *<input className="input" type="number" min="0" placeholder="₹ Vehicle price" value={vehicleLoan.vehicle_price} onChange={e=>setV('vehicle_price',e.target.value)}/></label>
      <label>Down Payment<input className="input" type="number" min="0" placeholder="₹ Down payment" value={vehicleLoan.down_payment} onChange={e=>setV('down_payment',e.target.value)}/></label>
      <label>Loan Amount Requested *<input className="input" readOnly value={vehicleLoan.loan_amount_requested} placeholder="Auto calculated"/></label>
      <label>Tenure (Months) *<select className="input" value={vehicleLoan.tenure_months} onChange={e=>setV('tenure_months',e.target.value)}><option value="">Select tenure</option>{[12,18,24,30,36,48].map(x=><option key={x}>{x}</option>)}</select></label>
      </div>
    </div>
    <div className="dealerFormCard"><div className="dealerFormCardHead"><div><span className="dealerFormEyebrow">SALE / BOOKING REGISTER</span><h2>Deal & Booking</h2></div><span className="dealerFormula">Sale + File Charge = Total Deal</span></div>
      <div className="dealerPersonGrid"><label>Sale Amount<input className="input" type="number" min="0" placeholder="₹ 150000" value={sale.sale_amount} onChange={e=>setS('sale_amount',e.target.value)}/></label>
      <label>File Charge<input className="input" type="number" min="0" placeholder="₹ 3000" value={sale.file_charge} onChange={e=>setS('file_charge',e.target.value)}/></label>
      <label>Booking Amount<input className="input" type="number" min="0" placeholder="₹ 10000" value={sale.booking_amount} onChange={e=>setS('booking_amount',e.target.value)}/></label>
      <label>Dealer Record / Register Page No.<input className="input" maxLength={50} placeholder="Physical register page no." value={sale.register_page_no} onChange={e=>setS('register_page_no',e.target.value)}/></label>
      </div>
      <div className="dealerDealSummary"><div><span>Total Deal Amount</span><b>₹ {totalDeal.toLocaleString('en-IN')}</b></div><div><span>Loan Amount</span><b>₹ {(Number(vehicleLoan.loan_amount_requested)||0).toLocaleString('en-IN')}</b></div><div><span>Booking Received</span><b>₹ {(Number(sale.booking_amount)||0).toLocaleString('en-IN')}</b></div><div className="balance"><span>Balance Before Billing</span><strong>₹ {balance.toLocaleString('en-IN')}</strong></div></div>
    </div>
  </div>;
}

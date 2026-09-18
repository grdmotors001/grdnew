'use client';

import { useState } from 'react';

const blankPerson = {
  full_name: '', phone: '', email: '', dob: '', gender: '', pan: '',
  aadhaar: '', occupation: '', monthly_income: '', pincode: '', city: '',
  state: '', address: '', relation: '', remarks: ''
};

function PersonFields({ value, setValue, title, subtitle }) {
  const set = (key, val) => setValue({ ...value, [key]: val });
  return (
    <div className="card dealerLoanPersonCard">
      <div className="dealerLoanSectionHead">
        <div><h2>{title}</h2>{subtitle && <div className="muted">{subtitle}</div>}</div>
      </div>
      <div className="grid dealerLoanFormGrid">
        <label>Full Name *<input className="input" placeholder="As per PAN / Aadhaar" value={value.full_name} onChange={e=>set('full_name',e.target.value)} /></label>
        <label>Phone Number *<input className="input" placeholder="10-digit mobile number" value={value.phone} onChange={e=>set('phone',e.target.value)} /></label>
        <label>Email<input className="input" placeholder="name@example.com" value={value.email} onChange={e=>set('email',e.target.value)} /></label>
        <label>Date of Birth *<input className="input" type="date" value={value.dob} onChange={e=>set('dob',e.target.value)} /></label>
        <label>Gender<select className="input" value={value.gender} onChange={e=>set('gender',e.target.value)}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label>
        <label>PAN *<input className="input" placeholder="ABCDE1234F" value={value.pan} onChange={e=>set('pan',e.target.value.toUpperCase())} /></label>
        <label>Aadhaar Number *<input className="input" inputMode="numeric" maxLength={12} placeholder="12-digit Aadhaar number" value={value.aadhaar} onChange={e=>set('aadhaar',e.target.value.replace(/\D/g,'').slice(0,12))} /></label>
        <label>Occupation<input className="input" placeholder="e.g. Driver, Shop owner" value={value.occupation} onChange={e=>set('occupation',e.target.value)} /></label>
        <label>Monthly Income<input className="input" type="number" min="0" placeholder="₹" value={value.monthly_income} onChange={e=>set('monthly_income',e.target.value)} /></label>
        <label>Pincode *<input className="input" inputMode="numeric" maxLength={6} placeholder="6-digit pincode" value={value.pincode} onChange={e=>set('pincode',e.target.value.replace(/\D/g,'').slice(0,6))} /></label>
        <label>City<input className="input" value={value.city} onChange={e=>set('city',e.target.value)} /></label>
        <label>State<input className="input" value={value.state} onChange={e=>set('state',e.target.value)} /></label>
        <label className="dealerLoanFull">Address *<textarea className="input" rows="3" value={value.address} onChange={e=>set('address',e.target.value)} /></label>
        {title !== 'Borrower / Customer / Applicant' && <label>Relation with Borrower<input className="input" placeholder="e.g. Father / Brother / Wife" value={value.relation} onChange={e=>set('relation',e.target.value)} /></label>}
        <label className="dealerLoanFull">Remarks<textarea className="input" rows="2" value={value.remarks} onChange={e=>set('remarks',e.target.value)} /></label>
      </div>
    </div>
  );
}

export function DealerNewLoanForm() {
  const [tab, setTab] = useState('borrower');
  const [borrower, setBorrower] = useState(blankPerson);
  const [guarantor, setGuarantor] = useState(blankPerson);
  const [coBorrower, setCoBorrower] = useState(blankPerson);
  const [registerPage, setRegisterPage] = useState('');

  const tabs = [
    ['borrower', 'Borrower / Customer / Applicant'],
    ['guarantor', 'Guaranter'],
    ['coBorrower', 'Co-Borrower'],
  ];

  return (
    <div className="dealerPortal">
      <header className="dealerPortalHeader">
        <div><h1>New Loan Application</h1><div className="muted">Dealer form — data submission is disabled for now</div></div>
      </header>

      <div className="card dealerLoanNotice">
        <b>Dealer Register Page No.</b>
        <span className="muted"> — Physical register ka sirf Page No.</span>
        <input className="input" style={{maxWidth:220, marginTop:8}} placeholder="Page No." value={registerPage} onChange={e=>setRegisterPage(e.target.value)} />
        <div className="muted" style={{marginTop:6}}>Application No. loan submit hone par future mein system generate karega.</div>
      </div>

      <div className="dealerLoanTabs">
        {tabs.map(([key,label], index) => (
          <button key={key} type="button" className={'btn' + (tab===key ? ' primary' : '')} onClick={()=>setTab(key)}>
            {index+1}. {label}
          </button>
        ))}
      </div>

      {tab === 'borrower' && <PersonFields value={borrower} setValue={setBorrower} title="Borrower / Customer / Applicant" subtitle="Customer details — existing customer selection / auto-create will be connected when submission is enabled." />}
      {tab === 'guarantor' && <PersonFields value={guarantor} setValue={setGuarantor} title="Guaranter" subtitle="Guarantor details." />}
      {tab === 'coBorrower' && <PersonFields value={coBorrower} setValue={setCoBorrower} title="Co-Borrower" subtitle="Co-borrower details." />}

      <div className="card dealerLoanVehicleCard">
        <h2>Vehicle & Loan Details</h2>
        <div className="grid dealerLoanFormGrid">
          <label>Vehicle Model *<select className="input"><option>Select model</option></select></label>
          <label>Vehicle Price *<input className="input" type="number" min="0" placeholder="₹" /></label>
          <label>Down Payment<input className="input" type="number" min="0" placeholder="₹" /></label>
          <label>Loan Amount Requested<input className="input" type="number" min="0" placeholder="₹" /></label>
          <label>Tenure (Months) *<select className="input"><option>Select tenure</option><option>12</option><option>24</option><option>36</option><option>48</option><option>60</option></select></label>
          <label>Dealer Register Page No.<input className="input" placeholder="Physical register Page No." value={registerPage} onChange={e=>setRegisterPage(e.target.value)} /></label>
        </div>
      </div>

      <div className="card dealerLoanDisabledSubmit">
        <button className="btn" type="button" disabled>Submit Loan Application (Coming Soon)</button>
        <span className="muted">Filhal form-only mode: koi data submit/save nahi hoga.</span>
      </div>
    </div>
  );
}

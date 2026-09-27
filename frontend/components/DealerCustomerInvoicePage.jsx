'use client';
import {useEffect,useState} from 'react';
import {post} from '../lib/api';

export function DealerCustomerInvoicePage({challan,onBack,dealer}){
 const [f,setF]=useState({buyer_name:'',buyer_father_name:'',buyer_mobile:'',buyer_address:'',buyer_gst_no:'',buyer_pan:'',sale_amount:'',gst_rate:'',discount:'',amount_received:'',bank_name:'',bank_account_no:'',bank_ifsc:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ok,setOk]=useState(null);
 useEffect(()=>{if(challan)setF(x=>({...x,sale_amount:challan.sale_value||'',gst_rate:challan.gst_rate||'',bank_name:dealer?.bank_name||'',bank_account_no:dealer?.bank_account_no||'',bank_ifsc:dealer?.bank_ifsc||''}))},[challan,dealer]);
 const set=(k,v)=>setF(x=>({...x,[k]:v}));
 async function save(e){e.preventDefault();if(!challan)return;setBusy(true);setError('');try{const r=await post('/dealer/customer-invoice',{challan_id:challan.id,...f});setOk(r)}catch(e){setError(e.message)}finally{setBusy(false)}}
 if(ok)return <div className="dealerSuccessCard"><div className="dealerSuccessIcon">✓</div><h1>Invoice Created</h1><p>Invoice No.: <b>{ok.bill_no||'Saved'}</b></p><p>Chassis: <b>{ok.chassis_no}</b></p><button className="btn primary" onClick={onBack}>Back to Purchases</button></div>;
 return <div className="dealerLoanPage">
  <div className="dealerLoanTop"><div><button className="dealerBackBtn" onClick={onBack}>← Back</button><span className="dealerFormEyebrow">REGISTERED DEALER</span><h1>Create Invoice</h1><p>Customer details, vehicle details and your registered dealer bank details.</p></div></div>
  {error&&<div className="error dealerError">{error}</div>}
  {challan&&<div className="dealerSideCard" style={{marginBottom:14}}><b>{challan.product_name}</b> · {challan.chassis_no} · Challan {challan.challan_no}</div>}
  <form className="dealerFormCard" onSubmit={save}>
   <h3>Customer Details</h3><div className="dealerPersonGrid">
    <label>Customer Name *<input className="input" required value={f.buyer_name} onChange={e=>set('buyer_name',e.target.value)}/></label>
    <label>Father Name<input className="input" value={f.buyer_father_name} onChange={e=>set('buyer_father_name',e.target.value)}/></label>
    <label>Mobile<input className="input" value={f.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/></label>
    <label>GSTIN<input className="input" value={f.buyer_gst_no} onChange={e=>set('buyer_gst_no',e.target.value.toUpperCase())}/></label>
    <label>PAN<input className="input" value={f.buyer_pan} onChange={e=>set('buyer_pan',e.target.value.toUpperCase())}/></label>
    <label className="dealerSpan2">Address<textarea className="input" rows="3" value={f.buyer_address} onChange={e=>set('buyer_address',e.target.value)}/></label>
   </div>
   <h3 style={{marginTop:20}}>Vehicle Details</h3><div className="dealerPersonGrid">
    <label>Model<input className="input" value={challan?.product_name||''} readOnly/></label>
    <label>Chassis No.<input className="input" value={challan?.chassis_no||''} readOnly/></label>
    <label>Motor No.<input className="input" value={challan?.motor_no||''} readOnly/></label>
    <label>Controller No.<input className="input" value={challan?.controller_no||''} readOnly/></label>
    <label>Colour<input className="input" value={challan?.colour||''} readOnly/></label>
   </div>
   <h3 style={{marginTop:20}}>Invoice Details</h3><div className="dealerPersonGrid">
    <label>Sale Amount<input className="input" type="number" min="0" value={f.sale_amount} onChange={e=>set('sale_amount',e.target.value)}/></label>
    <label>GST Rate %<input className="input" type="number" min="0" value={f.gst_rate} onChange={e=>set('gst_rate',e.target.value)}/></label>
    <label>Discount<input className="input" type="number" min="0" value={f.discount} onChange={e=>set('discount',e.target.value)}/></label>
    <label>Amount Received<input className="input" type="number" min="0" value={f.amount_received} onChange={e=>set('amount_received',e.target.value)}/></label>
   </div>
   <h3 style={{marginTop:20}}>Registered Dealer Bank Details</h3><div className="dealerPersonGrid">
    <label>Bank Name<input className="input" value={f.bank_name} onChange={e=>set('bank_name',e.target.value)}/></label>
    <label>Account No.<input className="input" value={f.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/></label>
    <label>IFSC<input className="input" value={f.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value.toUpperCase())}/></label>
   </div>
   <button className="dealerSubmitBtn" disabled={busy}>{busy?'Saving…':'✓ Create Invoice'}</button>
  </form>
 </div>;
}

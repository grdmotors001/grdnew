'use client';

import { useEffect, useRef, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, Money } from './ui';
import { ProformaInvoicePrintView } from './PrintDocs';
import { relationOptionsFor, b2cIdError, isB2C, useInvoiceMasters, RtoSelect, buyerStateCode, stateFields, stateOptionsFor, stateValueFor, useAutoStateType, STATE_TYPE_OPTIONS, normPincode, pincodeError, STATE_REQUIRED_MSG } from './invoiceHelpers';

// Old Rickshaw / Battery sales are not GST sales: no Tax Invoice, they are completed after approval.
const isNonGst=t=>['OLD RICKSHAW','BATTERY'].includes(String(t||'').toUpperCase());

export function BillingPendingSalesPage(){
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');
  const [createOpen,setCreateOpen]=useState(false);
  const [invoiceSale,setInvoiceSale]=useState(null),[view,setView]=useState('PENDING'),[canApprove,setCanApprove]=useState(false);
  const [proformaId,setProformaId]=useState(null);
  const [sheet,setSheet]=useState(null); // {mode:'view'|'edit', sale}

  const load=async(openId)=>{
    setLoading(true);setError('');
    try{const r=await get('/billing/pending-sales');const list=r.applications||[];setRows(list);setCanApprove(Boolean(r.can_approve));
      if(openId){const x=list.find(y=>Number(y.id)===Number(openId));if(x){setView(x.status);setSheet({mode:'view',sale:x})}}}
    catch(e){setError(e.message||'Could not load Pending Sales')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  // Approve sirf 'Open for Approve' form ke andar se hota hai (list me direct Approve button nahi).
  const approve=async id=>{
    if(!confirm('Approve this Pending Sale? Approve ke baad Sale Amount / Loan Amount change nahi honge aur sale delete nahi hogi.'))return false;
    try{await post('/billing/pending-sales/'+id+'/approve',{});load();return true}catch(e){setError(e.message);return false}
  };
  const removeSale=async r=>{
    if(!confirm('Delete this Pending Sale?'))return;
    try{await del('/billing/pending-sales/'+r.id);load()}catch(e){setError(e.message)}
  };
  const completeSale=async id=>{
    if(!confirm('Complete this sale? (Old Rickshaw / Battery: GST Tax Invoice nahi banega)'))return;
    try{await post('/billing/pending-sales/'+id+'/complete',{});load()}catch(e){setError(e.message)}
  };
  const openSale=async id=>{
    try{const r=await get('/billing/pending-sales/invoice?id='+id);setInvoiceSale({...r,id})}
    catch(e){setError(e.message||'Could not open Tax Invoice')}
  };
  const q=search.trim().toLowerCase();
  const shown=rows.filter(r=>r.status===view && (!q||[r.application_no,r.application_id,r.dealer_name,r.customer_name,r.chassis_no,r.vehicle_reg_no,r.description,r.sale_type,r.status].join(' ').toLowerCase().includes(q)));

  return <div className="page">
    <div className="pageHeader">
      <div><h2>Pending Bills / Billing</h2><p className="muted">Pending Sales (Print Proforma) → Open for Approve → Approved Sales → Create Sale → bill Tax Invoice menu me aata hai (Bill No. sirf New Rickshaw par).</p></div>
      <div style={{display:'flex',gap:8}}><button className="btn primary" onClick={()=>setCreateOpen(true)}>+ Create Pending Sale</button><button className="btn" onClick={load}>↻ Refresh</button></div>
    </div>
    <ErrorBanner message={error}/>
    <div className="card">
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <button className={'btn '+(view==='PENDING'?'primary':'')} onClick={()=>setView('PENDING')}>Pending Sales</button>
        <button className={'btn '+(view==='APPROVED'?'primary':'')} onClick={()=>setView('APPROVED')}>Approved Sales</button>
      </div>
      <input className="input" style={{width:'100%',maxWidth:480,margin:'0 0 12px'}} placeholder="Search application, dealer, customer, chassis…" value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Application / SP No.</th><th>Dealer</th><th>Customer</th><th>Chassis / Reg. No.</th><th>Description</th><th>Sale Amount</th><th>Status</th><th>Action</th>
      </tr></thead><tbody>
      {shown.map(r=><tr key={r.id}>
        <td><b>{r.application_no||r.application_id||r.sp_no||('#'+r.id)}</b></td><td>{r.dealer_name||'—'}</td><td>{r.customer_name||'—'}</td>
        <td>{r.chassis_no||r.vehicle_reg_no||'—'}</td>
        <td>{isNonGst(r.sale_type)&&<b>{r.sale_type} · </b>}{r.description||'—'}</td><td><Money value={r.sale_amount}/></td>
        <td><b>{r.status}</b></td>
        <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {r.status==='PENDING'&&!isNonGst(r.sale_type)&&<button className="btn" onClick={()=>setProformaId(r.id)}>🖨 Print Proforma</button>}
            {r.status==='PENDING'&&!canApprove&&<button className="btn" onClick={()=>setSheet({mode:'view',sale:r})}>View</button>}
            {r.status==='PENDING'&&canApprove&&<>
              <button className="btn primary" onClick={()=>setSheet({mode:'view',sale:r})}>Open for Approve</button>
              <button className="btn" onClick={()=>setSheet({mode:'edit',sale:r})}>Edit</button>
              <button className="btn" onClick={()=>removeSale(r)}>Delete</button></>}
            {r.status==='APPROVED'&&<button className="btn" onClick={()=>setSheet({mode:'view',sale:r})}>View</button>}
            {r.status==='APPROVED'&&canApprove&&<button className="btn" onClick={()=>setSheet({mode:'edit',sale:r})}>Edit</button>}
            {r.status==='APPROVED'&&canApprove&&(isNonGst(r.sale_type)
              ?<button className="btn primary" onClick={()=>completeSale(r.id)}>Complete Sale (No Bill)</button>
              :<button className="btn primary" onClick={()=>openSale(r.id)}>Create Sale</button>)}
        </div></td>
      </tr>)}
      {!loading&&!shown.length&&<tr><td colSpan="8" className="muted">No {view==='APPROVED'?'Approved':'Pending'} Sales.</td></tr>}
      </tbody></table></div>
      {loading&&<div className="muted" style={{padding:16}}>Loading…</div>}
    </div>
    {createOpen&&<CreatePendingSale canPickFinancer={canApprove} onClose={()=>setCreateOpen(false)} onSaved={(res)=>{setCreateOpen(false);load(res?.sale?.id)}}/>}
    {sheet&&<CreatePendingSale key={sheet.mode+'-'+sheet.sale.id} sale={sheet.sale} mode={sheet.mode} canPickFinancer={canApprove}
      canApprove={canApprove&&sheet.sale.status==='PENDING'} canEditApproved={canApprove&&sheet.sale.status==='APPROVED'} onApprove={async()=>{if(await approve(sheet.sale.id))setSheet(null)}}
      onEdit={()=>setSheet({mode:'edit',sale:sheet.sale})}
      onClose={()=>setSheet(null)} onSaved={()=>{setSheet(null);load()}}/>}
    {proformaId&&<ProformaInvoicePrintView saleId={proformaId} onClose={()=>setProformaId(null)}/>}
    {invoiceSale&&<TaxInvoiceModal data={invoiceSale} onClose={()=>setInvoiceSale(null)} onSaved={()=>{setInvoiceSale(null);load()}}/>}
  </div>
}

// Module level (not inside CreatePendingSale) so inputs keep focus while typing.
function Input({label,...p}){return <label className="field"><span>{label}</span><input className="input" {...p}/></label>}
function Text({label,...p}){return <label className="field"><span>{label}</span><textarea className="input" rows="2" {...p}/></label>}
// Financer Master dropdown: staff/admin only. Anyone else keeps a plain text box.
function FinancerSelect({value,onChange,financers,canPick}){
  if(!canPick)return <Input label="Financer Name (Hypothecation)" value={value||''} onChange={e=>onChange(e.target.value)}/>;
  const names=financers.map(f=>f.name).filter(Boolean);
  const list=value&&!names.includes(value)?[value,...names]:names;
  return <label className="field"><span>Financer (Hypothecation)</span><select className="input" value={value||''} onChange={e=>onChange(e.target.value)}><option value="">Select Financer</option>{list.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
}

const KINDS=[
  {key:'NEW',title:'New Rickshaw',sub:'GST sale · Delivery Challan chassis se · Tax Invoice banega'},
  {key:'OLD',title:'Old Rickshaw',sub:'Non-GST · alag form · Tax Invoice nahi banega'},
  {key:'BATTERY',title:'Battery',sub:'Non-GST · alag form · Tax Invoice nahi banega'},
];

export function CreatePendingSale({initialKind=null,prefill=null,canPickFinancer,onClose,onSaved,sale=null,mode='create',canApprove=false,canEditApproved=false,onApprove,onEdit}){
  const editing=mode!=='create',readOnly=mode==='view';
  // Approved sale: Customer Name, Father Name (+Relation), Sale Amount and Loan Amount stay locked; everything else (Ledger No., Chassis Record No., Voucher No., Subsidy, RTO, Address, Amount / Tax ...) is editable.
  const lockedApproved=editing&&sale?.status==='APPROVED';
  const strict=!sale||sale.status==='PENDING';
  const initial={
    dealer_id:'',application_id:null,dealer_cash_customer_id:'',vehicle_id:'',buyer_name:'',buyer_mobile:'',buyer_relation:'',buyer_father_name:'',buyer_address:'',
    buyer_gst_no:'',buyer_pan:'',buyer_aadhar:'',buyer_dob:'',buyer_state:'',buyer_state_code:'',buyer_pincode:'',state_type:'I',
    mode_term:'',bank_name:'',bank_account_no:'',bank_ifsc:'',rto_name:'',despatch_through:'',eway_bill_no:'',license_no:'',
    cvr_no:'',cancelled_cheque_no:'',remarks:'',dealer_page_no:'',sale_amount:'',amount_received:'',financer_name:'',
    hypothecation_amount:'',vehicle_reg_no:'',ledger_no:'',chassis_record_no:'',voucher_no:'',subsidy_amount:'',
    gst_sale_amount:'',gst_rate:5,insurance_amount:'',registration_amount:'',discount:'',do_no:'',internal_sale_details:'',
    sale_date:new Date().toISOString().slice(0,10),old_rickshaw_id:'',sp_no:'',item_model:'',item_colour:'',battery_maker:'',battery_nos:'',battery_qty:'1'
  };
  // Edit / View: form ko saved sale se bharo (dealer, chassis aur type fixed rehte hain).
  const fromSale=x=>{
    if(!x)return initial;
    const n=v=>{const k=Number(v);return k?String(k):''};
    const f={...initial};
    for(const k of Object.keys(initial))if(x[k]!==undefined&&x[k]!==null&&!['sale_amount','amount_received','hypothecation_amount','subsidy_amount','gst_sale_amount','gst_rate','insurance_amount','registration_amount','discount','buyer_dob'].includes(k))f[k]=x[k];
    f.buyer_name=x.customer_name||'';f.buyer_mobile=x.customer_phone||'';f.buyer_address=x.customer_address||'';f.buyer_state=x.customer_state||'';
    f.dealer_page_no=x.page_no||'';f.dealer_id=x.dealer_id||'';f.application_id=x.application_id||null;f.vehicle_id=x.vehicle_id||'';
    f.buyer_dob=x.buyer_dob?String(x.buyer_dob).slice(0,10):'';f.sale_date=x.sale_date?String(x.sale_date).slice(0,10):initial.sale_date;
    f.sale_amount=n(x.sale_amount);f.amount_received=n(x.amount_received);f.hypothecation_amount=n(x.hypothecation_amount||x.loan_amount);
    f.subsidy_amount=n(x.subsidy_amount);f.gst_sale_amount=n(x.gst_sale_amount);f.gst_rate=Number(x.gst_rate)||5;
    f.insurance_amount=n(x.insurance_amount);f.registration_amount=n(x.registration_amount);f.discount=n(x.discount);
    if(kindOf(x)!=='NEW'){
      const parts=String(x.description||'').split(' · ');
      if(kindOf(x)==='OLD'){f.vehicle_reg_no=x.vehicle_reg_no||parts[1]||'';f.item_model=parts[2]||'';f.item_colour=parts[3]||''}
      else{f.battery_maker=parts[1]||'';f.battery_qty=String(parts[2]||'').replace(/^Qty\s*/,'')||'1';f.battery_nos=parts.slice(3).join(' · ')}
      const det=String(x.internal_sale_details||''),d0=String(x.description||'');
      f.internal_sale_details=det===d0?'':(d0&&det.startsWith(d0+' | ')?det.slice(d0.length+3):det);
    }
    return f;
  };
  const kindOf=x=>({'OLD RICKSHAW':'OLD','BATTERY':'BATTERY'}[String(x?.sale_type||'').toUpperCase()]||'NEW');
  const [kind,setKind]=useState(sale?kindOf(sale):initialKind);
  const [form,setForm]=useState(()=>fromSale(sale)),[step,setStep]=useState(0),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [dealers,setDealers]=useState([]),[dealersLoading,setDealersLoading]=useState(!editing),[dealersError,setDealersError]=useState('');
  const [stock,setStock]=useState({loading:false,error:'',rows:[]});
  const [oldStock,setOldStock]=useState({loading:false,error:'',rows:[]});
  const [people,setPeople]=useState({loading:false,error:'',loans:[],customers:[]});
  const [financers,setFinancers]=useState([]);
  const seq=useRef(0);
  const [chassisText,setChassisText]=useState('');

  // 1) dealers only (fast). Financer master is fetched after that, staff only.
  const loadDealers=()=>{
    setDealersLoading(true);setDealersError('');
    get('/billing/pending-sales/options?part=dealers',{timeoutMs:60000}).then(r=>setDealers(r.dealers||[]))
      .catch(e=>setDealersError(e.message||'Could not load dealers')).finally(()=>setDealersLoading(false));
  };
  useEffect(()=>{if(!editing)loadDealers()},[]);
  useEffect(()=>{
    if(!canPickFinancer||dealersLoading)return;
    get('/masters/financer').then(d=>setFinancers(Array.isArray(d)?d:(d.masters||d.rows||d.data||[]))).catch(()=>{});
  },[canPickFinancer,dealersLoading]);

  // Register se vehicle click: dealer + Old Rickshaw pehle se chuna hua.
  useEffect(()=>{
    if(!prefill||editing)return;
    setForm(f=>({...f,dealer_id:prefill.dealer_id||''}));
    if(!prefill.dealer_id)return;
    setOldStock({loading:true,error:'',rows:[]});
    get('/billing/pending-sales/options?part=old_rickshaws&dealer_id='+prefill.dealer_id,{timeoutMs:60000}).then(r=>{
      const rows=r.rickshaws||[],o=rows.find(x=>String(x.id)===String(prefill.old_rickshaw_id));
      setOldStock({loading:false,error:o?'':'Ye Old Rickshaw dealer ke available stock me nahi mili.',rows});
      if(o)setForm(f=>({...f,old_rickshaw_id:String(o.id),sp_no:o.sp_no||'',vehicle_reg_no:o.vehicle_reg_no||'',item_model:o.model_name||'',item_colour:o.colour||''}));
    }).catch(e=>setOldStock({loading:false,error:e.message||'Old Rickshaw stock load nahi hua',rows:[]}));
  },[]);

  const dealer=dealers.find(d=>String(d.id)===String(form.dealer_id));
  const isBranch=['showroom','branch'].includes(String(dealer?.dealer_category||'').toLowerCase());
  const customers=people.customers,loans=people.loans,vehicles=stock.rows;
  const cust=customers.find(c=>String(c.id)===String(form.dealer_cash_customer_id));
  const vehicle=vehicles.find(v=>String(v.challan_id)===String(form.vehicle_id));
  const balance=Math.max(0,Number(form.sale_amount||0)-Number(form.hypothecation_amount||0)-Number(form.amount_received||0));
  // Old Rickshaw approved: sale/loan locked; balance pending ho to hi Received Amount edit.
  const oldPayable=Math.max(0,Number(sale?.sale_amount||0)-Number(sale?.hypothecation_amount||0)),oldPrevReceived=Number(sale?.amount_received||0);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const {locked:stateTypeLocked}=useAutoStateType(form,set,!readOnly&&kind==='NEW');
  const chooseKind=k=>{setChassisText('');setKind(k);setError('');setStep(0);setForm(initial);setStock({loading:false,error:'',rows:[]});setOldStock({loading:false,error:'',rows:[]});setPeople({loading:false,error:'',loans:[],customers:[]});seq.current++};

  // 2) that dealer's stock, 3) then that dealer's customers / approved loans. New Rickshaw only.
  // Registered dealer => buyer = dealer itself: naam, address, GSTIN, PAN, state auto-fill (sab editable rehta hai).
  const DEALER_FILL_KEYS=['buyer_name','buyer_address','buyer_mobile','buyer_gst_no','buyer_pan','buyer_state','buyer_state_code'];
  const dealerFilled=useRef(false);
  const dealerBuyerFields=async v=>{
    let d=dealers.find(x=>String(x.id)===String(v));
    // options?part=dealers me address/GSTIN na aaye to master list se utha lo.
    if(!d||(d.address1===undefined&&d.gst_no===undefined&&d.pan===undefined)){
      try{const r=await get('/dealers');d={...(d||{}),...((r.dealers||[]).find(x=>String(x.id)===String(v))||{})}}catch(e){}
    }
    if(!d)return null;
    const cat=String(d.dealer_category||'').toLowerCase();
    if(['showroom','branch'].includes(cat)||String(d.registration_type||'registered').toLowerCase()==='unregistered')return null;
    return {buyer_name:d.name||'',buyer_address:[d.address1,d.address2].map(x=>String(x||'').trim()).filter(Boolean).join(', '),
      buyer_mobile:d.mobile||'',buyer_gst_no:d.gst_no||'',buyer_pan:d.pan||'',buyer_state:d.state||'',buyer_state_code:d.state_code||''};
  };
  const selectDealer=async v=>{
    setChassisText('');
    dealerFilled.current=false;
    setForm(f=>({...f,dealer_id:v,application_id:null,dealer_cash_customer_id:'',vehicle_id:'',buyer_name:'',buyer_mobile:'',buyer_address:'',buyer_gst_no:'',buyer_pan:'',buyer_state:'',buyer_state_code:'',
      sale_amount:'',gst_sale_amount:'',hypothecation_amount:'',amount_received:'',financer_name:'',do_no:'',dealer_page_no:''}));
    const my=++seq.current;
    if(v&&kind==='NEW'){dealerBuyerFields(v).then(b=>{if(b&&seq.current===my){dealerFilled.current=true;setForm(f=>({...f,...b}))}})}
    setStock({loading:false,error:'',rows:[]});setPeople({loading:false,error:'',loans:[],customers:[]});
    setOldStock({loading:false,error:'',rows:[]});
    setForm(f=>({...f,old_rickshaw_id:'',vehicle_reg_no:'',item_model:'',item_colour:''}));
    if(v&&kind==='OLD'){
      setOldStock({loading:true,error:'',rows:[]});
      get('/billing/pending-sales/options?part=old_rickshaws&dealer_id='+v,{timeoutMs:60000})
        .then(r=>{if(seq.current===my)setOldStock({loading:false,error:'',rows:r.rickshaws||[]})})
        .catch(e=>{if(seq.current===my)setOldStock({loading:false,error:e.message||'Old Rickshaw stock load nahi hua',rows:[]})});
    }
    if(!v||kind!=='NEW')return;
    setStock({loading:true,error:'',rows:[]});
    try{const r=await get('/billing/pending-sales/options?part=vehicles&dealer_id='+v,{timeoutMs:60000});if(seq.current===my)setStock({loading:false,error:'',rows:r.vehicles||[]})}
    catch(e){if(seq.current===my)setStock({loading:false,error:e.message||'Could not load stock',rows:[]})}
    if(seq.current!==my)return;
    setPeople({loading:true,error:'',loans:[],customers:[]});
    try{const r=await get('/billing/pending-sales/options?part=customers&dealer_id='+v,{timeoutMs:60000});if(seq.current===my)setPeople({loading:false,error:'',loans:r.applications||[],customers:r.cash_customers||[]})}
    catch(e){if(seq.current===my)setPeople({loading:false,error:e.message||'Could not load customers',loans:[],customers:[]})}
  };
  // Showroom/Branch: customer register (dealer_cash_customer) se select.
  const pickCustomer=v=>{
    const c=customers.find(y=>String(y.id)===String(v));
    if(!c){setForm(f=>({...f,dealer_cash_customer_id:'',buyer_name:'',buyer_mobile:'',dealer_page_no:'',sale_amount:'',amount_received:''}));return}
    setForm(f=>({...f,dealer_cash_customer_id:v,buyer_name:c.name||'',buyer_mobile:c.phone||'',dealer_page_no:c.page_no||'',
      sale_amount:String(Number(c.sale_amount)||''),amount_received:String(Number(c.paid_amount)||'')}));
  };
  // Approved loan (optional): amount dropdown se aata hai, type nahi karna.
  const pickLoan=v=>{
    const l=loans.find(y=>String(y.id)===String(v));
    if(!l){setForm(f=>({...f,application_id:null,hypothecation_amount:'',financer_name:'',do_no:''}));return}
    const clearDealer=dealerFilled.current;dealerFilled.current=false;
    setForm(f=>({...f,application_id:l.id,hypothecation_amount:String(Number(l.loan_amount)||''),financer_name:f.financer_name||'CHFPL',
      do_no:l.do_no||f.do_no,
      ...(clearDealer?{buyer_name:l.customer_name||'',buyer_mobile:l.customer_phone||'',buyer_address:'',buyer_gst_no:'',buyer_pan:''}
        :{buyer_name:f.buyer_name||l.customer_name||'',buyer_mobile:f.buyer_mobile||l.customer_phone||''})}));
  };
  // Chassis can be typed: exact chassis no., or any text (>=4 chars) that matches exactly one of this dealer's vehicles.
  const typeChassis=t=>{
    setChassisText(t);
    const q=t.trim().toLowerCase();
    let m=null;
    if(q){
      m=vehicles.find(v=>String(v.chassis_no||'').toLowerCase()===q)||null;
      if(!m&&q.length>=4){const hits=vehicles.filter(v=>String(v.chassis_no||'').toLowerCase().includes(q));if(hits.length===1)m=hits[0]}
    }
    if(m)applyVehicle(String(m.challan_id));
    else setForm(f=>f.vehicle_id?{...f,vehicle_id:''}:f);
  };
  const applyVehicle=v=>{
    const x=vehicles.find(y=>String(y.challan_id)===String(v)); if(!x)return;
    setForm(f=>({...f,vehicle_id:v,sale_amount:f.sale_amount||String(x.sale_value||''),gst_sale_amount:f.gst_sale_amount||String(x.sale_value||'')}));
  };

  const save=async()=>{
    setSaving(true);setError('');
    try{
      if(!form.dealer_id)throw new Error('Dealer select karo.');
      if(!form.buyer_name.trim())throw new Error('Customer Name required hai.');
      if(Number(form.hypothecation_amount||0)>Number(form.sale_amount||0))throw new Error('Loan Amount Sale Amount se zyada nahi ho sakta.');
      const common={...form,sale_category:kind,application_id:form.application_id?Number(form.application_id):null,dealer_cash_customer_id:form.dealer_cash_customer_id?Number(form.dealer_cash_customer_id):null,dealer_id:Number(form.dealer_id),
        customer_name:form.buyer_name,customer_phone:form.buyer_mobile,customer_address:form.buyer_address,customer_state:form.buyer_state,buyer_state_code:buyerStateCode(form),
        sale_amount:Number(form.sale_amount||0),loan_amount:Number(form.hypothecation_amount||0)};
      let payload;
      if(kind==='NEW'){
        if(!editing&&!form.vehicle_id)throw new Error('Chassis / Delivery Challan select karo.');
        if(strict){
          if(!form.buyer_state)throw new Error(STATE_REQUIRED_MSG);
          const pinErr=pincodeError(form);if(pinErr)throw new Error(pinErr);
        }
        payload={...common,vehicle_id:Number(form.vehicle_id)||null,delivery_challan_id:Number(form.vehicle_id)||null};
      }else if(kind==='OLD'){
        if(!editing&&!form.old_rickshaw_id)throw new Error('Dealer ke stock se Old Rickshaw select karo.');
        if(!form.sale_date)throw new Error('Sale Date required hai.');
        if(!form.vehicle_reg_no.trim())throw new Error('Old Rickshaw ka Vehicle Reg. No. required hai.');
        if(!(Number(form.sale_amount)>0))throw new Error('Sale Amount required hai.');
        const desc='Old Rickshaw · '+form.vehicle_reg_no.trim()+(form.item_model?' · '+form.item_model:'')+(form.item_colour?' · '+form.item_colour:'');
        payload={...common,financer_name:'',vehicle_id:null,delivery_challan_id:null,old_rickshaw_id:editing?undefined:Number(form.old_rickshaw_id)||null,description:desc,internal_sale_details:[desc,form.internal_sale_details].filter(Boolean).join(' | ')};
      }else{
        if(!form.battery_maker.trim()&&!form.battery_nos.trim())throw new Error('Battery Maker ya Battery No. bharo.');
        if(!(Number(form.sale_amount)>0))throw new Error('Sale Amount required hai.');
        const desc='Battery · '+[form.battery_maker.trim(),'Qty '+(form.battery_qty||1),form.battery_nos.trim()].filter(Boolean).join(' · ');
        payload={...common,vehicle_id:null,delivery_challan_id:null,description:desc,internal_sale_details:[desc,form.internal_sale_details].filter(Boolean).join(' | ')};
      }
      let res=null;
      if(editing)await put('/billing/pending-sales/'+sale.id,payload);else res=await post('/billing/pending-sales/create',payload);
      onSaved(res);
    }catch(e){setError(e.message||'Could not create Pending Sale')}finally{setSaving(false)}
  };

  const dealerSelect=editing?<Input label="Dealer" value={sale?.dealer_name||('#'+form.dealer_id)} readOnly disabled/>:<label className="field"><span>Dealer</span><select className="input" value={form.dealer_id} onChange={e=>selectDealer(e.target.value)} disabled={dealersLoading} required><option value="">{dealersLoading?'Loading dealers…':'Select Dealer First'}</option>{dealers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>;
  const financerRow=<><FinancerSelect value={form.financer_name} onChange={v=>set('financer_name',v)} financers={financers} canPick={canPickFinancer}/>
      <Input label={'Hypothecation / Loan Amount'+(lockedApproved?' · locked':form.application_id?' (approved loan se)':'')} type="number" min="0" value={form.hypothecation_amount} onChange={e=>set('hypothecation_amount',e.target.value)} readOnly={!!form.application_id||lockedApproved} disabled={lockedApproved}/></>;
  const loanRow=<Input label={'Loan Amount'+(lockedApproved?' · locked':'')} type="number" min="0" value={form.hypothecation_amount} onChange={e=>set('hypothecation_amount',e.target.value)} readOnly={lockedApproved} disabled={lockedApproved}/>;
  const balanceField=<label className="field"><span>Balance</span><input className="input" value={balance.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})} readOnly/></label>;
  const kindTitle=KINDS.find(k=>k.key===kind)?.title;

  const editActions=<div className="actions" style={{marginTop:16,justifyContent:'space-between'}}>
    <div className="actions">{kind==='NEW'&&<><button type="button" className="btn" disabled={step===0} onClick={()=>setStep(x=>Math.max(0,x-1))}>← Back</button><button type="button" className="btn" disabled={step===2} onClick={()=>setStep(x=>Math.min(2,x+1))}>Next →</button></>}</div>
    <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={saving||!form.dealer_id||(!editing&&kind==='NEW'&&!form.vehicle_id)}>{saving?'Saving…':editing?'Save Changes':'Create Pending Sale'}</button></div>
  </div>;
  const viewActions=<div className="actions" style={{marginTop:16,justifyContent:'flex-end'}}>
    <button className="btn" onClick={onClose}>Close</button>
    {(canApprove||canEditApproved)&&<button className="btn" onClick={onEdit}>Edit</button>}
    {canApprove&&<button className="btn primary" onClick={onApprove}>Approve</button>}
  </div>;
  const actions=readOnly?viewActions:editActions;

  return <div className="modal"><div className="modalbox" style={{maxWidth:1000}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
      <div><h2 style={{margin:0}}>{readOnly?'View Sale':lockedApproved?'Edit Approved Sale':editing?'Edit Pending Sale':'Create Pending Sale'}{kind?' · '+kindTitle:''}</h2>
        <p className="muted" style={{margin:'6px 0'}}>{readOnly?(canApprove?<>Saari details check karo, phir <b>Approve</b> dabao. Approve ke baad Sale Amount / Loan Amount change nahi honge aur sale delete nahi hogi.</>:sale?.status==='PENDING'?<>Sale abhi Pending hai.</>:<>Yeh sale <b>{sale?.status}</b> hai — Customer Name, Father Name, Sale Amount / Loan Amount locked hain, delete nahi ho sakti. Ledger No., Chassis Record No., Voucher No., Subsidy Amount, RTO aur Address edit ho sakte hain.</>):kind==='NEW'?<>Dealer → Vehicle → Customer → (optional) Approved Loan, phir Internal details bharo. <b>Bill No. nahi hai</b>.</>:kind?<>{kindTitle} sale (GST nahi). Approve ke baad <b>Complete Sale (No GST)</b> hoga.</>:'Pehle batao kis cheez ki sale hai.'}</p></div>
      <div style={{display:'flex',gap:6}}>{kind&&!editing&&!initialKind&&<button className="btn" onClick={()=>setKind(null)}>← Change type</button>}<button className="btn" onClick={onClose}>×</button></div>
    </div>
    <ErrorBanner message={error}/>
    {dealersError&&<div style={{display:'flex',gap:8,alignItems:'center'}}><ErrorBanner message={dealersError}/><button type="button" className="btn" onClick={loadDealers}>↻ Retry</button></div>}

    {!kind&&<div className="formgrid" style={{marginTop:14,gridTemplateColumns:'repeat(3,minmax(0,1fr))'}}>
      {KINDS.map(k=><button type="button" key={k.key} className="card" style={{textAlign:'left',cursor:'pointer',padding:16}} onClick={()=>chooseKind(k.key)}><b style={{fontSize:16}}>{k.title}</b><div className="muted" style={{marginTop:6}}>{k.sub}</div></button>)}
    </div>}

    {kind==='NEW'&&<>
      <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <div className="formgrid" style={{marginTop:12}}>
        {dealerSelect}
        {editing?<Input label="Chassis / Vehicle" value={[sale?.chassis_no,sale?.model_name].filter(Boolean).join(' · ')||'—'} readOnly disabled/>:<label className="field"><span>Chassis No. (type or pick)</span><input className="input" list="pendingChassisList" value={vehicle&&!chassisText?(vehicle.chassis_no||''):chassisText} onChange={e=>typeChassis(e.target.value)} disabled={!form.dealer_id||stock.loading} autoComplete="off" placeholder={!form.dealer_id?'Select Dealer First':stock.loading?'Stock load ho raha hai…':vehicles.length?'Type chassis no. or pick from list':'Is dealer ke paas unbilled stock nahi hai'}/><datalist id="pendingChassisList">{vehicles.map(v=><option key={v.challan_id} value={v.chassis_no||''}>{(v.challan_no||'DC')+' · '+(v.product_name||v.model_name||'')}</option>)}</datalist>{chassisText&&!form.vehicle_id&&vehicles.length>0&&<small style={{color:'#c0392b'}}>No unique match in this dealer's stock yet.</small>}</label>}
      </div>
      {stock.error&&<ErrorBanner message={stock.error}/>}
      {form.dealer_id&&!editing&&<div className="formgrid" style={{marginTop:10}}>
        {isBranch
          ?<label className="field"><span>Customer (Showroom/Branch register)</span><select className="input" value={form.dealer_cash_customer_id} onChange={e=>pickCustomer(e.target.value)} disabled={people.loading}><option value="">{people.loading?'Customers load ho rahe hain…':'Select Customer'}</option>{customers.map(c=><option key={c.id} value={c.id}>{c.page_no?'['+c.page_no+'] ':''}{c.name||'—'}{c.phone?' · '+c.phone:''}</option>)}</select></label>
          :<><Input label="Customer Name (New)" value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)}/><Input label="Customer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/></>}
        <label className="field"><span>Approved Loan (optional)</span><select className="input" value={form.application_id||''} onChange={e=>pickLoan(e.target.value)} disabled={people.loading}><option value="">{people.loading?'Loans load ho rahe hain…':loans.length?'No loan / manual':'No approved loan for this dealer'}</option>{loans.map(l=><option key={l.id} value={l.id}>{l.application_no||l.id} · {l.customer_name||'—'} · ₹{Number(l.loan_amount||0).toLocaleString('en-IN')}{l.do_no?' · DO '+l.do_no:''}</option>)}</select></label>
      </div>}
      {people.error&&<ErrorBanner message={people.error}/>}
      {cust&&<div className="card" style={{marginTop:10,padding:10}}><b>Booking type:</b> {String(cust.booking_for||'new').toUpperCase()} &nbsp; <b>Booked price:</b> ₹{Number(cust.sale_amount||0).toLocaleString('en-IN')} &nbsp; <b>Down payment:</b> ₹{Number(cust.paid_amount||0).toLocaleString('en-IN')} &nbsp; <b>Loan (dealer ne bataya):</b> ₹{Number(cust.loan_amount||0).toLocaleString('en-IN')}</div>}
      {vehicle&&<div className="card" style={{marginTop:10,padding:10}}><b>Dealer:</b> {vehicle.dealer_name||'—'} &nbsp; <b>Chassis:</b> {vehicle.chassis_no||'—'} &nbsp; <b>Model:</b> {vehicle.model_name||vehicle.product_name||'—'} &nbsp; <b>Colour:</b> {vehicle.colour||'—'}</div>}
      {!readOnly&&<div className="actions" style={{margin:'14px 0 8px',gap:6}}>
        {['Applicant Details','Internal','Amount / Tax'].map((x,i)=><button type="button" key={x} className={'btn '+(step===i?'primary':'')} onClick={()=>setStep(i)}>{i+1}. {x}</button>)}
      </div>}
      {readOnly&&<h3 style={{margin:'14px 0 6px'}}>1. Applicant Details</h3>}
      {(readOnly||step===0)&&<div className="formgrid">
        <Input label="Dealer Page No." value={form.dealer_page_no} onChange={e=>set('dealer_page_no',e.target.value)}/>
        <Input label={'Customer Name'+(lockedApproved?' · locked':'')} value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)} required disabled={lockedApproved}/>
        <label className="field"><span>Relation (S/O, D/O, C/O){lockedApproved?' · locked':''}</span><select className="input" disabled={lockedApproved} value={form.buyer_relation||''} onChange={e=>set('buyer_relation',e.target.value)}><option value="">— (Firm / none)</option>{relationOptionsFor(form.buyer_relation).filter(o=>o.value).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <Input label={'Buyer Father/Husband Name'+(lockedApproved?' · locked':'')} value={form.buyer_father_name} onChange={e=>set('buyer_father_name',e.target.value)} disabled={lockedApproved}/>
        <Input label="Buyer Address" value={form.buyer_address} onChange={e=>set('buyer_address',e.target.value)}/>
        <Input label="Buyer Pin Code *" inputMode="numeric" maxLength={6} placeholder="6 digit pin code" value={form.buyer_pincode||''} onChange={e=>set('buyer_pincode',normPincode(e.target.value))}/>
        <label className="field"><span>Buyer State *</span><select className="input" value={stateValueFor(form.buyer_state)} onChange={e=>setForm(f=>({...f,...stateFields(e.target.value)}))}><option value="">— Select State —</option>{stateOptionsFor(form.buyer_state).map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <Input label="Buyer State Code (auto)" value={buyerStateCode(form)} readOnly/>
        <label className="field"><span>Intra / Inter State{stateTypeLocked?' (auto from state)':''}</span><select className="input" value={form.state_type} onChange={e=>set('state_type',e.target.value)} disabled={stateTypeLocked}>{STATE_TYPE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <Input label="Buyer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/>
        <Input label="Buyer GSTIN" value={form.buyer_gst_no} onChange={e=>set('buyer_gst_no',e.target.value)}/>
        <Input label="Buyer PAN" value={form.buyer_pan} onChange={e=>set('buyer_pan',e.target.value)}/>
        <Input label="Buyer Aadhar" value={form.buyer_aadhar} onChange={e=>set('buyer_aadhar',e.target.value)}/>
        <Input label="Buyer Date of Birth" type="date" value={form.buyer_dob} onChange={e=>set('buyer_dob',e.target.value)}/>
        <Input label="Mode / Term" value={form.mode_term} onChange={e=>set('mode_term',e.target.value)}/><Input label="Bank Name" value={form.bank_name} onChange={e=>set('bank_name',e.target.value)}/><Input label="Bank Account No." value={form.bank_account_no} onChange={e=>set('bank_account_no',e.target.value)}/><Input label="Bank IFSC" value={form.bank_ifsc} onChange={e=>set('bank_ifsc',e.target.value)}/>
        <RtoSelect value={form.rto_name} onChange={v=>set('rto_name',v)}/><Input label="Despatch Through" value={form.despatch_through} onChange={e=>set('despatch_through',e.target.value)}/><Input label="License No." value={form.license_no} onChange={e=>set('license_no',e.target.value)}/><Input label="CVR No." value={form.cvr_no} onChange={e=>set('cvr_no',e.target.value)}/><Input label="Cancelled Cheque No." value={form.cancelled_cheque_no} onChange={e=>set('cancelled_cheque_no',e.target.value)}/><Text label="Remarks" value={form.remarks} onChange={e=>set('remarks',e.target.value)} style={{gridColumn:'1 / -1'}}/>
      </div>}
      {readOnly&&<h3 style={{margin:'18px 0 6px'}}>2. Internal</h3>}
      {(readOnly||step===1)&&<div className="formgrid">
        <Input label={'Sale Amount (Internal)'+(lockedApproved?' · locked':'')} type="number" min="0" value={form.sale_amount} onChange={e=>set('sale_amount',e.target.value)} required disabled={lockedApproved}/>
        <Input label="Amount Received" type="number" min="0" value={form.amount_received} onChange={e=>set('amount_received',e.target.value)}/>
        {financerRow}{balanceField}
        <Input label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={e=>set('vehicle_reg_no',e.target.value)}/><Input label="Ledger No." value={form.ledger_no} onChange={e=>set('ledger_no',e.target.value)}/><Input label="Chassis Record No." value={form.chassis_record_no} onChange={e=>set('chassis_record_no',e.target.value)}/><Input label="Voucher No." value={form.voucher_no} onChange={e=>set('voucher_no',e.target.value)}/><Input label="Subsidy Amount" type="number" min="0" value={form.subsidy_amount} onChange={e=>set('subsidy_amount',e.target.value)}/><Input label="DO No." value={form.do_no} onChange={e=>set('do_no',e.target.value)}/><Text label="Internal Sale Details" value={form.internal_sale_details} onChange={e=>set('internal_sale_details',e.target.value)} style={{gridColumn:'1 / -1'}}/>
      </div>}
      {readOnly&&<h3 style={{margin:'18px 0 6px'}}>3. Amount / Tax</h3>}
      {(readOnly||step===2)&&<div className="formgrid">
        <Input label="GST Sale Amount" type="number" min="0" value={form.gst_sale_amount} onChange={e=>set('gst_sale_amount',e.target.value)} required/>
        <Input label="GST Rate %" type="number" min="0" value={form.gst_rate} onChange={e=>set('gst_rate',e.target.value)}/><Input label="Insurance Amount" type="number" min="0" value={form.insurance_amount} onChange={e=>set('insurance_amount',e.target.value)}/><Input label="Registration Amount" type="number" min="0" value={form.registration_amount} onChange={e=>set('registration_amount',e.target.value)}/><Input label="Discount" type="number" min="0" value={form.discount} onChange={e=>set('discount',e.target.value)}/>
      </div>}
      </fieldset>
      {actions}
    </>}

    {kind==='OLD'&&<>
      <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <div className="formgrid" style={{marginTop:12}}>
        {dealerSelect}
        <Input label="Dealer Page No." value={form.dealer_page_no} onChange={e=>set('dealer_page_no',e.target.value)}/>
        <Input label="Sale Date" type="date" value={form.sale_date||''} onChange={e=>set('sale_date',e.target.value)} required/>
        <Input label={'Customer Name'+(lockedApproved?' · locked':'')} value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)} required disabled={lockedApproved}/>
        <Input label="Customer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/>
        <Input label="Customer Address" value={form.buyer_address} onChange={e=>set('buyer_address',e.target.value)}/>
        {editing?<Input label="Vehicle Reg. No. (Old Rickshaw)" value={form.vehicle_reg_no} readOnly disabled/>:<label className="field"><span>Vehicle Reg. No. (Old Rickshaw) — dealer ka stock</span>
          <select className="input" value={form.old_rickshaw_id} required disabled={!form.dealer_id||oldStock.loading} onChange={e=>{const o=oldStock.rows.find(x=>String(x.id)===e.target.value);setForm(f=>({...f,old_rickshaw_id:e.target.value,sp_no:o?.sp_no||'',vehicle_reg_no:o?.vehicle_reg_no||'',item_model:o?.model_name||'',item_colour:o?.colour||''}))}}>
            <option value="">{!form.dealer_id?'Pehle Dealer select karo':oldStock.loading?'Stock load ho raha hai…':oldStock.rows.length?'Select Old Rickshaw':'Is dealer ke stock me Old Rickshaw nahi hai'}</option>
            {oldStock.rows.map(o=><option key={o.id} value={o.id}>{[o.vehicle_reg_no,o.sp_no,o.model_name,o.colour].filter(Boolean).join(' · ')}</option>)}
          </select>
          {oldStock.error&&<small style={{color:'#c0392b'}}>{oldStock.error}</small>}</label>}
        <Input label="SP No." value={form.sp_no||sale?.sp_no||''} readOnly placeholder="Vehicle chunne par aayega"/>
        <Input label="Model" value={form.item_model} readOnly/>
        <Input label="Colour" value={form.item_colour} readOnly/>
        <Input label={'Sale Amount'+(lockedApproved?' · locked':'')} type="number" min="0" value={form.sale_amount} onChange={e=>set('sale_amount',e.target.value)} required disabled={lockedApproved}/>
        <Input label={'Amount Received'+(lockedApproved?(oldPayable>0&&oldPrevReceived<oldPayable?' (dealer ledger me adjust hoga)':' · locked (balance nahi hai)'):'')} type="number" min="0" max={lockedApproved?oldPayable:undefined} value={form.amount_received} onChange={e=>set('amount_received',e.target.value)} disabled={lockedApproved&&!(oldPayable>0&&oldPrevReceived<oldPayable)}/>
        {loanRow}{balanceField}
        <Input label="Ledger No." value={form.ledger_no} onChange={e=>set('ledger_no',e.target.value)}/>
        <Input label="DO No." value={form.do_no} onChange={e=>set('do_no',e.target.value)}/>
        <Text label="Remarks / Details" value={form.internal_sale_details} onChange={e=>set('internal_sale_details',e.target.value)} style={{gridColumn:'1 / -1'}}/>
      </div>
      </fieldset>
      {actions}
    </>}

    {kind==='BATTERY'&&<>
      <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <div className="formgrid" style={{marginTop:12}}>
        {dealerSelect}
        <Input label="Dealer Page No." value={form.dealer_page_no} onChange={e=>set('dealer_page_no',e.target.value)}/>
        <Input label={'Customer Name'+(lockedApproved?' · locked':'')} value={form.buyer_name} onChange={e=>set('buyer_name',e.target.value)} required disabled={lockedApproved}/>
        <Input label="Customer Mobile" value={form.buyer_mobile} onChange={e=>set('buyer_mobile',e.target.value)}/>
        <Input label="Battery Maker" value={form.battery_maker} onChange={e=>set('battery_maker',e.target.value)}/>
        <Input label="Qty" type="number" min="1" value={form.battery_qty} onChange={e=>set('battery_qty',e.target.value)}/>
        <Input label="Battery No(s). (comma se alag)" value={form.battery_nos} onChange={e=>set('battery_nos',e.target.value)}/>
        <Input label={'Sale Amount'+(lockedApproved?' · locked':'')} type="number" min="0" value={form.sale_amount} onChange={e=>set('sale_amount',e.target.value)} required disabled={lockedApproved}/>
        <Input label="Amount Received" type="number" min="0" value={form.amount_received} onChange={e=>set('amount_received',e.target.value)}/>
        {balanceField}
        <Input label="Ledger No." value={form.ledger_no} onChange={e=>set('ledger_no',e.target.value)}/>
        <Text label="Remarks / Details" value={form.internal_sale_details} onChange={e=>set('internal_sale_details',e.target.value)} style={{gridColumn:'1 / -1'}}/>
      </div>
      </fieldset>
      {actions}
    </>}
  </div></div>
}

function TaxInvoiceModal({data,onClose,onSaved}){
  const [form,setForm]=useState(data.invoice||{}),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const {rtos,defaultBank}=useInvoiceMasters();
  const rtoNames=rtos.map(r=>r.name).filter(Boolean);
  const rtoOpts=(rtoNames.includes(form.rto_name)||!form.rto_name?rtoNames:[form.rto_name,...rtoNames]).map(n=>({value:n,label:n}));
  const b2c=isB2C(form);
  const {locked:stateTypeLocked}=useAutoStateType(form,set);
  // Default bank from Bank Details master auto-fills when the invoice has no bank yet.
  useEffect(()=>{if(defaultBank)setForm(f=>f.bank_name?f:{...f,bank_name:defaultBank.name||'',bank_account_no:defaultBank.account_no||'',bank_ifsc:defaultBank.ifsc||''})},[defaultBank]);
  const save=async()=>{setSaving(true);setError('');try{
    if(!String(form.rto_name||'').trim())throw new Error('RTO Name select karo — Bill No. banne se pehle RTO zaroori hai.');
    if(!String(form.buyer_state||'').trim())throw new Error(STATE_REQUIRED_MSG);
    {const pinErr=pincodeError(form);if(pinErr)throw new Error(pinErr)}
    const idErr=b2cIdError(form);if(idErr)throw new Error(idErr);
    await post('/billing/pending-sales/'+data.id+'/save-invoice',{invoice:{...form,buyer_state_code:buyerStateCode(form)}});onSaved()}catch(e){setError(e.message)}finally{setSaving(false)}};
  const F=(label,k,extra={})=><Field key={k} label={label} value={form[k]??''} onChange={v=>set(k,v)} {...extra}/>;
  const locked={readOnly:true};
  const h=t=><h3 style={{margin:'18px 0 6px'}}>{t}</h3>;
  return <div className="modal"><div className="modalbox" style={{maxWidth:1000}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h2>Create Sale · Tax Invoice</h2><p className="muted">Pending Sale ki saari details pre-filled hain. Save karte hi Bill No. generate hoga. <b>Dealer, Chassis, Customer Name, Father Name, Sale Amount aur Loan Amount locked hain</b> — baaki (Address, State, RTO, Ledger / Chassis Record / Voucher No., Subsidy, Amount / Tax) edit ho sakta hai. E-Way Bill e-Invoice ke baad activate hoga.</p></div><button className="btn" onClick={onClose}>×</button></div>
    <ErrorBanner message={error}/>
    {h('Invoice / Vehicle')}
    <div className="formgrid">
      {F('RTO Name (select first) *','rto_name',{type:'select',options:rtoOpts})}
      {F('Invoice Date','date',{type:'date'})}{F('Dealer · locked','dealer_name',locked)}{F('Dealer Page No.','dealer_page_no')}
      {F('Model','product_name')}{F('Chassis No. · locked','chassis_no',locked)}{F('Motor No.','motor_no')}{F('Controller No.','controller_no')}{F('Colour','colour')}
    </div>
    {h('1. Applicant Details')}
    <div className="formgrid">
      {F('Customer Name · locked','buyer_name',locked)}{F('Relation (S/O, D/O, C/O) · locked','buyer_relation',{type:'select',options:relationOptionsFor(form.buyer_relation).filter(o=>o.value),...locked})}{F('Buyer Father/Husband Name · locked','buyer_father_name',locked)}{F('Buyer Address','buyer_address')}
      {F('Buyer Pin Code *','buyer_pincode',{onChange:v=>set('buyer_pincode',normPincode(v))})}
      {F('Buyer State *','buyer_state',{type:'select',options:stateOptionsFor(form.buyer_state),value:stateValueFor(form.buyer_state),onChange:v=>setForm(f=>({...f,...stateFields(v)}))})}{F('Buyer State Code (auto)','buyer_state_code',{value:buyerStateCode(form),...locked})}
      {F('Intra/Inter State'+(stateTypeLocked?' (auto from state)':''),'state_type',{type:'select',options:STATE_TYPE_OPTIONS,readOnly:stateTypeLocked})}
      {F('Buyer Mobile','buyer_mobile')}{F('Buyer GSTIN (if any)','buyer_gst_no')}{F('Buyer PAN'+(b2c?' * (required, no GSTIN)':''),'buyer_pan')}{F('Buyer Aadhar'+(b2c?' * (required, no GSTIN)':''),'buyer_aadhar')}
      {F('Buyer Date of Birth','buyer_dob',{type:'date'})}
      {F('Mode / Term','mode_term')}{F('Bank Name','bank_name')}{F('Bank Account No.','bank_account_no')}{F('Bank IFSC','bank_ifsc')}
      {F('Despatch Through','despatch_through')}{F('License No.','license_no')}
      {F('CVR No.','cvr_no')}{F('Cancelled Cheque No.','cancelled_cheque_no')}{F('Remarks','remarks')}
    </div>
    {h('2. Internal')}
    <div className="formgrid">
      {F('Sale Amount (Internal) · locked','sale_amount',{type:'number',...locked})}{F('Amount Received','amount_received',{type:'number'})}
      {F('Financer Name (Hypothecation)','financer_name')}{F('Loan / Hypothecation Amount · locked','hypothecation_amount',{type:'number',...locked})}
      {F('Vehicle Reg. No.','vehicle_reg_no')}{F('Ledger No.','ledger_no')}{F('Chassis Record No.','chassis_record_no')}{F('Voucher No.','voucher_no')}
      {F('Subsidy Amount','subsidy_amount',{type:'number'})}{F('DO No.','do_no')}
    </div>
    {h('3. Amount / Tax')}
    <div className="formgrid">
      {F('GST Sale Amount','gst_sale_amount',{type:'number'})}{F('GST Rate %','gst_rate',{type:'number'})}{F('Insurance Amount','insurance_amount',{type:'number'})}
      {F('Registration Amount','registration_amount',{type:'number'})}{F('Discount','discount',{type:'number'})}
    </div>
    <div className="actions" style={{marginTop:16}}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save & Generate Bill No.'}</button></div>
  </div></div>
}

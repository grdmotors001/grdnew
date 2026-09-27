'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post, put } from '../lib/api';
import { Money } from './ui';

const emptyCustomer={name:'',phone:'',address:'',state:''};

export function DealerPendingSalesPage(){
  const [data,setData]=useState({applications:[],vehicles:[],dealers:[]});
  const [open,setOpen]=useState(null),[editingPage,setEditingPage]=useState(null);
  const [form,setForm]=useState({
    dealer_id:'',delivery_challan_id:'',application_id:'',
    customer_name:'',customer_phone:'',customer_address:'',customer_state:'',
    sale_type:'',sale_amount:'',loan_amount:'',page_no:'',do_no:'',
    internal_sale_details:''
  });
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);

  const load=async()=>{
    setError('');
    try{
      const d=await get('/dealer/pending-sales',{noClientCache:true,timeoutMs:15000});
      setData({applications:d.applications||[],vehicles:d.vehicles||[],dealers:d.dealers||[]});
    }catch(e){setError(e.message||'Could not load pending sales');}
  };
  useEffect(()=>{load()},[]);

  const selectedVehicle=useMemo(
    ()=>data.vehicles.find(v=>String(v.challan_id)===String(form.delivery_challan_id)),
    [data.vehicles,form.delivery_challan_id]
  );
  const selectedLoan=useMemo(
    ()=>data.applications.find(v=>String(v.id)===String(form.application_id)),
    [data.applications,form.application_id]
  );
  const dealerOptions=data.dealers||[];

  const openCreate=(loan=null)=>{
    const dealerId=loan?.dealer_id || dealerOptions[0]?.id || '';
    setOpen({loan});
    setForm({
      dealer_id:String(dealerId||''),
      delivery_challan_id:'',
      application_id:loan?.id?String(loan.id):'',
      customer_name:loan?.customer_name||'',
      customer_phone:loan?.customer_phone||'',
      customer_address:loan?.customer_address||'',
      customer_state:loan?.customer_state||'',
      sale_type:loan?.loan_vehicle_type||'',
      sale_amount:loan?.loan_amount?String(loan.loan_amount):'',
      loan_amount:loan?.loan_amount?String(loan.loan_amount):'',
      page_no:loan?.page_no||'',
      do_no:loan?.do_no||'',
      internal_sale_details:''
    });
    setError('');
  };

  const applyLoan=(id)=>{
    const x=data.applications.find(v=>String(v.id)===String(id));
    if(!x){
      setForm(f=>({...f,application_id:'',customer_name:'',customer_phone:'',customer_address:'',customer_state:''}));
      return;
    }
    setForm(f=>({
      ...f,application_id:String(x.id),
      customer_name:x.customer_name||'',
      customer_phone:x.customer_phone||'',
      customer_address:x.customer_address||'',
      customer_state:x.customer_state||'',
      sale_amount:x.loan_amount?String(x.loan_amount):f.sale_amount,
      loan_amount:x.loan_amount?String(x.loan_amount):f.loan_amount,
      sale_type:x.loan_vehicle_type||f.sale_type,
      do_no:x.do_no||f.do_no
    }));
  };

  const applyVehicle=(id)=>{
    const v=data.vehicles.find(x=>String(x.challan_id)===String(id));
    if(!v)return;
    setForm(f=>({
      ...f,delivery_challan_id:String(v.challan_id),
      dealer_id:String(v.dealer_id||f.dealer_id),
      sale_amount:f.sale_amount||String(v.sale_value||''),
      sale_type:f.sale_type||v.model_name||'New Rickshaw'
    }));
  };

  const save=async(e)=>{
    e.preventDefault(); setSaving(true);setError('');
    try{
      if(!form.dealer_id)throw new Error('Dealer select karo.');
      if(!form.delivery_challan_id)throw new Error('Pehle chassis / Delivery Challan select karo.');
      if(!form.customer_name.trim())throw new Error('Customer name required hai.');
      if(Number(form.loan_amount||0)>Number(form.sale_amount||0))throw new Error('Loan Amount Sale Amount se zyada nahi ho sakta.');
      await post('/billing/pending-sales/create',{
        ...form,
        dealer_id:Number(form.dealer_id),
        delivery_challan_id:Number(form.delivery_challan_id),
        application_id:form.application_id?Number(form.application_id):null,
        sale_amount:Number(form.sale_amount||0),
        loan_amount:Number(form.loan_amount||0),
        description:form.internal_sale_details||'Internal Sale'
      });
      setOpen(null);await load();
    }catch(e2){setError(e2.message||'Could not save Pending Sale');}
    finally{setSaving(false);}
  };

  return <div>
    <div className="dealerContentToolbar">
      <div className="dealerPageIntro"><span className="dealerSectionIcon">▤</span><div><strong>Pending Sales</strong><small>Loan Approved → Chassis → Customer → Internal Sale Details</small></div></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    {error&&!open&&<div className="error">{error}</div>}

    <div className="actions" style={{marginBottom:12}}>
      <button className="btn primary" onClick={()=>openCreate(null)}>＋ Create Pending Sale</button>
      <span className="muted" style={{alignSelf:'center'}}>Billed sales yahan nahi dikhengi.</span>
    </div>

    <div className="tablewrap dealerTable">
      <table className="table">
        <thead><tr><th>Application</th><th>Customer</th><th>Dealer</th><th>Loan Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {data.applications.map(r=><tr key={r.id}>
            <td><b>{r.application_no||('Loan #'+r.id)}</b></td>
            <td>{r.customer_name||'—'}<div className="muted">{r.customer_phone||''}</div></td>
            <td>{r.dealer_name||'—'}</td>
            <td><Money value={r.loan_amount}/></td>
            <td><span className="pill d">Loan Approved</span></td>
            <td><button className="btn primary" onClick={()=>openCreate(r)}>Create Pending Sale</button></td>
          </tr>)}
          {!data.applications.length&&<tr><td colSpan="6"><div className="dealerEmpty">No unbilled Loan Approved application found.</div></td></tr>}
        </tbody>
      </table>
    </div>

    {open&&<div className="modal" style={{zIndex:10000}}>
      <form className="modalbox" onSubmit={save} style={{maxWidth:900}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
          <div><h2 style={{margin:0}}>Create Pending Sale</h2><p className="muted">Pehle Dealer / Chassis select karo. Vehicle details automatically fetch hongi.</p></div>
          <button type="button" className="btn" onClick={()=>setOpen(null)}>✕</button>
        </div>
        {error&&<div className="error" style={{marginTop:10}}>{error}</div>}

        <div className="card" style={{marginTop:14}}>
          <h3 style={{marginTop:0}}>1. Dealer & Vehicle</h3>
          <div className="formgrid">
            <label>Dealer
              <select className="input" value={form.dealer_id} onChange={e=>setForm({...form,dealer_id:e.target.value,delivery_challan_id:''})} required>
                <option value="">Select Dealer</option>
                {dealerOptions.map(d=><option key={d.id} value={d.id}>{d.name}{d.code?' · '+d.code:''}</option>)}
              </select>
            </label>
            <label>Chassis / Delivery Challan
              <select className="input" value={form.delivery_challan_id} onChange={e=>applyVehicle(e.target.value)} required>
                <option value="">Select Chassis No.</option>
                {data.vehicles.filter(v=>!form.dealer_id||String(v.dealer_id)===String(form.dealer_id)).map(v=>
                  <option key={v.challan_id} value={v.challan_id}>{v.chassis_no||'No Chassis'} · {v.challan_no||'DC'} · {v.model_name||v.product_name||''}</option>
                )}
              </select>
            </label>
          </div>
          {selectedVehicle&&<div className="dealerCreateSalePreview" style={{marginTop:12}}>
            <div className="dealerCreateSalePreviewHead"><strong>Vehicle Details</strong><span>{selectedVehicle.chassis_no||'—'}</span></div>
            <div className="dealerCreateSalePreviewGrid">
              <div><span>Model</span><b>{selectedVehicle.model_name||selectedVehicle.product_name||'—'}</b></div>
              <div><span>Colour</span><b>{selectedVehicle.colour||selectedVehicle.vehicle_colour||'—'}</b></div>
              <div><span>Battery Maker</span><b>{selectedVehicle.battery_maker||'—'}</b></div>
              <div><span>Battery 1</span><b>{selectedVehicle.battery_no1||'—'}</b></div>
              <div><span>Battery 2</span><b>{selectedVehicle.battery_no2||'—'}</b></div>
              <div><span>Battery 3</span><b>{selectedVehicle.battery_no3||'—'}</b></div>
              <div><span>Battery 4</span><b>{selectedVehicle.battery_no4||'—'}</b></div>
            </div>
          </div>}
        </div>

        <div className="card" style={{marginTop:14}}>
          <h3 style={{marginTop:0}}>2. Customer Details</h3>
          <div className="formgrid">
            <label>Loan Approved Customer
              <select className="input" value={form.application_id} onChange={e=>applyLoan(e.target.value)}>
                <option value="">Manual Customer / No Loan Approved</option>
                {data.applications.map(x=><option key={x.id} value={x.id}>{x.application_no||x.id} · {x.customer_name||'Customer'} · {x.customer_phone||'No Mobile'}</option>)}
              </select>
            </label>
            <label>Customer Name<input className="input" value={form.customer_name} onChange={e=>setForm({...form,customer_name:e.target.value})} required/></label>
            <label>Mobile<input className="input" value={form.customer_phone} onChange={e=>setForm({...form,customer_phone:e.target.value})}/></label>
            <label>State<input className="input" value={form.customer_state} onChange={e=>setForm({...form,customer_state:e.target.value})}/></label>
            <label style={{gridColumn:'1 / -1'}}>Address<input className="input" value={form.customer_address} onChange={e=>setForm({...form,customer_address:e.target.value})}/></label>
          </div>
          {selectedLoan&&<div className="muted" style={{marginTop:8}}>Customer details Loan Approved record se auto-filled hain; zarurat ho to edit bhi kar sakte ho.</div>}
        </div>

        <div className="card" style={{marginTop:14}}>
          <h3 style={{marginTop:0}}>3. Internal Sale Details</h3>
          <div className="formgrid">
            <label>Sale Type<input className="input" value={form.sale_type} onChange={e=>setForm({...form,sale_type:e.target.value})} placeholder="New Rickshaw / Old Rickshaw / etc."/></label>
            <label>Dealer Page No.<input className="input" value={form.page_no} onChange={e=>setForm({...form,page_no:e.target.value})}/></label>
            <label>Sale Amount<input className="input" type="number" min="0" value={form.sale_amount} onChange={e=>setForm({...form,sale_amount:e.target.value})} required/></label>
            <label>Loan Amount<input className="input" type="number" min="0" value={form.loan_amount} onChange={e=>setForm({...form,loan_amount:e.target.value})}/></label>
            <label>Balance<input className="input" value={Math.max(0,Number(form.sale_amount||0)-Number(form.loan_amount||0)).toLocaleString('en-IN')} readOnly/></label>
            <label>DO No.<input className="input" value={form.do_no} onChange={e=>setForm({...form,do_no:e.target.value})}/></label>
            <label style={{gridColumn:'1 / -1'}}>Internal Sale Details / Remarks
              <textarea className="input" rows="4" value={form.internal_sale_details} onChange={e=>setForm({...form,internal_sale_details:e.target.value})} placeholder="Internal sale details, remarks, reference…"/>
            </label>
          </div>
        </div>

        <div className="actions" style={{marginTop:16}}>
          <button type="button" className="btn" onClick={()=>setOpen(null)}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Pending Sale'}</button>
        </div>
      </form>
    </div>}

    {editingPage&&<div className="modal"><div className="modalbox"><h2>Edit Page No.</h2><p className="muted">{editingPage.application_no||editingPage.customer_name}</p><div className="field"><label>Page No.</label><input className="input" value={editingPage.page_no||''} onChange={e=>setEditingPage({...editingPage,page_no:e.target.value})}/></div><div className="actions" style={{marginTop:16}}><button className="btn" onClick={()=>setEditingPage(null)}>Cancel</button><button className="btn primary" disabled={saving} onClick={async()=>{setSaving(true);setError('');try{await put('/dealer/pending-sales/'+editingPage.id+'/page',{page_no:editingPage.page_no});setEditingPage(null);load()}catch(e){setError(e.message||'Could not update page number')}finally{setSaving(false)}}}>Save Page No.</button></div></div></div>}
  </div>;
}

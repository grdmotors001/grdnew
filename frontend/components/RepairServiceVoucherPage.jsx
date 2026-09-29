'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';

const today=()=>new Date().toISOString().slice(0,10);
const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;

export function RepairServiceVoucherPage(){
  const [tab,setTab]=useState('voucher');
  const [rows,setRows]=useState([]);
  const [rawItems,setRawItems]=useState([]); const [dispatchItems,setDispatchItems]=useState([]);
  const [vehicles,setVehicles]=useState([]);
  const [vehicleSearch,setVehicleSearch]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [msg,setMsg]=useState('');
  const [filter,setFilter]=useState('');
  const [branches,setBranches]=useState([]);
  const [form,setForm]=useState({
    date:today(),dealer_id:'',customer_name:'',customer_mobile:'',vehicle_no:'',chassis_no:'',vehicle_id:'',remarks:'',
    items:[{item_id:'',item_code:'',item_name:'',qty:1,rate:'',unit:'PCS',item_type:'R'}]
  });

  const load=async()=>{
    try{
      const [v,m,d]=await Promise.all([
        get('/repair-service-vouchers'+(filter?'?status='+filter:'')),
        get('/repair-service-masters'),
        get('/dealers').catch(()=>({dealers:[]}))
      ]);
      const all=Array.isArray(d)?d:(d.dealers||[]);
      const shows=all.filter(x=>String(x.dealer_category||'').toLowerCase()==='showroom');
      setBranches(shows.length?shows:all);
      setRows(v.vouchers||[]);
      setRawItems(m.raw_items||[]);setDispatchItems(m.dispatch_items||[]);setVehicles(m.vehicles||[]);
    }catch(e){setError(e.message||'Could not load repair/service data')}
  };
  useEffect(()=>{load()},[filter]);

  const set=(k,v)=>setForm(x=>({...x,[k]:v}));
  const updateItem=(i,k,v)=>setForm(x=>({...x,items:x.items.map((it,n)=>n===i?{...it,[k]:v}:it)}));
  const addItem=()=>setForm(x=>({...x,items:[...x.items,{item_id:'',item_code:'',item_name:'',qty:1,rate:'',unit:'PCS',item_type:'R'}]}));
  const removeItem=i=>setForm(x=>({...x,items:x.items.length>1?x.items.filter((_,n)=>n!==i):x.items}));
  const total=useMemo(()=>form.items.reduce((s,x)=>s+Number(x.qty||0)*Number(x.rate||0),0),[form.items]);
  const lookupVehicle=async(value)=>{
    const no=(value||'').trim();
    setVehicleSearch(no);
    set('vehicle_no',no);
    if(!no){ setForm(x=>({...x,vehicle_id:'',chassis_no:'',customer_name:'',customer_mobile:''})); return; }
    try{
      const m=await get('/repair-service-masters?vehicle_no='+encodeURIComponent(no));
      const v=(m.vehicles||[])[0];
      if(v){
        setForm(x=>({...x,vehicle_id:String(v.vehicle_id),vehicle_no:v.vehicle_no||no,chassis_no:v.chassis_no||'',customer_name:v.customer_name||'',customer_mobile:v.customer_mobile||''}));
        setVehicles(m.vehicles||[]);
      }else{
        setForm(x=>({...x,vehicle_id:'',vehicle_no:no,chassis_no:'',customer_name:'',customer_mobile:''}));
      }
    }catch(e){setError(e.message||'Vehicle lookup failed')}
  };

  async function saveVoucher(e){
    e.preventDefault();setSaving(true);setError('');setMsg('');
    try{
      if(!form.vehicle_no.trim())throw new Error('Vehicle No. is required.');
      if(!form.dealer_id)throw new Error('Showroom / Branch select karein.');
      if(!form.customer_name.trim())throw new Error('Customer Name is required.');
      const clean=form.items.map(x=>({...x,qty:Number(x.qty),rate:Number(x.rate)}));
      if(clean.some(x=>!x.item_name.trim()||x.qty<=0||x.rate<0))throw new Error('Raw Item, Qty and Rate correctly fill karein.');
      const r=await post('/repair-service-vouchers',{...form,items:clean});
      setMsg('Repair / Service Voucher '+r.voucher.voucher_no+' created. GST: ₹0');
      setForm({date:today(),dealer_id:form.dealer_id,customer_name:'',customer_mobile:'',vehicle_no:'',chassis_no:'',vehicle_id:'',remarks:'',items:[{item_id:'',item_code:'',item_name:'',qty:1,rate:'',unit:'PCS',item_type:'R'}]});
      await load();
    }catch(e){setError(e.message||'Could not save voucher')}finally{setSaving(false)}
  }

  return <div className="page">
    <div className="pageHeader">
      <div><h1>Repair &amp; Service Voucher</h1><p className="muted">Factory Repair / Service · GST not applicable</p></div>
    </div>
    {error&&<div className="error">{error}</div>}
    {msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}

    <div className="actions" style={{marginBottom:14}}>
      <button className={'btn '+(tab==='voucher'?'primary':'')} onClick={()=>setTab('voucher')}>Repair / Service Voucher</button>
      <button className={'btn '+(tab==='register'?'primary':'')} onClick={()=>setTab('register')}>Register</button>
    </div>

    {tab==='voucher'&&<form className="card" onSubmit={saveVoucher}>
      <h2>New Repair / Service Voucher</h2>
      <div className="grid">
        <input className="input" type="date" value={form.date} onChange={e=>set('date',e.target.value)} required/>
        <select className="input" value={form.dealer_id} onChange={e=>set('dealer_id',e.target.value)} required>
          <option value="">Select Showroom / Branch *</option>
          {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div>
          <input className="input" placeholder="Vehicle No. *" value={vehicleSearch||form.vehicle_no} onChange={e=>setVehicleSearch(e.target.value)} onBlur={e=>lookupVehicle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();lookupVehicle(e.currentTarget.value)}}} required/>
          <small className="muted">{form.vehicle_id?'Existing record found — details auto-filled below.':vehicleSearch||form.vehicle_no?'No existing record for this vehicle — fill details below as new.':'Enter Vehicle No. and press Tab/Enter to pull existing details, or fill as new.'}</small>
        </div>
        <input className="input" placeholder="Customer Name" value={form.customer_name} onChange={e=>set('customer_name',e.target.value)} required/>
        <input className="input" placeholder="Mobile No." value={form.customer_mobile} onChange={e=>set('customer_mobile',e.target.value)}/>
        <input className="input" placeholder="Chassis No." value={form.chassis_no} onChange={e=>set('chassis_no',e.target.value)} />
        <input className="input" placeholder="Remarks" value={form.remarks} onChange={e=>set('remarks',e.target.value)}/>
      </div>

      <div className="card" style={{marginTop:14}}>
        <div className="actions" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}>Raw Material / Dispatch Item Used <span className="muted" style={{fontSize:12}}>GST 0%</span></h3><button type="button" className="btn" onClick={addItem}>+ Add Item</button></div>
        <div className="tablewrap"><table className="table"><thead><tr><th>Item / Service</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
          <tbody>{form.items.map((it,i)=><tr key={i}>
            <td>
              {/* Bug fix: the <select>'s controlled value was bound to
                  it.item_code (e.g. "RM045") while each <option value>
                  was the raw item's numeric id — they never matched, so
                  the dropdown always snapped back to "Select Raw Item"
                  right after picking something. Now both use item_id. */}
              <select className="input" value={it.item_id||''} onChange={e=>{const p=[...rawItems,...dispatchItems].find(x=>String(x.id)===String(e.target.value)); updateItem(i,'item_id',e.target.value); updateItem(i,'item_code',p?.code||''); updateItem(i,'item_name',p?.name||''); updateItem(i,'unit',p?.unit||'PCS'); updateItem(i,'item_type',String(p?.product_category||'').toUpperCase()==='DISPATCH'?'DISPATCH':'R')}}>
                <option value="">Select Raw / Dispatch Item</option>
                {rawItems.length>0&&<optgroup label="Raw Material">{rawItems.map(p=><option key={'r'+p.id} value={p.id}>{p.name} — Stock {Number(p.stock_qty||0).toLocaleString('en-IN')}</option>)}</optgroup>}
                {dispatchItems.length>0&&<optgroup label="Dispatch Item">{dispatchItems.map(p=><option key={'d'+p.id} value={p.id}>{p.name} — Stock {Number(p.stock_qty||0).toLocaleString('en-IN')}</option>)}</optgroup>}
              </select>
              {!rawItems.length&&!dispatchItems.length&&<small className="muted">Product Master me Raw (R) ya Dispatch item add karein.</small>}
            </td>
            <td><input className="input" type="number" min="0.01" step="0.01" value={it.qty} onChange={e=>updateItem(i,'qty',e.target.value)}/></td>
            <td><input className="input" type="number" min="0" step="0.01" value={it.rate} placeholder="Rate" onChange={e=>updateItem(i,'rate',e.target.value)}/></td>
            <td><b>{money(Number(it.qty||0)*Number(it.rate||0))}</b></td>
            <td><button type="button" className="btn" onClick={()=>removeItem(i)}>Remove</button></td>
          </tr>)}</tbody>
        </table></div>
        <div style={{textAlign:'right',marginTop:12,fontSize:16}}>
          <div>Taxable / Service Value: <b>{money(total)}</b></div>
          <div>GST: <b>₹0</b></div>
          <div style={{fontSize:20,marginTop:4}}>Total: <b>{money(total)}</b></div>
        </div>
      </div>
      <button className="btn primary" disabled={saving} style={{marginTop:14}}>{saving?'Saving…':'Create Voucher'}</button>
    </form>}

    {tab==='register'&&<div className="card">
      <div className="actions" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
        <div><h2 style={{margin:0}}>Repair / Service Register</h2><small className="muted">Paid / Balance read-only hai — payment receipt authorised Dealer portal (Repair Receipt) se banti hai.</small></div>
        <div className="actions">
          <button className={'btn '+(!filter?'primary':'')} onClick={()=>setFilter('')}>All</button>
          <button className={'btn '+(filter==='unpaid'?'primary':'')} onClick={()=>setFilter('unpaid')}>Unpaid</button>
          <button className={'btn '+(filter==='paid'?'primary':'')} onClick={()=>setFilter('paid')}>Paid</button>
        </div>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Voucher No.</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Vehicle No.</th><th>Chassis No.</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
      <tbody>{rows.map(v=><tr key={v.id}><td><b>{v.voucher_no}</b></td><td>{v.date}</td><td>{v.customer_name}</td><td>{v.customer_mobile||'—'}</td><td>{v.vehicle_no||'—'}</td><td>{v.chassis_no||'—'}</td><td>{v.items.length}</td><td>{money(v.total_amount)}</td><td>{money(v.paid_amount)}</td><td>{money(v.balance_amount)}</td><td>{v.payment_status}</td></tr>)}{!rows.length&&<tr><td colSpan="11" className="muted">No repair/service vouchers found.</td></tr>}</tbody></table></div>
    </div>}

  </div>
}

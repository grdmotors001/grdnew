'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner, Money } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0,10);

export function CreditNotePage(){
  const [data,setData]=useState(null);
  const [legacy,setLegacy]=useState([]);
  const [open,setOpen]=useState(false);
  const [invoices,setInvoices]=useState([]);
  const [form,setForm]=useState({date:today(),reason:'',remarks:''});
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);

  const load=async()=>{
    setError('');
    try{
      const [cn,ti,lg]=await Promise.all([
        get('/credit-notes?page=1&per_page=100'),
        get('/tax-invoices?page=1&per_page=100'),
        get('/credit-notes/legacy-scan')
      ]);
      setData(cn.credit_notes||[]);
      setInvoices((ti.invoices||[]).filter(x=>!x.cancelled));
      setLegacy(lg.invoices||[]);
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[]);

  const selected=invoices.find(x=>String(x.id)===String(form.invoice_id));
  const issue=async(e)=>{
    e.preventDefault();
    if(!form.invoice_id){setError('Select the original Tax Invoice.');return}
    if(!form.reason.trim()){setError('Credit Note reason is required.');return}
    if(!confirm('Issue Credit Note against this Tax Invoice? The original invoice will remain in history as cancelled.'))return;
    setSaving(true);setError('');
    try{
      const r=await post('/credit-notes',form);
      alert('Credit Note created: '+r.credit_note_no);
      setOpen(false);setForm({date:today(),reason:'',remarks:''});load();
    }catch(e){setError(e.message)}finally{setSaving(false)}
  };

  const cancelChallan=async cn=>{
    if(!cn.delivery_challan_id){alert('No Delivery Challan linked.');return}
    if(!confirm('Credit Note is already issued. Cancel the linked Delivery Challan and return chassis to Manufacturing?'))return;
    try{
      await post('/credit-notes/'+cn.id+'/cancel-challan',{});
      alert('Delivery Challan cancelled. Now create a new Delivery Challan for the new dealer.');
      load();
    }catch(e){setError(e.message)}
  };

  const repairLegacy=async id=>{
    if(!confirm('Convert this old imported CN record into a formal Legacy Credit Note? Original bill/chassis text will be preserved.'))return;
    try{await post('/credit-notes/legacy-repair/'+id,{});load()}catch(e){setError(e.message)}
  };

  if(!data)return <div className="card">Loading…</div>;

  return <div className="page">
    <div className="pageHeader">
      <div><h2>Credit Note</h2><p className="muted">Proper Credit Note → Cancel Delivery Challan → New Challan → New Bill.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>

    <div className="card" style={{marginBottom:14}}>
      <div className="actions" style={{justifyContent:'space-between'}}>
        <div>
          <h3 style={{marginTop:0}}>Issue Credit Note</h3>
          <p className="muted">Old method me chassis ke end me CN lagane ki zarurat nahi. Original invoice history safe rahegi.</p>
        </div>
        <button className="btn primary" onClick={()=>{setForm({date:today(),reason:'',remarks:''});setOpen(true)}}>+ New Credit Note</button>
      </div>
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th><th>CN No.</th><th>Original Bill</th><th>Dealer</th><th>Customer</th><th>Chassis</th><th>Amount</th><th>Action</th>
      </tr></thead>
      <tbody>{data.map(cn=><tr key={cn.id}>
        <td>{formatDate(cn.date)}</td><td><b>{cn.credit_note_no}</b></td><td>{cn.original_bill_no||'—'}</td>
        <td>{cn.dealer_name||'—'}</td><td>{cn.buyer_name||'—'}</td><td><b>{cn.chassis_no||'—'}</b></td>
        <td><Money value={cn.total_amount}/></td>
        <td>{cn.delivery_challan_id&&<button className="btn" onClick={()=>cancelChallan(cn)}>Cancel Challan</button>}</td>
      </tr>)}
      {!data.length&&<tr><td colSpan="8" className="muted">No Credit Notes yet.</td></tr>}</tbody></table></div>
    </div>

    <div className="card">
      <h3 style={{marginTop:0}}>Imported Old CN Records — Repair</h3>
      <p className="muted">Ye section sirf purane imported records ko identify karta hai. Original bill/chassis text change nahi hota; repair karne par formal Legacy Credit Note banega aur safe vehicle ko Manufacturing me return kiya jayega.</p>
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Bill</th><th>Date</th><th>Chassis</th><th>Dealer</th><th>Total</th><th>Status</th><th>Action</th>
      </tr></thead>
      <tbody>{legacy.map(r=><tr key={r.id}>
        <td>{r.bill_no||'—'}</td><td>{formatDate(r.date)}</td><td><b>{r.chassis_no||'—'}</b></td>
        <td>{r.dealer_name||'—'}</td><td><Money value={r.bill_total}/></td>
        <td>{r.formal_credit_note_no||'Not repaired'}</td>
        <td>{!r.formal_credit_note_no&&<button className="btn primary" onClick={()=>repairLegacy(r.id)}>Repair Legacy CN</button>}</td>
      </tr>)}
      {!legacy.length&&<tr><td colSpan="7" className="muted">No old CN-pattern records found.</td></tr>}</tbody></table></div>
    </div>

    {open&&<div className="modal"><form className="modalbox" onSubmit={issue}>
      <h2>New Credit Note</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Original Tax Invoice" type="select" value={form.invoice_id||''}
          options={[{value:'',label:'Select Invoice'},...invoices.map(i=>({value:i.id,label:(i.bill_no||'No Bill')+' — '+(i.chassis_no||'')+' — '+(i.buyer_name||'')}))]}
          onChange={v=>setForm({...form,invoice_id:Number(v)})} required/>
        <Field label="Credit Note Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})} required/>
        <Field label="Reason" value={form.reason} onChange={v=>setForm({...form,reason:v})} required/>
        <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
      </div>
      {selected&&<div className="card" style={{marginTop:12}}>
        <b>Original Invoice</b><div className="formgrid" style={{marginTop:8}}>
          <div><span className="muted">Dealer</span><br/>{selected.dealer_name||'—'}</div>
          <div><span className="muted">Customer</span><br/>{selected.buyer_name||'—'}</div>
          <div><span className="muted">Chassis</span><br/>{selected.chassis_no||'—'}</div>
          <div><span className="muted">Taxable</span><br/><Money value={selected.taxable_value}/></div>
          <div><span className="muted">GST</span><br/><Money value={(Number(selected.cgst_amount)||0)+(Number(selected.sgst_amount)||0)+(Number(selected.igst_amount)||0)}/></div>
          <div><span className="muted">Total</span><br/><Money value={selected.bill_total}/></div>
        </div>
      </div>}
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}>
        <button type="button" className="btn" onClick={()=>setOpen(false)}>Close</button>
        <button className="btn primary" disabled={saving}>{saving?'Creating…':'Issue Credit Note'}</button>
      </div>
    </form></div>}
  </div>
}

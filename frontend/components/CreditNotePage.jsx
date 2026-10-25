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
  const [cnSearch,setCnSearch]=useState('');
  const [legacySearch,setLegacySearch]=useState('');
  const [saving,setSaving]=useState(false);
  const [invSearch,setInvSearch]=useState('');
  const [invBusy,setInvBusy]=useState(false);
  const [picked,setPicked]=useState(null);

  const load=async()=>{
    setError('');
    try{
      const [cn,ti,lg]=await Promise.all([
        get('/credit-notes?page=1&per_page=100'),
        get('/tax-invoices?page=1&per_page=30&challans=0'),
        get('/credit-notes/legacy-scan')
      ]);
      setData(cn.credit_notes||[]);
      setInvoices((ti.invoices||[]).filter(x=>!x.cancelled));
      setLegacy(lg.invoices||[]);
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[]);

  // Original Tax Invoice search: server par search hota hai (bill no, chassis, customer, motor no),
  // taaki purane invoices bhi mil sakein, sirf last 100 nahi.
  useEffect(()=>{
    if(!open)return;
    let dead=false;
    const t=setTimeout(async()=>{
      setInvBusy(true);
      try{
        const r=await get('/tax-invoices?page=1&per_page=30&challans=0&search='+encodeURIComponent(invSearch.trim()));
        if(!dead)setInvoices((r.invoices||[]).filter(x=>!x.cancelled));
      }catch(e){}finally{if(!dead)setInvBusy(false)}
    },invSearch.trim()?300:0);
    return()=>{dead=true;clearTimeout(t)};
  },[invSearch,open]);

  const q1=cnSearch.trim().toLowerCase();
  const q2=legacySearch.trim().toLowerCase();
  const creditRows=(data||[]).filter(r=>!q1||[r.credit_note_no,r.original_bill_no,r.dealer_name,r.buyer_name,r.chassis_no,r.total_amount].join(' ').toLowerCase().includes(q1));
  const legacyRows=legacy.filter(r=>!q2||[r.bill_no,r.chassis_no,r.dealer_name,r.bill_total,r.formal_credit_note_no].join(' ').toLowerCase().includes(q2));

  const selected=picked&&String(picked.id)===String(form.invoice_id)?picked:invoices.find(x=>String(x.id)===String(form.invoice_id));
  const issue=async(e)=>{
    e.preventDefault();
    if(!form.invoice_id){setError('Select the original Tax Invoice.');return}
    if(!form.reason.trim()){setError('Credit Note reason is required.');return}
    if(!confirm('Issue Credit Note against this Tax Invoice? The original invoice will remain in history as cancelled.'))return;
    setSaving(true);setError('');
    try{
      const r=await post('/credit-notes',form);
      alert('Credit Note created: '+r.credit_note_no);
      setOpen(false);setPicked(null);setInvSearch('');setForm({date:today(),reason:'',remarks:''});load();
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
        <button className="btn primary" onClick={()=>{setForm({date:today(),reason:'',remarks:''});setPicked(null);setInvSearch('');setOpen(true)}}>+ New Credit Note</button>
      </div>
      <input className="input" style={{width:'100%',maxWidth:480,margin:'0 0 12px'}} placeholder="Search CN no., bill, dealer, customer, chassis…" value={cnSearch} onChange={e=>setCnSearch(e.target.value)} />
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th><th>CN No.</th><th>Original Bill</th><th>Dealer</th><th>Customer</th><th>Chassis</th><th>Amount</th><th>Action</th>
      </tr></thead>
      <tbody>{creditRows.map(cn=><tr key={cn.id}>
        <td>{formatDate(cn.date)}</td><td><b>{cn.credit_note_no}</b></td><td>{cn.original_bill_no||'—'}</td>
        <td>{cn.dealer_name||'—'}</td><td>{cn.buyer_name||'—'}</td><td><b>{cn.chassis_no||'—'}</b></td>
        <td><Money value={cn.total_amount}/></td>
        <td>{cn.delivery_challan_id&&(cn.challan_shifted_to?<span className="muted">Challan shifted → <b>{cn.challan_shifted_to}</b></span>:cn.challan_cancelled?<span className="muted">Challan cancelled</span>:<button className="btn" onClick={()=>cancelChallan(cn)}>Cancel Challan</button>)}</td>
      </tr>)}
      {!data.length&&<tr><td colSpan="8" className="muted">No Credit Notes yet.</td></tr>}</tbody></table></div>
    </div>

    <div className="card">
      <h3 style={{marginTop:0}}>Imported Old CN Records — Repair</h3>
      <p className="muted">Ye section sirf purane imported records ko identify karta hai. Original bill/chassis text change nahi hota; repair karne par formal Legacy Credit Note banega aur safe vehicle ko Manufacturing me return kiya jayega.</p>
      <input className="input" style={{width:'100%',maxWidth:480,margin:'0 0 12px'}} placeholder="Search old bill, chassis, dealer, status…" value={legacySearch} onChange={e=>setLegacySearch(e.target.value)} />
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Bill</th><th>Date</th><th>Chassis</th><th>Dealer</th><th>Total</th><th>Status</th><th>Action</th>
      </tr></thead>
      <tbody>{legacyRows.map(r=><tr key={r.id}>
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
        <div className="field" style={{gridColumn:'1 / -1'}}>
          <label>Original Tax Invoice *</label>
          <input className="input" autoFocus placeholder="Bill no., chassis, customer ya motor no. se search karein…" value={invSearch} onChange={e=>setInvSearch(e.target.value)} />
          <div style={{maxHeight:200,overflowY:'auto',border:'1px solid var(--line)',borderRadius:8,marginTop:6}}>
            {invBusy&&<div className="muted" style={{padding:8}}>Searching…</div>}
            {!invBusy&&!invoices.length&&<div className="muted" style={{padding:8}}>Koi invoice nahi mila.</div>}
            {invoices.map(i=>{const on=String(form.invoice_id)===String(i.id);return <div key={i.id} onClick={()=>{setPicked(i);setForm({...form,invoice_id:Number(i.id)})}}
              style={{padding:'8px 10px',cursor:'pointer',borderBottom:'1px solid var(--line)',background:on?'var(--accent)':'transparent',color:on?'#fff':'inherit',fontSize:13}}>
              <b>{i.bill_no||'No Bill'}</b> — {i.chassis_no||''} — {i.buyer_name||''}
            </div>})}
          </div>
          {selected&&<div className="muted" style={{marginTop:6}}>Selected: <b>{selected.bill_no}</b> — {selected.chassis_no}</div>}
        </div>
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

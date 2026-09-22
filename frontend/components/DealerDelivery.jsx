'use client';

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';

const money = v => `₹${Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const today = () => new Date().toISOString().slice(0,10);

export function DealerDelivery({ onBack }) {
  const [data,setData]=useState({customers:[],new_stock:[],old_stock:[],battery_stock:[],do_numbers:[],approved_loans:[]});
  const [saleAmount,setSaleAmount]=useState('');
  const [loanAmount,setLoanAmount]=useState('');
  const [loanWorkflowId,setLoanWorkflowId]=useState('');
  const [fileCharge,setFileCharge]=useState('');
  const [miscCharge,setMiscCharge]=useState('');
  const [customerId,setCustomerId]=useState('');
  const [type,setType]=useState('new');
  const [vehicleId,setVehicleId]=useState('');
  const [oldId,setOldId]=useState('');
  const [date,setDate]=useState(today());
  const [remarks,setRemarks]=useState('');
  const [doNo,setDoNo]=useState('');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  async function load(){
    setLoading(true); setError('');
    try { const [d,o]=await Promise.all([get('/dealer/delivery/options'),get('/dealer/delivery/do-options')]); setData({...d,do_numbers:o.do_numbers||[]}); }
    catch(e){ setError(e.message || 'Could not load delivery options'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{load()},[]);

  const customers = useMemo(()=>{
    const q=search.trim().toLowerCase();
    if(!q) return data.customers||[];
    return (data.customers||[]).filter(c =>
      [c.page_no,c.name,c.phone,c.vehicle_no].join(' ').toLowerCase().includes(q)
    );
  },[data.customers,search]);

  const customer=(data.customers||[]).find(c=>String(c.id)===String(customerId));
  useEffect(()=>{
    if(customer){ setSaleAmount(String(customer.sale_amount||0)); setLoanAmount(String(customer.loan_amount||0)); setLoanWorkflowId(''); }
    else { setSaleAmount(''); setLoanAmount(''); setLoanWorkflowId(''); }
  },[customerId]);
  const isLoan=Number(customer?.loan_amount||0)>0;
  const stock=type==='new' ? data.new_stock||[] : data.old_stock||[];
  const approvedLoans=(data.approved_loans||[]).filter(x=>!customerId || String(x.customer_id)===String(customerId));

  async function submit(e){
    e.preventDefault(); setSaving(true); setError(''); setMessage('');
    try{
      const payload={customer_id:customerId,delivery_type:type,date,remarks,do_no:isLoan?doNo:'',sale_amount:saleAmount,loan_amount:loanAmount,file_charge:fileCharge,misc_charge:miscCharge,loan_workflow_id:Number(loanWorkflowId)||null};
      if(type==='new') payload.vehicle_id=vehicleId;
      if(type==='old') payload.old_rickshaw_id=oldId;
      const d=await post('/dealer/delivery',payload);
      setMessage(`Delivery ${d.delivery.delivery_no} saved successfully.`);
      setCustomerId(''); setVehicleId(''); setOldId(''); setSearch(''); setRemarks(''); setDoNo(''); setSaleAmount(''); setLoanAmount(''); setLoanWorkflowId(''); setFileCharge(''); setMiscCharge('');
      await load();
    }catch(e){setError(e.message || 'Could not save delivery')}
    finally{setSaving(false)}
  }

  return <div className="dealerLoanPage">
    <div className="dealerPanel" style={{maxWidth:980}}>
      <div className="dealerPanelHead">
        <div>
          <h3>Delivery</h3>
          <p>Customer delivery entry for showroom branch</p>
        </div>
        {onBack && <button className="btn" type="button" onClick={onBack}>Back</button>}
      </div>

      {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
      {message&&<div className="card" style={{marginBottom:12}}>{message}</div>}

      {loading ? <div className="dealerEmpty">Loading customers and stock…</div> :
      <form onSubmit={submit}>
        <div className="grid">
          <div>
            <label className="muted">Date</label>
            <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} required/>
          </div>

          <div>
            <label className="muted">Customer</label>
            <input className="input" placeholder="Search name / mobile / page no." value={search}
              onChange={e=>{setSearch(e.target.value);setCustomerId('')}}/>
            <select className="input" style={{marginTop:7}} value={customerId} onChange={e=>setCustomerId(e.target.value)} required>
              <option value="">Select customer — not yet delivered</option>
              {customers.map(c=><option key={c.id} value={c.id}>{c.page_no||'—'} · {c.name} · {c.phone||'No mobile'}</option>)}
            </select>
          </div>

          <div>
            <label className="muted">Delivery Type</label>
            <select className="input" value={type} onChange={e=>{setType(e.target.value);setVehicleId('');setOldId('')}}>
              <option value="new">New Rickshaw</option>
              <option value="old">Old Rickshaw</option>
              <option value="battery">Battery</option>
            </select>
          </div>

          {type==='new'&&<div>
            <label className="muted">Chassis No. from Stock</label>
            <select className="input" value={vehicleId} onChange={e=>setVehicleId(e.target.value)} required>
              <option value="">Select chassis</option>
              {stock.map(v=><option key={v.id} value={v.id}>{v.chassis_no} · {v.model_name||'Model'}</option>)}
            </select>
          </div>}

          {type==='old'&&<div>
            <label className="muted">Old Vehicle No.</label>
            <select className="input" value={oldId} onChange={e=>setOldId(e.target.value)} required>
              <option value="">Select vehicle</option>
              {stock.map(v=><option key={v.id} value={v.id}>{v.vehicle_no||'—'} · {v.model_name||'Model'}</option>)}
            </select>
          </div>}

          {isLoan&&<div>
            <label className="muted">DO No. (Loan Case)</label>
            <select className="input" value={doNo} onChange={e=>setDoNo(e.target.value)}>
              <option value="">Select DO No. — Billing can select later</option>
              {(data.do_numbers||[]).map(x=><option key={x.id} value={x.do_no}>{x.do_no} · {x.customer_name||x.application_no}</option>)}
            </select>
            <small className="muted">DO ek hi baar select hoga. Dealer select kare to Billing ko dobara select nahi karna padega.</small>
          </div>}

          {type==='battery'&&<div className="card" style={{padding:12}}>
            <b>Battery delivery</b>
            <div className="muted">Battery stock selection with quantity will be added next. This delivery type is intentionally not submitted yet.</div>
          </div>}
        </div>

        {customer&&<div className="card" style={{marginTop:14,padding:14}}>
          <div className="muted">Customer financial details — editable for this delivery</div>
          <div className="grid" style={{marginTop:8}}>
            <div><label className="muted">Sale Amount<input className="input" type="number" min="0" step="0.01" value={saleAmount} onChange={e=>setSaleAmount(e.target.value)} placeholder={String(customer.sale_amount||0)}/></label></div>
            <div><label className="muted">Loan Amount<input className="input" type="number" min="0" step="0.01" value={loanAmount} onChange={e=>{setLoanAmount(e.target.value);if(!Number(e.target.value))setLoanWorkflowId('')}} placeholder={String(customer.loan_amount||0)}/></label></div>
            <div><label className="muted">File Charge<input className="input" type="number" min="0" step="0.01" value={fileCharge} onChange={e=>setFileCharge(e.target.value)} placeholder="0"/></label></div>
            <div><label className="muted">Misc Charge<input className="input" type="number" min="0" step="0.01" value={miscCharge} onChange={e=>setMiscCharge(e.target.value)} placeholder="0"/></label></div>
          </div>
          {Number(loanAmount)>0&&<div style={{marginTop:12}}>
            <label className="muted">Approved Loan</label>
            <select className="input" value={loanWorkflowId} onChange={e=>setLoanWorkflowId(e.target.value)} required>
              <option value="">Select approved loan application</option>
              {approvedLoans.map(x=><option key={x.id} value={x.id}>{x.application_no} · {x.do_no||'No DO'} · {x.customer_name||'Customer'} · {x.status}</option>)}
            </select>
          </div>}
          <div className="grid" style={{marginTop:8}}>
            <div><small className="muted">Down Payment</small><div><b>{money(customer.paid_amount)}</b></div></div>
            <div><small className="muted">Current Balance</small><div><b>{money(Number(saleAmount||customer.sale_amount||0)-Number(loanAmount||customer.loan_amount||0)-Number(customer.paid_amount||0))}</b></div></div>
          </div>
        </div>}

        <div style={{marginTop:14}}>
          <input className="input" placeholder="Remarks (optional)" value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>

        <div className="actions" style={{marginTop:14}}>
          <button className="btn primary" disabled={saving || type==='battery'}>{saving?'Saving…':'Submit Delivery'}</button>
        </div>
      </form>}
    </div>
  </div>;
}

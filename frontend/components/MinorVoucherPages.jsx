'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);

export function OldRickshawPage() {
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]);
  const [open,setOpen]=useState(false),[saleOpen,setSaleOpen]=useState(false),[saleRow,setSaleRow]=useState(null);
  const emptyForm={date:today(),source:'manual',record_no:'',vou_no:'',chfpl_ref_no:'',party_name:'',purchase_ref_no:'',
    vehicle_reg_no:'',model_name:'',owner_name:'',salesman:'',purchase_amount:'',file_charge:'',
    battery_maker:'',battery_no1:'',battery_no2:'',battery_no3:'',battery_no4:'',sp_no:'',dealer_page_no:'',
    dealer_id:'',challan_no:'',ledger_date:'',sale_type:'',do_number:'',chassis_no:'',charger:'',mat:'',jack:'',
    centre_lock:'',big_mirror:'',colour:'',toolkit:'',stepney:'',out_name:'',remarks1:'',remarks2:''};
  const emptySale={sale_date:today(),dealer_id:'',sale_amount:'',file_charge:'',loan_amount:'',down_payment:'',
    dealer_page_no:'',sp_no:'',sale_ref_no:'',sale_type:'',do_number:'',out_name:'',receipt_amount:'',
    receipt_no:'',ledger:'',resale_date:'',resale_ledger:''};
  const [form,setForm]=useState(emptyForm),[sale,setSale]=useState(emptySale);
  const {busy,error,setError,run}=useAsyncAction();

  const load=()=>get('/old-rickshaws').then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[])).catch(()=>{});},[]);

  const openNew=()=>{setForm({...emptyForm,date:today(),record_no:data?.suggested_record_no||'',vou_no:data?.suggested_vou_no||''});setOpen(true);};
  const save=e=>{e.preventDefault();run(async()=>{await post('/old-rickshaws',form);setOpen(false);load();});};
  const openSale=r=>{setSaleRow(r);setSale({...emptySale,sale_date:today(),sale_amount:r.sale_amount||r.purchase_amount||'',file_charge:r.file_charge||'',dealer_page_no:r.dealer_page_no||'',sp_no:r.sp_no||'',receipt_amount:r.receipt_amount||'',receipt_no:r.receipt_no||'',ledger:r.ledger||'',resale_date:r.resale_date||'',resale_ledger:r.resale_ledger||'',sale_type:r.sale_type||'',do_number:r.do_number||'',out_name:r.out_name||''});setSaleOpen(true);};
  const saveSale=e=>{e.preventDefault();run(async()=>{await post('/old-rickshaws/sale',{...sale,id:saleRow.id});setSaleOpen(false);setSaleRow(null);load();});};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/old-rickshaws/'+id);load();});};

  if(!data)return <div className="card">Loading…</div>;
  return <>
    <div className="actions" style={{marginBottom:14}}>
      <button className="btn primary" onClick={openNew}>+ Purchase / Available Old Rickshaw</button>
      <span className="muted" style={{alignSelf:'center'}}>Old Rickshaw register: Excel/legacy fields are available for both opening and sale entries.</span>
    </div>
    <ErrorBanner message={!open&&!saleOpen?error:''}/>
    {data.records.length===0?<EmptyState text="No Old Rickshaw currently available in GRD stock."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Record No.</th><th>Date</th><th>Ledger Date</th><th>Vou. No.</th><th>Status</th><th>Source</th><th>Dealer</th><th>Reg. No.</th><th>Owner</th><th>Model</th><th>Sales Man</th><th>Sale Type</th><th>DO No.</th><th>Chassis No.</th><th>Battery</th><th>Colour</th><th>Purchase Amt.</th><th>Sold Amt.</th><th>Loan Amt.</th><th>Received</th><th>Balance</th><th>SP No.</th><th>Out Name</th><th>Action</th>
      </tr></thead><tbody>{data.records.map(r=><tr key={r.id}>
        <td>{r.record_no}</td><td>{formatDate(r.date)}</td><td>{r.ledger_date?formatDate(r.ledger_date):'—'}</td><td>{r.vou_no||'—'}</td><td>{r.status}</td><td>{r.source==='chfpl'?'CHFPL':'Manual'}</td><td>{r.dealer_name||'—'}</td>
        <td><b>{r.vehicle_reg_no||'—'}</b></td><td>{r.owner_name||'—'}</td><td>{r.model_name||'—'}</td><td>{r.salesman||'—'}</td><td>{r.sale_type||'—'}</td><td>{r.do_number||'—'}</td><td>{r.chassis_no||'—'}</td>
        <td>{r.has_battery?'Yes':'No'}</td><td>{r.colour||'—'}</td><td><Money value={r.purchase_amount}/></td><td><Money value={r.sold_amount||r.sale_amount}/></td><td><Money value={r.loan_amount}/></td><td><Money value={r.receipt_amount}/></td><td><Money value={r.balance_amount}/></td><td>{r.sp_no||'—'}</td><td>{r.out_name||r.sold_to||'—'}</td>
        <td>{r.status==='available'&&<button className="btn primary" onClick={()=>openSale(r)}>Sale to Dealer</button>} <button className="btn danger" onClick={()=>remove(r.id)}>Delete</button></td>
      </tr>)}</tbody></table></div>}

    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>Old Rickshaw Purchase / Excel Register Entry</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Record No." value={form.record_no} onChange={v=>setForm({...form,record_no:v})}/>
        <Field label="Vou. No." value={form.vou_no} onChange={v=>setForm({...form,vou_no:v})}/>
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
        <Field label="Ledger Date" type="date" value={form.ledger_date} onChange={v=>setForm({...form,ledger_date:v})}/>
        <Field label="Purchase Source" type="select" value={form.source} options={[{value:'manual',label:'Manual Purchase'},{value:'chfpl',label:'CHFPL Available for Sale'}]} onChange={v=>setForm({...form,source:v})}/>

        <Field label="Dealer" type="select" value={form.dealer_id} options={[{value:'',label:'Select Dealer'},...dealers.map(d=>({value:d.id,label:(d.code?d.code+' — ':'')+d.name}))]} onChange={v=>setForm({...form,dealer_id:Number(v)})}/>        <Field label="CHFPL / Purchase Ref No." value={form.chfpl_ref_no||form.purchase_ref_no||''} onChange={v=>setForm({...form,chfpl_ref_no:v,purchase_ref_no:v})}/>
        <Field label="Party Name" value={form.party_name} onChange={v=>setForm({...form,party_name:v})}/>
        <Field label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={v=>setForm({...form,vehicle_reg_no:v})} required/>
        <Field label="Chassis No." value={form.chassis_no} onChange={v=>setForm({...form,chassis_no:v})}/>
        <Field label="Model Name" value={form.model_name} onChange={v=>setForm({...form,model_name:v})}/>
        <Field label="Previous Owner" value={form.owner_name} onChange={v=>setForm({...form,owner_name:v})}/>
        <Field label="Sales Man" value={form.salesman} onChange={v=>setForm({...form,salesman:v})}/>
        <Field label="Challan No." value={form.challan_no} onChange={v=>setForm({...form,challan_no:v})}/>
        <Field label="Sale Type" type="select" value={form.sale_type} options={[{value:'cash',label:'Cash'},{value:'finance',label:'Finance'}]} onChange={v=>setForm({...form,sale_type:v})}/>
        <Field label="DO Number" value={form.do_number} onChange={v=>setForm({...form,do_number:v})}/>
        <Field label="Purchase Amount" type="number" value={form.purchase_amount} onChange={v=>setForm({...form,purchase_amount:v})}/>
        <Field label="File Charge" type="number" value={form.file_charge} onChange={v=>setForm({...form,file_charge:v})}/>
        <Field label="Battery Maker / Name" value={form.battery_maker} onChange={v=>setForm({...form,battery_maker:v})}/>
        <Field label="Battery No. 1" value={form.battery_no1} onChange={v=>setForm({...form,battery_no1:v})}/>
        <Field label="Battery No. 2" value={form.battery_no2} onChange={v=>setForm({...form,battery_no2:v})}/>
        <Field label="Battery No. 3" value={form.battery_no3} onChange={v=>setForm({...form,battery_no3:v})}/>
        <Field label="Battery No. 4" value={form.battery_no4} onChange={v=>setForm({...form,battery_no4:v})}/>
        <Field label="Charger" value={form.charger} onChange={v=>setForm({...form,charger:v})}/>
        <Field label="Mat" value={form.mat} onChange={v=>setForm({...form,mat:v})}/>
        <Field label="Jack" value={form.jack} onChange={v=>setForm({...form,jack:v})}/>
        <Field label="Centre Lock" value={form.centre_lock} onChange={v=>setForm({...form,centre_lock:v})}/>
        <Field label="Big Mirror" value={form.big_mirror} onChange={v=>setForm({...form,big_mirror:v})}/>
        <Field label="Colour" value={form.colour} onChange={v=>setForm({...form,colour:v})}/>
        <Field label="Toolkit" value={form.toolkit} onChange={v=>setForm({...form,toolkit:v})}/>
        <Field label="Stepney" value={form.stepney} onChange={v=>setForm({...form,stepney:v})}/>
        <Field label="SP No. (Old Register)" value={form.sp_no} onChange={v=>setForm({...form,sp_no:v})}/>
        <Field label="Dealer Page No." value={form.dealer_page_no} onChange={v=>setForm({...form,dealer_page_no:v})}/>
        <Field label="Out Name" value={form.out_name} onChange={v=>setForm({...form,out_name:v})}/>
        <Field label="Remarks 1" value={form.remarks1} onChange={v=>setForm({...form,remarks1:v})}/>
        <Field label="Remarks 2" value={form.remarks2} onChange={v=>setForm({...form,remarks2:v})}/>
      </div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save'}</button></div>
    </form></div>}

    {saleOpen&&<div className="modal"><form className="modalbox" onSubmit={saveSale}>
      <h2>Old Rickshaw Sale — No Tax Invoice</h2><ErrorBanner message={error}/>
      <p className="muted">This sale updates dealer stock. No Tax Invoice is generated.</p>
      <div className="formgrid">
        <Field label="Sale Date" type="date" value={sale.sale_date} onChange={v=>setSale({...sale,sale_date:v})}/>
        <Field label="Dealer" type="select" value={sale.dealer_id} options={dealers.map(d=>({value:d.id,label:(d.code?d.code+' — ':'')+d.name}))} onChange={v=>setSale({...sale,dealer_id:Number(v)})} required/>
        <Field label="Sale Amount" type="number" value={sale.sale_amount} onChange={v=>setSale({...sale,sale_amount:v})}/>
        <Field label="Sale Type" type="select" value={sale.sale_type} options={[{value:'cash',label:'Cash'},{value:'finance',label:'Finance'}]} onChange={v=>setSale({...sale,sale_type:v})}/>
        <Field label="Loan Amount" type="number" value={sale.loan_amount} onChange={v=>setSale({...sale,loan_amount:v})}/>
        <Field label="Down Payment" type="number" value={sale.down_payment} onChange={v=>setSale({...sale,down_payment:v})}/>
        <Field label="File Charge" type="number" value={sale.file_charge} onChange={v=>setSale({...sale,file_charge:v})}/>
        <Field label="Dealer Page No." value={sale.dealer_page_no} onChange={v=>setSale({...sale,dealer_page_no:v})}/>
        <Field label="SP No. (Old Register)" value={sale.sp_no} onChange={v=>setSale({...sale,sp_no:v})}/>
        <Field label="Sale Ref No." value={sale.sale_ref_no} onChange={v=>setSale({...sale,sale_ref_no:v})}/>
        <Field label="DO Number" value={sale.do_number} onChange={v=>setSale({...sale,do_number:v})}/>
        <Field label="Out Name" value={sale.out_name} onChange={v=>setSale({...sale,out_name:v})}/>
        <Field label="Receipt Amount" type="number" value={sale.receipt_amount} onChange={v=>setSale({...sale,receipt_amount:v})}/>
        <Field label="Receipt No." value={sale.receipt_no} onChange={v=>setSale({...sale,receipt_no:v})}/>
        <Field label="Ledger" value={sale.ledger} onChange={v=>setSale({...sale,ledger:v})}/>
        <Field label="Resale Date" type="date" value={sale.resale_date} onChange={v=>setSale({...sale,resale_date:v})}/>
        <Field label="Resale Ledger" value={sale.resale_ledger} onChange={v=>setSale({...sale,resale_ledger:v})}/>
      </div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setSaleOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save Sale'}</button></div>
    </form></div>}
  </>;
}

export function BatterySwapVoucherPage() {
  const [dealers,setDealers]=useState([]),[rows,setRows]=useState([]),[rickshaws,setRickshaws]=useState({new:[],old:[]});
  const [detailRow,setDetailRow]=useState(null);
  const [form,setForm]=useState({date:today(),dealer_id:'',dealer_name:'',from_type:'new',from_id:'',to_type:'new',to_id:'',remarks:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=async()=>{try{const [d,v]=await Promise.all([get('/dealers'),get('/battery-swap-vouchers')]);setDealers(d.dealers||[]);setRows(v.records||[]);}catch(e){setError(e.message)}};
  const loadStock=async dealerId=>{if(!dealerId){setRickshaws({new:[],old:[]});return;}try{const [n,o]=await Promise.all([get('/dealer/rickshaw-battery-options?dealer_id='+dealerId+'&type=new'),get('/dealer/rickshaw-battery-options?dealer_id='+dealerId+'&type=old')]);setRickshaws({new:n.rickshaws||[],old:o.rickshaws||[]});}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[]);
  useEffect(()=>{loadStock(form.dealer_id)},[form.dealer_id]);
  const dealerOptions=dealers.map(d=>({value:d.name,label:(d.code?d.code+' — ':'')+d.name}));
  const findDealer=v=>dealers.find(d=>String(d.name||'').trim().toLowerCase()===String(v||'').trim().toLowerCase());
  const setDealer=v=>{const d=findDealer(v);setForm({...form,dealer_name:v,dealer_id:d?Number(d.id):'',from_id:'',to_id:''});};
  const opts=type=>(rickshaws[type]||[]).map(r=>{
    const nums=r.battery_numbers||[];
    const battery=r.has_battery ? `Battery: ${r.battery_maker||'—'} | ${nums.join(', ')}` : 'NO BATTERY';
    return {value:r.id,label:`${r.reg_no||r.chassis_no} — ${r.model_name||''} — ${battery}`};
  });
  const save=async e=>{e.preventDefault();if(!form.dealer_id){setError('Please select a dealer from the dealer suggestions.');return;}setBusy(true);setError('');try{await post('/battery-swap-vouchers',form);setForm({...form,from_id:'',to_id:'',remarks:''});await load();await loadStock(form.dealer_id);}catch(e){setError(e.message)}finally{setBusy(false)}};
  const remove=async id=>{if(!window.confirm('Delete this Battery Swap voucher? The battery positions will be restored.'))return;setBusy(true);setError('');try{await del('/battery-swap-vouchers?id='+id);await load();await loadStock(form.dealer_id);}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="page"><div className="card"><h2>Battery Swap / Exchange Voucher</h2><p className="muted">Dealer type karein; suggestion se select kar sakte hain. Rickshaw select karte waqt current battery maker aur numbers bhi dikhenge.</p><ErrorBanner message={error}/>
    <form onSubmit={save}><div className="formgrid">
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Dealer" type="combo" value={form.dealer_name} options={dealerOptions} onChange={v=>{setError('');setDealer(v)}} required/>
      <Field label="From Rickshaw Type" type="select" value={form.from_type} options={[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>{setError('');setForm({...form,from_type:v,from_id:''})}}/>
      <Field label="From Rickshaw" type="select" value={form.from_id} options={opts(form.from_type)} onChange={v=>{setError('');setForm({...form,from_id:Number(v)})}} required/>
      <Field label="To Rickshaw Type" type="select" value={form.to_type} options={[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>{setError('');setForm({...form,to_type:v,to_id:''})}}/>
      <Field label="To Rickshaw" type="select" value={form.to_id} options={opts(form.to_type)} onChange={v=>{setError('');setForm({...form,to_id:Number(v)})}} required/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
    </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save Battery Swap / Exchange'}</button></div></form>
  </div><div className="card"><h2>Swap / Exchange History</h2><div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Voucher</th><th>Dealer</th><th>Mode</th><th>From Rickshaw</th><th>To Rickshaw</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.voucher_no}</td><td>{dealers.find(d=>d.id===r.dealer_id)?.name||r.dealer_id}</td><td>{r.mode}</td><td><b>{r.from_model_name||'—'}</b><br/><span className="muted">{r.from_chassis_no||r.from_reg_no||('ID '+r.from_id)}</span></td>
<td><b>{r.to_model_name||'—'}</b><br/><span className="muted">{r.to_chassis_no||r.to_reg_no||('ID '+r.to_id)}</span></td>
<td style={{display:'flex',gap:6}}>
  <button className="btn" onClick={()=>setDetailRow(r)}>View</button>
  <button className="btn danger" onClick={()=>remove(r.id)} disabled={busy}>Delete</button>
</td></tr>)}</tbody></table></div>
    {detailRow ? <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setDetailRow(null)}}>
      <div className="modalbox" style={{maxWidth:760}}>
        <h2>Battery Swap / Exchange — {detailRow.voucher_no}</h2>
        <div className="formgrid">
          <Field label="Date" value={formatDate(detailRow.date)} readOnly />
          <Field label="Dealer" value={dealers.find(d=>d.id===detailRow.dealer_id)?.name||detailRow.dealer_id} readOnly />
          <Field label="Mode" value={detailRow.mode} readOnly />
          <Field label="From Type" value={detailRow.from_type} readOnly />
          <Field label="From Model" value={detailRow.from_model_name||'—'} readOnly />
          <Field label="From Chassis / Reg. No." value={detailRow.from_chassis_no||detailRow.from_reg_no||'—'} readOnly />
          <Field label="From Battery Maker" value={detailRow.from_battery_maker||'—'} readOnly />
          <Field label="From Battery Nos." value={(detailRow.from_battery_numbers||[]).filter(Boolean).join(', ')||'—'} readOnly />
          <Field label="To Type" value={detailRow.to_type} readOnly />
          <Field label="To Model" value={detailRow.to_model_name||'—'} readOnly />
          <Field label="To Chassis / Reg. No." value={detailRow.to_chassis_no||detailRow.to_reg_no||'—'} readOnly />
          <Field label="To Battery Maker" value={detailRow.to_battery_maker||'—'} readOnly />
          <Field label="To Battery Nos." value={(detailRow.to_battery_numbers||[]).filter(Boolean).join(', ')||'—'} readOnly />
          <Field label="Remarks" value={detailRow.remarks||'—'} readOnly />
        </div>
        <div className="actions" style={{marginTop:18,justifyContent:'flex-end'}}>
          <button className="btn" onClick={()=>setDetailRow(null)}>Close</button>
        </div>
      </div>
    </div> : null}
  </div></div>;
}

export function BatteryWithdrawalPage() {
  const [dealers,setDealers]=useState([]),[rickshaws,setRickshaws]=useState([]),[rows,setRows]=useState([]);
  const [form,setForm]=useState({date:today(),dealer_id:'',dealer_name:'',rickshaw_type:'new',rickshaw_id:'',battery_no:'',reference_no:'',remarks:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=async()=>{try{const [d,v]=await Promise.all([get('/dealers'),get('/battery-withdrawal')]);setDealers(d.dealers||[]);setRows(v.records||[]);}catch(e){setError(e.message)}};
  const loadR=async()=>{if(!form.dealer_id){setRickshaws([]);return;}const x=await get('/dealer/rickshaw-battery-options?dealer_id='+form.dealer_id+'&type='+form.rickshaw_type);setRickshaws(x.rickshaws||[]);};
  useEffect(()=>{load()},[]);
  useEffect(()=>{loadR()},[form.dealer_id,form.rickshaw_type]);
  const current=rickshaws.find(x=>String(x.id)===String(form.rickshaw_id));
  const save=async e=>{e.preventDefault();setBusy(true);setError('');try{await post('/battery-withdrawal',form);setForm({...form,rickshaw_id:'',battery_no:'',reference_no:'',remarks:''});await load();await loadR();}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="page"><div className="card"><h2>Battery Withdrawal</h2><p className="muted">Rickshaw se battery nikaal kar dealer ke battery stock me aa jayegi.</p><ErrorBanner message={error}/>
    <form onSubmit={save}><div className="formgrid">
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Dealer" type="combo" value={form.dealer_name} options={dealers.map(d=>({value:d.name,label:(d.code?d.code+' — ':'')+d.name}))} onChange={v=>{const d=dealers.find(x=>String(x.name).trim().toLowerCase()===String(v).trim().toLowerCase());setForm({...form,dealer_name:v,dealer_id:d?Number(d.id):'',rickshaw_id:'',battery_no:''})}} required/>
      <Field label="Rickshaw Type" type="select" value={form.rickshaw_type} options={[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>setForm({...form,rickshaw_type:v,rickshaw_id:'',battery_no:''})}/>
      <Field label="Rickshaw" type="select" value={form.rickshaw_id} options={rickshaws.map(r=>({value:r.id,label:(r.reg_no||r.chassis_no)+' — '+(r.model_name||'')}))} onChange={v=>setForm({...form,rickshaw_id:Number(v),battery_no:''})} required/>
      <Field label="Battery No." type="select" value={form.battery_no} options={(current?.battery_numbers||[]).map(n=>({value:n,label:n}))} onChange={v=>setForm({...form,battery_no:v})} required/>
      <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
    </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Withdraw Battery'}</button></div></form></div>
    <div className="card"><h2>Dealer Battery Withdrawal History</h2><div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Reference</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.dealer_name}</td><td>{r.battery_maker}</td><td>{r.battery_no}</td><td>{r.reference_no||'—'}</td><td><button className="btn danger" onClick={()=>window.confirm('Delete this withdrawal?')&&del('/battery-withdrawal?id='+r.id).then(load).catch(e=>setError(e.message))}>Delete</button></td></tr>)}</tbody></table></div></div>
  </div>;
}


export function BatteryAdditionPage() {
  const [dealers,setDealers]=useState([]),[rickshaws,setRickshaws]=useState([]),[batteries,setBatteries]=useState([]);
  const [form,setForm]=useState({date:today(),dealer_id:'',rickshaw_type:'new',rickshaw_id:'',battery_no:'',reference_no:'',remarks:''});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{try{const d=await get('/dealers');setDealers(d.dealers||[]);if(form.dealer_id){const [r,b]=await Promise.all([get('/dealer/rickshaw-battery-options?dealer_id='+form.dealer_id+'&type='+form.rickshaw_type),get('/battery-addition?dealer_id='+form.dealer_id)]);setRickshaws((r.rickshaws||[]).filter(x=>!(x.battery_numbers||[]).length));setBatteries(b.batteries||[])}}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[form.dealer_id,form.rickshaw_type]);
  const save=async e=>{e.preventDefault();setBusy(true);setError('');try{await post('/battery-addition',form);setForm({...form,rickshaw_id:'',battery_no:'',reference_no:'',remarks:''});await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="page"><div className="card"><h2>Battery Addition to Rickshaw</h2><p className="muted">Sirf wahi New/Old Rickshaw select honge jisme abhi battery fitted nahi hai.</p><ErrorBanner message={error}/><form onSubmit={save}><div className="formgrid">
    <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
    <Field label="Dealer" type="select" value={form.dealer_id} options={dealers.map(d=>({value:d.id,label:d.name}))} onChange={v=>setForm({...form,dealer_id:Number(v),rickshaw_id:'',battery_no:''})} required/>
    <Field label="Rickshaw Type" type="select" value={form.rickshaw_type} options={[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>setForm({...form,rickshaw_type:v,rickshaw_id:'',battery_no:''})}/>
    <Field label="Rickshaw" type="select" value={form.rickshaw_id} options={rickshaws.map(x=>({value:x.id,label:(x.reg_no||x.chassis_no)+' — '+(x.model_name||'')}))} onChange={v=>setForm({...form,rickshaw_id:Number(v),battery_no:''})} required/>
    <Field label="Battery No." type="select" value={form.battery_no} options={batteries.map(x=>({value:x.battery_no,label:(x.battery_maker||'')+' — '+x.battery_no}))} onChange={v=>setForm({...form,battery_no:v})} required/>
    <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
    <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
  </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Add Battery to Rickshaw'}</button></div></form></div></div>;
}

export function BatteryDeliveryChallanPage() {
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]),[makers,setMakers]=useState([]),[open,setOpen]=useState(false);
  const [form,setForm]=useState({date:today(),qty:1,battery_numbers:['']});
  const {busy,error,setError,run}=useAsyncAction();
  const load=()=>get('/battery-delivery-challans').then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[]));get('/masters/battery-maker').then(d=>setMakers(Array.isArray(d)?d:(d.masters||[]))).catch(()=>setMakers([]));},[]);
  const openNew=()=>{setForm({date:today(),qty:1,challan_no:data?.suggested_challan_no||'',dealer_id:'',battery_maker:'',battery_numbers:[''],remarks:''});setOpen(true)};
  const setQty=(v)=>{const qty=Math.max(1,Number(v)||1);setForm(f=>({...f,qty,battery_numbers:Array.from({length:qty},(_,i)=>f.battery_numbers?.[i]||'')}))};
  const setNo=(i,v)=>setForm(f=>({...f,battery_numbers:f.battery_numbers.map((x,n)=>n===i?v:x)}));
  const save=e=>{e.preventDefault();run(async()=>{await post('/battery-delivery-challans',form);setOpen(false);load()})};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/battery-delivery-challans/'+id);load()})};
  if(!data)return <div className="card">Loading…</div>;
  return <>
    <div className="actions" style={{marginBottom:14}}><button className="btn primary" onClick={openNew}>+ New Battery Delivery Challan</button></div>
    <ErrorBanner message={!open?error:''}/>
    {!data.records.length?<EmptyState/>:<div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Qty</th><th></th></tr></thead><tbody>{data.records.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.challan_no}</td><td>{r.dealer_name}</td><td>{r.battery_maker}</td><td>{r.battery_no}</td><td>{r.qty}</td><td><button className="btn danger" onClick={()=>remove(r.id)}>Delete</button></td></tr>)}</tbody></table></div>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save} style={{maxWidth:760}}><h2>New Battery Delivery Challan</h2><ErrorBanner message={error}/><div className="formgrid">
      <Field label="Challan No." value={form.challan_no} onChange={v=>setForm({...form,challan_no:v})}/><Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Dealer" type="select" value={form.dealer_id} options={dealers.map(d=>({value:d.id,label:d.name}))} onChange={v=>setForm({...form,dealer_id:Number(v)})} required/>
      <Field label="Battery Maker" type="select" value={form.battery_maker} options={makers.map(m=>({value:m.name,label:m.name}))} onChange={v=>setForm({...form,battery_maker:v})} required/>
      <Field label="Qty" type="number" value={form.qty} onChange={setQty} required/>
    </div>
    <div style={{marginTop:12}}><b>Battery No. ({form.qty})</b><div className="formgrid" style={{marginTop:8}}>{form.battery_numbers.map((n,i)=><Field key={i} label={`Battery No. ${i+1}`} value={n} onChange={v=>setNo(i,v)} required/>)}</div></div>
    <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
    <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save'}</button></div></form></div>}
  </>;
}

export function JournalStockPage() {
  const [data,setData]=useState(null),[open,setOpen]=useState(false),[workOpen,setWorkOpen]=useState(false);
  const [search,setSearch]=useState(''),[type,setType]=useState(''),[page,setPage]=useState(1);
  const [form,setForm]=useState({date:today(),item_type:'R'}),[work,setWork]=useState({date:today(),work_type:'assembly',model_name:'',output_item:'Complete Wheel',output_qty:1,inputs:[{item_name:'Tyre',qty_per_unit:1},{item_name:'Tube',qty_per_unit:1},{item_name:'Rim',qty_per_unit:1}],reason:''});
  const {busy,error,setError,run}=useAsyncAction();
  const load=()=>get('/journal-stock?'+new URLSearchParams({page,per_page:50,...(search?{search}:{}),...(type?{item_type:type}:{})})).then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load();},[page,search,type]);
  const openNew=()=>{setForm({date:today(),item_type:'R',vou_no:data?.suggested_vou_no||''});setOpen(true);};
  const save=e=>{e.preventDefault();run(async()=>{await post('/journal-stock',form);setOpen(false);load();});};
  const saveWork=e=>{e.preventDefault();run(async()=>{await post('/journal-stock/work',work);setWorkOpen(false);load();});};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/journal-stock/'+id);load();});};
  const setWorkType=v=>setWork(x=>({...x,work_type:v,output_item:v==='assembly'?'Complete Wheel':'Fabricated Chassis',inputs:v==='assembly'?[{item_name:'Tyre',qty_per_unit:1},{item_name:'Tube',qty_per_unit:1},{item_name:'Rim',qty_per_unit:1}]:[{item_name:'Iron Sheet',qty_per_unit:1},{item_name:'Pipe',qty_per_unit:1},{item_name:'Welding Material',qty_per_unit:1}]}));
  const addInput=()=>setWork(x=>({...x,inputs:[...x.inputs,{item_name:'',qty_per_unit:1}]}));
  const updateInput=(i,k,v)=>setWork(x=>({...x,inputs:x.inputs.map((a,n)=>n===i?{...a,[k]:v}:a)}));
  if(!data)return <div className="card">Loading…</div>;
  return <>
    <div className="actions" style={{marginBottom:14,flexWrap:'wrap'}}>
      <button className="btn primary" onClick={openNew}>+ Stock Correction</button><button className="btn" onClick={()=>setWorkOpen(true)}>+ Fabrication / Assembly</button>
      <input className="input" placeholder="Search item, model, voucher…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} style={{maxWidth:260}}/>
      <select className="input" value={type} onChange={e=>{setType(e.target.value);setPage(1)}} style={{maxWidth:160}}><option value="">All Types</option><option value="R">Raw Material</option><option value="F">Finished</option></select>
    </div>
    <ErrorBanner message={!open&&!workOpen?error:''}/>
    {!data.records.length?<EmptyState/>:<>
      <div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Vou. No.</th><th>Item</th><th>Model</th><th>Type</th><th>Qty</th><th>Work</th><th>Reason</th><th></th></tr></thead>
      <tbody>{data.records.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.item_name}</td><td>{r.model_name||'—'}</td><td>{r.item_type==='R'?'Raw Material':'Finished'}</td><td>{r.qty}</td><td>{r.work_type||'Adjustment'}</td><td>{r.reason||'—'}</td><td><button className="btn danger" onClick={()=>remove(r.id)}>Delete</button></td></tr>)}</tbody></table></div>
      <div className="actions" style={{justifyContent:'space-between',marginTop:10}}><span className="muted">Page {data.page}{data.has_next?' · More records available':''}</span><div><button className="btn" disabled={data.page<=1} onClick={()=>setPage(p=>p-1)}>← Prev</button> <button className="btn" disabled={!data.has_next} onClick={()=>setPage(p=>p+1)}>Next →</button></div></div>
    </>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}><h2>New Stock Correction</h2><ErrorBanner message={error}/><div className="formgrid">
      <Field label="Vou. No." value={form.vou_no} onChange={v=>setForm({...form,vou_no:v})}/><Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/><Field label="Item Name" value={form.item_name} onChange={v=>setForm({...form,item_name:v})} required/><Field label="Model (optional)" value={form.model_name} onChange={v=>setForm({...form,model_name:v})}/><Field label="Item Type" type="select" value={form.item_type} options={[{value:'R',label:'Raw Material'},{value:'F',label:'Finished'}]} onChange={v=>setForm({...form,item_type:v})}/><Field label="Qty (+/-)" type="number" value={form.qty} onChange={v=>setForm({...form,qty:v})} required/><Field label="Reason" value={form.reason} onChange={v=>setForm({...form,reason:v})}/></div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div></form></div>}
    {workOpen&&<div className="modal"><form className="modalbox" onSubmit={saveWork}><h2>Fabrication / Assembly Stock</h2><ErrorBanner message={error}/><p className="muted">Example: 1 Complete Wheel = 1 Tyre + 1 Tube + 1 Rim. For fabrication, enter sheet/pipe/welding consumption and the finished chassis quantity.</p>
      <div className="formgrid"><Field label="Work Type" type="select" value={work.work_type} options={[{value:'fabrication',label:'Fabrication — Chassis / Frame'},{value:'assembly',label:'Assembly — Wheel / Part'}]} onChange={setWorkType}/><Field label="Date" type="date" value={work.date} onChange={v=>setWork({...work,date:v})}/><Field label="Model (optional)" value={work.model_name} onChange={v=>setWork({...work,model_name:v})}/><Field label="Output Item" value={work.output_item} onChange={v=>setWork({...work,output_item:v})} required/><Field label="Output Qty" type="number" value={work.output_qty} onChange={v=>setWork({...work,output_qty:v})} required/><Field label="Voucher No. (optional)" value={work.vou_no||''} onChange={v=>setWork({...work,vou_no:v})}/><Field label="Reason / Remark" value={work.reason} onChange={v=>setWork({...work,reason:v})}/></div>
      <div className="card" style={{marginTop:14}}><div className="actions" style={{justifyContent:'space-between'}}><b>Input Materials per Output Unit</b><button type="button" className="btn" onClick={addInput}>+ Add Material</button></div>
      {work.inputs.map((x,i)=><div key={i} className="formgrid" style={{marginTop:8}}><Field label="Material" value={x.item_name} onChange={v=>updateInput(i,'item_name',v)}/><Field label="Qty / Unit" type="number" value={x.qty_per_unit} onChange={v=>updateInput(i,'qty_per_unit',v)}/></div>)}</div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setWorkOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save Work Entry</button></div></form></div>}
  </>;
}

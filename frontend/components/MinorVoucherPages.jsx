'use client';
import React, { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { CreatePendingSale } from './BillingPendingSalesPage';
import { Overlay } from './PrintDocs';

const today = () => new Date().toISOString().slice(0, 10);

// Old Rickshaw ka read-only Detail + Print (Overlay ka Print / Download PDF button browser print dialog kholta hai).
function OldRickshawDetailView({ row: r, info: i, onClose }) {
  const sale = r._sale || {};
  const v = x => (x === undefined || x === null || String(x).trim() === '' ? '—' : String(x));
  const inr = n => '\u20b9' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const batt = [r.battery_no1, r.battery_no2, r.battery_no3, r.battery_no4].map(x => String(x ?? '').trim()).filter(x => x && x !== '0').join(', ');
  const Sec = ({ title, rows }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ background: '#e5e7eb', color: '#111', fontWeight: 700, padding: '4px 8px', fontSize: 12, border: '1px solid #000' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#000' }}><tbody>
        {rows.map((pair, k) => <tr key={k}>{pair.map(([l, val], j) => <React.Fragment key={j}>
          <td style={{ border: '1px solid #000', padding: '4px 8px', width: '17%', fontWeight: 600, background: '#f8fafc' }}>{l}</td>
          <td style={{ border: '1px solid #000', padding: '4px 8px', width: '33%' }}>{val}</td></React.Fragment>)}</tr>)}
      </tbody></table>
    </div>);
  return (
    <Overlay onClose={onClose} title="Old Rickshaw Detail">
      <div style={{ color: '#000', background: '#fff', padding: 16, fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>G.R.D. MOTORS</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>OLD RICKSHAW — DETAIL</div>
        </div>
        <Sec title="VEHICLE" rows={[
          [['SP No.', v(r.sp_no)], ['Factory S. No.', v(r.vou_no)]],
          [['Vehicle No.', v(r.vehicle_reg_no)], ['Chassis No.', v(r.chassis_no)]],
          [['Model', v(r.model_name)], ['Status', v(r.status)]],
          [['Date', v(formatDate(r.date))], ['Dealer', v(r.dealer_name)]],
          [['Battery Make', v(r.battery_maker)], ['Battery No.', v(batt)]],
        ]} />
        <Sec title="SALE" rows={[
          [['Customer', v(i.customer)], ['Sale Date', v((r.sale_date || r.resale_date) ? formatDate(r.sale_date || r.resale_date) : '')]],
          [['Sale Value', inr(i.sale)], ['Loan', inr(i.loan)]],
          [['Received', inr(i.received)], ['Balance', inr(i.balance)]],
          [['Ledger No.', v(i.ledger)], ['Ledger Date', v(r.ledger_date ? formatDate(r.ledger_date) : '')]],
          [['DO No.', v(r.do_number)], ['Sale Status', v(sale.status)]],
        ]} />
        <Sec title="ACCESSORIES" rows={[
          [['Charger', v(r.charger)], ['Mat', v(r.mat)]],
          [['Jack', v(r.jack)], ['Centre Lock', v(r.centre_lock)]],
          [['Big Mirror', v(r.big_mirror)], ['Toolkit', v(r.toolkit)]],
          [['Stepney', v(r.stepney)], ['Colour', v(r.colour)]],
        ]} />
        {(r.remarks1 || r.remarks2) && <div style={{ fontSize: 12, marginBottom: 14 }}><b>Remarks:</b> {[r.remarks1, r.remarks2].filter(Boolean).join(' | ')}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 50, fontSize: 12 }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: 3, width: 160, textAlign: 'center' }}>Customer Signature</div>
          <div style={{ borderTop: '1px solid #000', paddingTop: 3, width: 160, textAlign: 'center' }}>For G.R.D. Motors</div>
        </div>
      </div>
    </Overlay>
  );
}

export function OldRickshawPage() {
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]);
  const [open,setOpen]=useState(false),[full,setFull]=useState(false),[pendingOpen,setPendingOpen]=useState(false),[filter,setFilter]=useState(''),[saleSheet,setSaleSheet]=useState(null),[canApprove,setCanApprove]=useState(false),[sales,setSales]=useState({}),[detailRow,setDetailRow]=useState(null);
  const emptyForm={date:today(),source:'manual',record_no:'',vou_no:'',chfpl_ref_no:'',party_name:'',purchase_ref_no:'',
    vehicle_reg_no:'',model_name:'',owner_name:'',salesman:'',purchase_amount:'',file_charge:'',
    battery_maker:'',battery_no1:'',battery_no2:'',battery_no3:'',battery_no4:'',sp_no:'',dealer_page_no:'',
    dealer_id:'',challan_no:'',ledger_date:'',sale_type:'',do_number:'',chassis_no:'',charger:'',mat:'',jack:'',
    centre_lock:'',big_mirror:'',colour:'',toolkit:'',stepney:'',out_name:'',remarks1:'',remarks2:''};
  const [form,setForm]=useState(emptyForm);
  const {busy,error,setError,run}=useAsyncAction();

  const load=()=>{
    get('/old-rickshaws').then(setData).catch(e=>setError(e.message));
    // Pending / Approved sales se customer, sale value, loan, ledger (billing access na ho to register ka apna data dikhega).
    get('/billing/pending-sales').then(l=>{const m={};(l.applications||[]).forEach(x=>{if(x.old_rickshaw_id)m[String(x.old_rickshaw_id)]=x});setSales(m)}).catch(()=>setSales({}));
  };
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[])).catch(()=>{});},[]);

  const openNew=()=>{setForm({...emptyForm,date:today(),record_no:data?.suggested_record_no||'',vou_no:data?.suggested_vou_no||''});setOpen(true);};
  const save=e=>{e.preventDefault();run(async()=>{await post('/old-rickshaws',form);setOpen(false);load();});};

  // Vehicle par click: active sale (pending/approved) ho to Edit form, sold ho (sale complete/billed) to Detail + Print,
  // warna naya Sale form (vehicle pehle se chuni hui).
  const openVehicle=r=>{run(async()=>{
    let sale=null,can=false;
    try{const l=await get('/billing/pending-sales');can=Boolean(l.can_approve);sale=(l.applications||[]).find(x=>String(x.old_rickshaw_id)===String(r.id))||null;}catch(e){if(String(r.status).toLowerCase()!=='sold')throw e;}
    if(sale){setCanApprove(can);setSaleSheet({mode:'edit',sale});return;}
    if(String(r.status).toLowerCase()==='sold'){setDetailRow({...r,_sale:null});return;}
    setSaleSheet({mode:'create',row:r});
  }).catch(()=>{});};

  const num=v=>Number(v)||0;
  const info=r=>{const x=sales[String(r.id)];
    if(x){const sv=num(x.sale_amount),ln=num(x.hypothecation_amount),rc=num(x.amount_received);
      return {customer:x.customer_name||'',sale:sv,loan:ln,received:rc,ledger:x.ledger_no||r.ledger_no||r.ledger||'',balance:Math.max(0,sv-ln-rc)}}
    return {customer:r.customer_name||r.out_name||r.sold_to||'',sale:num(r.sale_amount||r.sold_amount),loan:num(r.loan_amount),received:num(r.receipt_amount),ledger:r.ledger_no||r.ledger||'',balance:num(r.balance_amount)};};
  const isSold=r=>String(r.status||'').toLowerCase()==='sold';
  const hasBal=r=>info(r).balance>0;
  const counts={sold:data?data.records.filter(isSold).length:0,unsold:data?data.records.filter(r=>!isSold(r)).length:0,balance:data?data.records.filter(hasBal).length:0};
  const shownRows=!data?[]:data.records.filter(r=>filter==='sold'?isSold(r):filter==='unsold'?!isSold(r):filter==='balance'?hasBal(r):true);

  if(!data)return <div className="card">Loading…</div>;
  return <>
    <div className="actions" style={{marginBottom:14}}>
      <button className="btn primary" onClick={()=>setPendingOpen(true)}>+ Create Pending Sale</button>
      {[['sold','Sold'],['unsold','Unsold'],['balance','Balance']].map(([k,l])=><button key={k} className={'btn '+(filter===k?'primary':'')} onClick={()=>setFilter(filter===k?'':k)}>{l} ({counts[k]})</button>)}
      <button className="btn" onClick={()=>setFull(v=>!v)}>{full?'Hide Full Detail':'Show Full Detail'}</button>
    </div>
    <ErrorBanner message={!pendingOpen&&!saleSheet?error:''}/>
    {shownRows.length===0?<EmptyState text={filter?'Is filter me koi Old Rickshaw nahi hai.':'No Old Rickshaw currently available in GRD stock.'}/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>SP No.</th><th>Factory S. No.</th><th>Date</th><th>Dealer</th><th>Vehicle No.</th><th>Battery Make</th><th>Customer Name</th><th>Sale Value</th><th>Loan</th><th>Ledger No.</th><th>Balance</th><th className="noprint">Detail</th>
        {full&&<><th>Chassis No.</th><th>Status</th><th>Source</th><th>Ledger Date</th><th>Vou. No.</th><th>Model</th><th>DO No.</th><th>Battery</th><th>Charger</th><th>Mat</th><th>Jack</th><th>Centre Lock</th><th>Big Mirror</th><th>Toolkit</th><th>Stepney</th><th>Sale Date</th><th>Received</th></>}
      </tr></thead><tbody>{shownRows.map(r=><tr key={r.id}>
        <td><b>{r.sp_no||'—'}</b></td><td>{r.vou_no||'—'}</td><td>{formatDate(r.date)}</td><td>{r.dealer_name||'—'}</td><td><b style={{cursor:'pointer',textDecoration:'underline'}} title={isSold(r)?'Sale edit karo':'Sale form kholo'} onClick={()=>openVehicle(r)}>{r.vehicle_reg_no||'—'}</b></td><td>{r.battery_maker||'—'}</td>{(()=>{const i=info(r);return <><td>{i.customer||'—'}</td><td><b><Money value={i.sale}/></b></td><td><Money value={i.loan}/></td><td>{i.ledger||'—'}</td><td><b><Money value={i.balance}/></b></td><td><button className="btn" onClick={()=>setDetailRow({...r,_sale:sales[String(r.id)]||null})}>🖨 View</button></td></>})()}
        {full&&<><td>{r.chassis_no||'—'}</td><td>{r.status}</td><td>{r.source==='chfpl'?'CHFPL':'Manual'}</td><td>{r.ledger_date?formatDate(r.ledger_date):'—'}</td><td>{r.vou_no||'—'}</td><td>{r.model_name||'—'}</td><td>{r.do_number||'—'}</td><td>{r.has_battery?'Yes':'No'}</td>
          <td>{r.charger||'—'}</td><td>{r.mat||'—'}</td><td>{r.jack||'—'}</td><td>{r.centre_lock||'—'}</td><td>{r.big_mirror||'—'}</td><td>{r.toolkit||'—'}</td><td>{r.stepney||'—'}</td>
          <td>{(r.sale_date||r.resale_date)?formatDate(r.sale_date||r.resale_date):'—'}</td><td><Money value={info(r).received}/></td></>}
      </tr>)}</tbody></table></div>}

    {detailRow&&<OldRickshawDetailView row={detailRow} info={info(detailRow)} onClose={()=>setDetailRow(null)}/>}
    {pendingOpen&&<CreatePendingSale initialKind="OLD" onClose={()=>setPendingOpen(false)} onSaved={()=>{setPendingOpen(false);load()}}/>}
    {saleSheet?.mode==='create'&&<CreatePendingSale initialKind="OLD" prefill={{dealer_id:saleSheet.row.dealer_id,old_rickshaw_id:saleSheet.row.id}} onClose={()=>setSaleSheet(null)} onSaved={()=>{setSaleSheet(null);load()}}/>}
    {saleSheet?.mode==='edit'&&<CreatePendingSale key={saleSheet.sale.id} sale={saleSheet.sale} mode="edit" canPickFinancer={canApprove} canEditApproved={canApprove&&saleSheet.sale.status==='APPROVED'} onClose={()=>setSaleSheet(null)} onSaved={()=>{setSaleSheet(null);load()}}/>}
  </>;
}

export function BatterySwapVoucherPage() {
  const [dealers,setDealers]=useState([]),[rows,setRows]=useState([]),[rickshaws,setRickshaws]=useState({new:[],old:[]});
  const [detailRow,setDetailRow]=useState(null);
  const [form,setForm]=useState({date:today(),dealer_id:'',dealer_name:'',from_type:'new',from_id:'',to_type:'new',to_id:'',remarks:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=async()=>{try{const [d,v]=await Promise.all([get('/dealers'),get('/battery-swap-vouchers')]);setDealers(d.dealers||[]);setRows(v.records||v.rows||[]);}catch(e){setError(e.message)}};
  const loadStock=async dealerId=>{if(!dealerId){setRickshaws({new:[],old:[]});return;}try{const [n,o]=await Promise.all([get('/dealer/rickshaw-battery-options?dealer_id='+dealerId+'&type=new'),get('/dealer/rickshaw-battery-options?dealer_id='+dealerId+'&type=old')]);setRickshaws({new:n.rickshaws||[],old:o.rickshaws||[]});}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[]);
  useEffect(()=>{loadStock(form.dealer_id)},[form.dealer_id]);
  const dealerOptions=dealers.map(d=>({value:d.name,label:d.name}));
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
      <Field label="To Rickshaw" type="select" value={form.to_id} options={opts(form.to_type).filter(o=>!(form.to_type===form.from_type&&String(o.value)===String(form.from_id)))} onChange={v=>{setError('');setForm({...form,to_id:Number(v)})}} required/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
    </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save Battery Swap / Exchange'}</button></div></form>
  </div><div className="card"><h2>Swap / Exchange History</h2><div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Voucher</th><th>Dealer</th><th>Mode</th><th>From Rickshaw</th><th>To Rickshaw</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.voucher_no}</td><td>{r.dealer_name||dealers.find(d=>String(d.id)===String(r.dealer_id))?.name||r.dealer_id}</td><td>{r.mode}</td><td><b>{r.from_model_name||'—'}</b><br/><span className="muted">{r.from_chassis_no||r.from_reg_no||('ID '+r.from_id)}</span></td>
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
          <Field label="Dealer" value={detailRow.dealer_name||dealers.find(d=>String(d.id)===String(detailRow.dealer_id))?.name||detailRow.dealer_id} readOnly />
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
  const load=async()=>{try{const [d,v]=await Promise.all([get('/dealers'),get('/battery-withdrawal')]);setDealers(d.dealers||[]);setRows(v.records||v.rows||[]);}catch(e){setError(e.message)}};
  const loadR=async()=>{if(!form.dealer_id){setRickshaws([]);return;}const x=await get('/dealer/rickshaw-battery-options?dealer_id='+form.dealer_id+'&type='+form.rickshaw_type);setRickshaws(x.rickshaws||[]);};
  useEffect(()=>{load()},[]);
  useEffect(()=>{loadR()},[form.dealer_id,form.rickshaw_type]);
  const current=rickshaws.find(x=>String(x.id)===String(form.rickshaw_id));
  const save=async e=>{e.preventDefault();setBusy(true);setError('');try{await post('/battery-withdrawal',form);setForm({...form,rickshaw_id:'',battery_no:'',reference_no:'',remarks:''});await load();await loadR();}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="page"><div className="card"><h2>Battery Withdrawal</h2><p className="muted">Rickshaw se battery nikaal kar dealer ke battery stock me aa jayegi.</p><ErrorBanner message={error}/>
    <form onSubmit={save}><div className="formgrid">
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Dealer" type="combo" value={form.dealer_name} options={dealers.map(d=>({value:d.name,label:d.name}))} onChange={v=>{const d=dealers.find(x=>String(x.name).trim().toLowerCase()===String(v).trim().toLowerCase());setForm({...form,dealer_name:v,dealer_id:d?Number(d.id):'',rickshaw_id:'',battery_no:''})}} required/>
      <Field label="Rickshaw Type" type="select" value={form.rickshaw_type} options={[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>setForm({...form,rickshaw_type:v,rickshaw_id:'',battery_no:''})}/>
      <Field label="Rickshaw" type="select" value={form.rickshaw_id} options={rickshaws.map(r=>({value:r.id,label:(r.reg_no||r.chassis_no)+' — '+(r.model_name||'')+(r.battery_maker?' — '+r.battery_maker:'')}))} onChange={v=>setForm({...form,rickshaw_id:Number(v),battery_no:''})} required/>
      <Field label="Battery Maker" value={current?.battery_maker||''} readOnly/>
      <Field label="Battery No." type="select" value={form.battery_no} options={(current?.battery_numbers||[]).map(n=>({value:n,label:n}))} onChange={v=>setForm({...form,battery_no:v})} required/>
      <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
    </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Withdraw Battery'}</button></div></form></div>
    <div className="card"><h2>Dealer Battery Withdrawal History</h2><div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Reference</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.dealer_name}</td><td>{r.battery_maker}</td><td>{r.battery_no}</td><td>{r.reference_no||'—'}</td><td><button className="btn danger" onClick={()=>window.confirm('Delete this withdrawal?')&&del('/battery-withdrawal?id='+r.id).then(load).catch(e=>setError(e.message))}>Delete</button></td></tr>)}</tbody></table></div></div>
  </div>;
}


export function BatteryAdditionPage() {
  const [location,setLocation]=useState('dealer');
  const [dealers,setDealers]=useState([]),[rickshaws,setRickshaws]=useState([]),[batteries,setBatteries]=useState([]);
  const [form,setForm]=useState({date:today(),location:'dealer',dealer_id:'',rickshaw_type:'new',rickshaw_id:'',battery_no:'',battery_maker:'',reference_no:'',remarks:''});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{
    try{
      if(location==='factory'){
        const r=await get('/battery-addition?location=factory');
        setRickshaws(r.rickshaws||[]); setBatteries([]); return;
      }
      const d=await get('/dealers'); setDealers(d.dealers||[]);
      if(form.dealer_id){
        const [r,b]=await Promise.all([
          get('/dealer/rickshaw-battery-options?dealer_id='+form.dealer_id+'&type='+form.rickshaw_type),
          get('/battery-addition?dealer_id='+form.dealer_id)
        ]);
        setRickshaws((r.rickshaws||[]).filter(x=>!(x.battery_numbers||[]).length));
        setBatteries(b.batteries||[]);
      } else { setRickshaws([]); setBatteries([]); }
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[location,form.dealer_id,form.rickshaw_type]);
  const save=async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      await post('/battery-addition',{...form,location});
      setForm(f=>({...f,rickshaw_id:'',battery_no:'',battery_maker:'',reference_no:'',remarks:''}));
      await load();
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  return <div className="page"><div className="card">
    <h2>Battery Fit to Rickshaw</h2>
    <p className="muted">Battery ko selected New/Old Rickshaw me fit karein.</p>
    <ErrorBanner message={error}/>
    <form onSubmit={save}><div className="formgrid">
      <Field label="Location" type="select" value={location} options={[{value:'dealer',label:'Dealer'},{value:'factory',label:'Factory'}]} onChange={v=>{setLocation(v);setForm(f=>({...f,location:v,dealer_id:'',rickshaw_id:'',battery_no:'',battery_maker:''}));setError('')}}/>
      {location==='dealer' && <Field label="Dealer" type="select" value={form.dealer_id} options={dealers.map(d=>({value:d.id,label:d.name}))} onChange={v=>setForm(f=>({...f,dealer_id:Number(v),rickshaw_id:'',battery_no:''}))} required/>}
      <Field label="Rickshaw Type" type="select" value={form.rickshaw_type} options={location==='factory'?[{value:'new',label:'New Rickshaw'}]:[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}]} onChange={v=>setForm(f=>({...f,rickshaw_type:v,rickshaw_id:'',battery_no:''}))}/>
      <Field label="Rickshaw" type="select" value={form.rickshaw_id} options={rickshaws.map(x=>({value:x.id,label:(x.reg_no||x.chassis_no)+' — '+(x.model_name||'')}))} onChange={v=>setForm(f=>({...f,rickshaw_id:Number(v),battery_no:''}))} required/>
      {location==='dealer'
        ? <Field label="Battery No." type="select" value={form.battery_no} options={batteries.map(x=>({value:x.battery_no,label:(x.battery_maker||'')+' — '+x.battery_no}))} onChange={v=>{const b=batteries.find(x=>x.battery_no===v);setForm(f=>({...f,battery_no:v,battery_maker:b?.battery_maker||''}))}} required/>
        : <><Field label="Battery Maker" value={form.battery_maker} onChange={v=>setForm(f=>({...f,battery_maker:v}))} required/><Field label="Battery No." value={form.battery_no} onChange={v=>setForm(f=>({...f,battery_no:v}))} required/></>}
      <Field label="Reference No." value={form.reference_no} onChange={v=>setForm(f=>({...f,reference_no:v}))}/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm(f=>({...f,remarks:v}))}/>
    </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Fit Battery to Rickshaw'}</button></div></form>
  </div></div>;
}

export function BatteryFitPage() {
  const [challans,setChallans]=useState([]),[makers,setMakers]=useState([]),[form,setForm]=useState({challan_id:'',battery_maker:'',battery_no1:'',battery_no2:'',battery_no3:'',battery_no4:'',fit_date:today(),reference_no:'',remarks:''});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{
    try{
      const [c,m]=await Promise.all([get('/battery-fit'),get('/masters/battery-maker')]);
      setChallans(c.challans||[]);
      const rows=Array.isArray(m)?m:(m?.masters||m?.rows||m?.data||[]);
      setMakers(rows);
    }catch(e){setError(e.message)}
  };
  useEffect(()=>{load()},[]);
  const selected=challans.find(x=>String(x.id)===String(form.challan_id));
  const save=async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      await post('/battery-fit',form);
      setForm({challan_id:'',battery_maker:'',battery_no1:'',battery_no2:'',battery_no3:'',battery_no4:'',fit_date:today(),reference_no:'',remarks:''});
      await load();
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  return <div className="page">
    <div className="card"><h2>Factory → Dealer Battery Fit</h2>
      <p className="muted">Factory se battery direct dealer ke Delivery Challan par fit hogi. Dealer battery stock me issue/addition ki zarurat nahi.</p>
      <ErrorBanner message={error}/>
      <form onSubmit={save}><div className="formgrid">
        <Field label="Delivery Challan" type="select" value={form.challan_id} options={[{value:'',label:'Select Challan'},...challans.map(x=>({value:x.id,label:(x.challan_no||'—')+' — '+(x.dealer_name||'')+' — '+(x.chassis_no||'')}))]} onChange={v=>{const x=challans.find(z=>String(z.id)===String(v));setForm(f=>({...f,challan_id:Number(v),battery_maker:x?.battery_maker||'',battery_no1:x?.battery_no1||'',battery_no2:x?.battery_no2||'',battery_no3:x?.battery_no3||'',battery_no4:x?.battery_no4||''}))}} required/>
        <Field label="Fit Date" type="date" value={form.fit_date} onChange={v=>setForm({...form,fit_date:v})} required/>
        <Field label="Dealer" value={selected?.dealer_name||''} readOnly/>
        <Field label="Chassis No." value={selected?.chassis_no||''} readOnly/>
        <Field label="Battery Maker" type="select" value={form.battery_maker} options={[{value:'',label:'Select Battery Maker'},...makers.map(x=>({value:x.name,label:x.name}))]} onChange={v=>setForm({...form,battery_maker:v})} required/>
        <Field label="Battery No. 1" value={form.battery_no1} onChange={v=>setForm({...form,battery_no1:v})} required/>
        <Field label="Battery No. 2" value={form.battery_no2} onChange={v=>setForm({...form,battery_no2:v})}/>
        <Field label="Battery No. 3" value={form.battery_no3} onChange={v=>setForm({...form,battery_no3:v})}/>
        <Field label="Battery No. 4" value={form.battery_no4} onChange={v=>setForm({...form,battery_no4:v})}/>
        <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
        <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
      </div><div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Fit Battery'}</button></div></form>
    </div>
    <div className="card"><h2>Battery Fit History</h2><div className="tablewrap"><table className="table"><thead><tr><th>Fit Date</th><th>Challan</th><th>Dealer</th><th>Chassis</th><th>Battery</th><th>Old Battery</th></tr></thead><tbody>{challans.filter(x=>x.battery_fit_date).map(x=><tr key={x.id}><td>{formatDate(x.battery_fit_date)}</td><td>{x.challan_no}</td><td>{x.dealer_name}</td><td>{x.chassis_no}</td><td>{x.battery_maker||'—'} {x.battery_no1||''}</td><td>{x.old_battery_maker||'—'}</td></tr>)}</tbody></table></div></div>
  </div>;
}

export function BatteryDeliveryChallanPage() {
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]),[makers,setMakers]=useState([]),[open,setOpen]=useState(false);
  const [form,setForm]=useState({date:today(),qty:1,battery_numbers:['']});
  const {busy,error,setError,run}=useAsyncAction();
  const load=()=>get('/battery-delivery-challans').then(d=>{const list=Array.isArray(d)?d:(d?.records||d?.rows||d?.items||d?.data||[]);setData({...(Array.isArray(d)?{}:d),records:Array.isArray(list)?list:[]})}).catch(e=>setError(e.message));
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[]));get('/masters/battery-maker').then(d=>setMakers(Array.isArray(d)?d:(d.masters||[]))).catch(()=>setMakers([]));},[]);
  const openNew=()=>{setForm({date:today(),qty:1,challan_no:data?.suggested_challan_no||'',dealer_id:'',battery_maker:'',battery_numbers:[''],remarks:''});setOpen(true)};
  const setQty=(v)=>{const qty=Math.max(1,Number(v)||1);setForm(f=>({...f,qty,battery_numbers:Array.from({length:qty},(_,i)=>f.battery_numbers?.[i]||'')}))};
  const setNo=(i,v)=>setForm(f=>({...f,battery_numbers:f.battery_numbers.map((x,n)=>n===i?v:x)}));
  const save=e=>{e.preventDefault();run(async()=>{await post('/battery-delivery-challans',form);setOpen(false);load()})};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/battery-delivery-challans/'+id);load()})};
  if(!data)return <div className="card">{error?<><b>Battery Delivery Challan load failed</b><div style={{marginTop:8,color:'#c0392b'}}>{error}</div><button className="btn" style={{marginTop:12}} onClick={()=>{setError('');load()}}>Retry</button></>:'Loading…'}</div>;
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
  const [search,setSearch]=useState(''),[page,setPage]=useState(1);
  const [rawItems,setRawItems]=useState([]);
  const [form,setForm]=useState({date:today(),item_type:'R',work_type:'IN'});
  const [work,setWork]=useState({date:today(),work_type:'raw-production',model_name:'',output_item:'',output_qty:1,inputs:[{item_name:'',qty_per_unit:1}],reason:''});
  const {busy,error,setError,run}=useAsyncAction();
  const load=()=>Promise.all([
    get('/journal-stock?'+new URLSearchParams({page,per_page:50,...(search?{search}: {})})),
    get('/products?fro=R&page=1&per_page=500')
  ]).then(([d,p])=>{setData(d);setRawItems(p.products||p.rows||[])}).catch(e=>setError(e.message));
  useEffect(()=>{load();},[page,search]);
  const openNew=()=>{setForm({date:today(),item_type:'R',work_type:'IN',vou_no:data?.suggested_vou_no||''});setOpen(true);};
  const save=e=>{e.preventDefault();run(async()=>{await post('/journal-stock',form);setOpen(false);load();});};
  const saveWork=e=>{e.preventDefault();run(async()=>{await post('/journal-stock/work',work);setWorkOpen(false);load();});};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/journal-stock/'+id);load();});};
  const addInput=()=>setWork(x=>({...x,inputs:[...x.inputs,{item_name:'',qty_per_unit:1}]}));
  const updateInput=(i,k,v)=>setWork(x=>({...x,inputs:x.inputs.map((a,n)=>n===i?{...a,[k]:v}:a)}));
  if(!data)return <div className="card">Loading…</div>;
  const opts=rawItems.map(x=>({value:x.name,label:(x.name||'')+(x.code?' — '+x.code:'')}));
  return <>
    <div className="actions" style={{marginBottom:14,flexWrap:'wrap'}}>
      <button className="btn primary" onClick={openNew}>+ Raw Material Stock Entry</button>
      <button className="btn" onClick={()=>setWorkOpen(true)}>+ Raw Material Production</button>
      <input className="input" placeholder="Search raw material, model, voucher…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} style={{maxWidth:280}}/>
    </div>
    <ErrorBanner message={!open&&!workOpen?error:''}/>
    {!data.records.length?<EmptyState/>:<>
      <div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Vou. No.</th><th>Raw Material</th><th>Model</th><th>Qty</th><th>Work</th><th>Reason</th><th></th></tr></thead>
      <tbody>{data.records.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.item_name}</td><td>{r.model_name||'—'}</td><td>{r.qty}</td><td>{r.work_type||'Adjustment'}</td><td>{r.reason||'—'}</td><td><button className="btn danger" onClick={()=>remove(r.id)}>Delete</button></td></tr>)}</tbody></table></div>
      <div className="actions" style={{justifyContent:'space-between',marginTop:10}}><span className="muted">Page {data.page}{data.has_next?' · More records available':''}</span><div><button className="btn" disabled={data.page<=1} onClick={()=>setPage(p=>p-1)}>← Prev</button> <button className="btn" disabled={!data.has_next} onClick={()=>setPage(p=>p+1)}>Next →</button></div></div>
    </>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}><h2>Raw Material Stock Entry</h2><ErrorBanner message={error}/><div className="formgrid">
      <Field label="Vou. No." value={form.vou_no} onChange={v=>setForm({...form,vou_no:v})}/><Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Raw Material" type="select" value={form.item_name||''} options={[{value:'',label:'Select Raw Material'},...opts]} onChange={v=>setForm({...form,item_name:v,item_type:'R'})} required/>
      <Field label="Qty (+/-)" type="number" value={form.qty} onChange={v=>setForm({...form,qty:v})} required/>
      <Field label="Entry" type="select" value={form.work_type||'IN'} options={[{value:'IN',label:'Produce / Stock IN'},{value:'OUT',label:'Use / Stock OUT'}]} onChange={v=>setForm({...form,work_type:v})}/>
      <Field label="Model (optional)" value={form.model_name} onChange={v=>setForm({...form,model_name:v})}/><Field label="Reason" value={form.reason} onChange={v=>setForm({...form,reason:v})}/>
    </div><div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div></form></div>}
    {workOpen&&<div className="modal"><form className="modalbox" onSubmit={saveWork}><h2>Raw Material Production</h2><ErrorBanner message={error}/><p className="muted">Is voucher me input bhi Raw Material hoga aur output bhi Raw Material hoga. Input stock OUT aur produced material stock IN automatically post hoga.</p>
      <div className="formgrid"><Field label="Date" type="date" value={work.date} onChange={v=>setWork({...work,date:v})}/><Field label="Output Raw Material" type="select" value={work.output_item} options={[{value:'',label:'Select Raw Material'},...opts]} onChange={v=>setWork({...work,output_item:v})} required/><Field label="Output Qty" type="number" value={work.output_qty} onChange={v=>setWork({...work,output_qty:v})} required/><Field label="Model (optional)" value={work.model_name} onChange={v=>setWork({...work,model_name:v})}/><Field label="Voucher No." value={work.vou_no||''} onChange={v=>setWork({...work,vou_no:v})}/><Field label="Reason" value={work.reason} onChange={v=>setWork({...work,reason:v})}/></div>
      <div className="card" style={{marginTop:14}}><div className="actions" style={{justifyContent:'space-between'}}><b>Raw Material Inputs</b><button type="button" className="btn" onClick={addInput}>+ Add Material</button></div>
      {work.inputs.map((x,i)=><div key={i} className="formgrid" style={{marginTop:8}}><Field label="Raw Material" type="select" value={x.item_name} options={[{value:'',label:'Select Raw Material'},...opts]} onChange={v=>updateInput(i,'item_name',v)}/><Field label="Qty / Output Unit" type="number" value={x.qty_per_unit} onChange={v=>updateInput(i,'qty_per_unit',v)}/></div>)}</div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setWorkOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save Raw Production</button></div>
    </form></div>}
  </>;
}

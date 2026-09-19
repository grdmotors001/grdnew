'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';

const today = () => new Date().toISOString().slice(0, 10);

export function OldRickshawPage() {
  const [data,setData]=useState(null),[dealers,setDealers]=useState([]);
  const [open,setOpen]=useState(false),[saleOpen,setSaleOpen]=useState(false),[saleRow,setSaleRow]=useState(null);
  const [form,setForm]=useState({date:today(),source:'manual'}),[sale,setSale]=useState({sale_date:today()});
  const {busy,error,setError,run}=useAsyncAction();

  const load=()=>get('/old-rickshaws?status='+encodeURIComponent('available')).then(d=>setData(d)).catch(e=>setError(e.message));
  useEffect(()=>{load();get('/dealers').then(d=>setDealers(d.dealers||[])).catch(()=>{});},[]);

  const openNew=()=>{setForm({date:today(),source:'manual',record_no:data?.suggested_record_no||''});setOpen(true);};
  const save=e=>{e.preventDefault();run(async()=>{await post('/old-rickshaws',form);setOpen(false);load();});};
  const openSale=r=>{setSaleRow(r);setSale({sale_date:today(),dealer_id:'',sale_amount:r.purchase_amount||'',file_charge:'',loan_amount:'',down_payment:'',dealer_page_no:r.dealer_page_no||'',sp_no:r.sp_no||''});setSaleOpen(true);};
  const saveSale=e=>{e.preventDefault();run(async()=>{await post('/old-rickshaws/sale',{...sale,id:saleRow.id});setSaleOpen(false);setSaleRow(null);load();});};
  const remove=id=>{if(!confirm('Delete this record?'))return;run(async()=>{await del('/old-rickshaws/'+id);load();});};

  if(!data)return <div className="card">Loading…</div>;
  return <>
    <div className="actions" style={{marginBottom:14}}>
      <button className="btn primary" onClick={openNew}>+ Purchase / Available Old Rickshaw</button>
      <span className="muted" style={{alignSelf:'center'}}>Record No. is the regular GRD serial. SP No. is only for Old Rickshaw manual register.</span>
    </div>
    <ErrorBanner message={!open&&!saleOpen?error:''}/>
    {data.records.length===0?<EmptyState text="No Old Rickshaw currently available in GRD stock."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Record No.</th><th>Date</th><th>Source</th><th>Reg. No.</th><th>Model</th><th>Battery</th><th>Purchase Amt.</th><th>SP No.</th><th>Action</th>
      </tr></thead><tbody>{data.records.map(r=><tr key={r.id}>
        <td>{r.record_no}</td><td>{formatDate(r.date)}</td><td>{r.source==='chfpl'?'CHFPL':'Manual'}</td><td><b>{r.vehicle_reg_no}</b></td><td>{r.model_name}</td>
        <td>{r.has_battery?'Yes':'No'}</td><td><Money value={r.purchase_amount}/></td><td>{r.sp_no||'—'}</td>
        <td><button className="btn primary" onClick={()=>openSale(r)}>Sale to Dealer</button> <button className="btn danger" onClick={()=>remove(r.id)}>Delete</button></td>
      </tr>)}</tbody></table></div>}
    {open&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>Old Rickshaw Purchase / Opening</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <Field label="Record No." value={form.record_no} onChange={v=>setForm({...form,record_no:v})}/>
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
        <Field label="Purchase Source" type="select" value={form.source} options={[{value:'manual',label:'Manual Purchase'},{value:'chfpl',label:'CHFPL Available for Sale'}]} onChange={v=>setForm({...form,source:v})}/>
        <Field label="CHFPL / Purchase Ref No." value={form.chfpl_ref_no||form.purchase_ref_no||''} onChange={v=>setForm({...form,chfpl_ref_no:v,purchase_ref_no:v})}/>
        <Field label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={v=>setForm({...form,vehicle_reg_no:v})} required/>
        <Field label="Model Name" value={form.model_name} onChange={v=>setForm({...form,model_name:v})}/>
        <Field label="Previous Owner" value={form.owner_name} onChange={v=>setForm({...form,owner_name:v})}/>
        <Field label="Purchase Amount" type="number" value={form.purchase_amount} onChange={v=>setForm({...form,purchase_amount:v})}/>
        <Field label="Battery Maker" value={form.battery_maker} onChange={v=>setForm({...form,battery_maker:v})}/>
        <Field label="Battery No. 1" value={form.battery_no1} onChange={v=>setForm({...form,battery_no1:v})}/>
        <Field label="Battery No. 2" value={form.battery_no2} onChange={v=>setForm({...form,battery_no2:v})}/>
        <Field label="Battery No. 3" value={form.battery_no3} onChange={v=>setForm({...form,battery_no3:v})}/>
        <Field label="Battery No. 4" value={form.battery_no4} onChange={v=>setForm({...form,battery_no4:v})}/>
        <Field label="SP No. (Old Register)" value={form.sp_no} onChange={v=>setForm({...form,sp_no:v})}/>
        <Field label="Dealer Page No." value={form.dealer_page_no} onChange={v=>setForm({...form,dealer_page_no:v})}/>
        <Field label="Remarks" value={form.remarks1} onChange={v=>setForm({...form,remarks1:v})}/>
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
        <Field label="File Charge" type="number" value={sale.file_charge} onChange={v=>setSale({...sale,file_charge:v})}/>
        <Field label="Loan Amount" type="number" value={sale.loan_amount} onChange={v=>setSale({...sale,loan_amount:v})}/>
        <Field label="Down Payment" type="number" value={sale.down_payment} onChange={v=>setSale({...sale,down_payment:v})}/>
        <Field label="Dealer Page No." value={sale.dealer_page_no} onChange={v=>setSale({...sale,dealer_page_no:v})}/>
        <Field label="SP No. (Old Register)" value={sale.sp_no} onChange={v=>setSale({...sale,sp_no:v})}/>
        <Field label="Sale Ref No." value={sale.sale_ref_no} onChange={v=>setSale({...sale,sale_ref_no:v})}/>
      </div>
      <div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setSaleOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save Sale'}</button></div>
    </form></div>}
  </>;
}

export function BatteryDeliveryChallanPage() {
  const [data, setData] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today(), qty: 1 });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/battery-delivery-challans').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); get('/dealers').then((d) => setDealers(d.dealers)); }, []);

  const openNew = () => { setForm({ date: today(), qty: 1, challan_no: data?.suggested_challan_no || '' }); setOpen(true); };
  const save = (e) => { e.preventDefault(); run(async () => { await post('/battery-delivery-challans', form); setOpen(false); load(); }); };
  const remove = (id) => { if (!confirm('Delete this record?')) return; run(async () => { await del(`/battery-delivery-challans/${id}`); load(); }); };

  if (!data) return <div className="card">Loading…</div>;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Battery Delivery Challan</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {data.records.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Qty</th><th></th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.challan_no}</td><td>{r.dealer_name}</td>
                  <td>{r.battery_maker}</td><td>{r.battery_no}</td><td>{r.qty}</td>
                  <td><button className="btn danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>New Battery Delivery Challan</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              <Field label="Challan No." value={form.challan_no} onChange={(v) => setForm({ ...form, challan_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Dealer" type="select" value={form.dealer_id}
                     options={dealers.map((d) => ({ value: d.id, label: d.name }))}
                     onChange={(v) => setForm({ ...form, dealer_id: Number(v) })} required />
              <Field label="Battery Maker" value={form.battery_maker} onChange={(v) => setForm({ ...form, battery_maker: v })} />
              <Field label="Battery No." value={form.battery_no} onChange={(v) => setForm({ ...form, battery_no: v })} />
              <Field label="Qty" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} />
              <Field label="Remarks" value={form.remarks} onChange={(v) => setForm({ ...form, remarks: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function JournalStockPage() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today(), item_type: 'R' });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/journal-stock').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm({ date: today(), item_type: 'R', vou_no: data?.suggested_vou_no || '' }); setOpen(true); };
  const save = (e) => { e.preventDefault(); run(async () => { await post('/journal-stock', form); setOpen(false); load(); }); };
  const remove = (id) => { if (!confirm('Delete this record?')) return; run(async () => { await del(`/journal-stock/${id}`); load(); }); };

  if (!data) return <div className="card">Loading…</div>;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew}>+ New Stock Correction</button>
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {data.records.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Vou. No.</th><th>Item</th><th>Type</th><th>Qty (+/-)</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td><td>{r.vou_no}</td><td>{r.item_name}</td>
                  <td>{r.item_type === 'R' ? 'Raw Material' : 'Finished'}</td><td>{r.qty}</td><td>{r.reason}</td>
                  <td><button className="btn danger" onClick={() => remove(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>New Stock Correction</h2>
            <ErrorBanner message={error} />
            <p className="muted" style={{ fontSize: 12 }}>Use a positive Qty to add stock, negative to remove it — for anything not covered by Purchase / Production / Delivery.</p>
            <div className="formgrid">
              <Field label="Vou. No." value={form.vou_no} onChange={(v) => setForm({ ...form, vou_no: v })} />
              <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Field label="Item Name" value={form.item_name} onChange={(v) => setForm({ ...form, item_name: v })} required />
              <Field label="Item Type" type="select" value={form.item_type}
                     options={[{ value: 'R', label: 'Raw Material' }, { value: 'F', label: 'Finished' }]}
                     onChange={(v) => setForm({ ...form, item_type: v })} />
              <Field label="Qty (+/-)" type="number" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} required />
              <Field label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

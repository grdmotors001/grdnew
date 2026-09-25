export function BillingPendingSalesPage(){
  const [oldChallans,setOldChallans]=useState([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      // This page is intentionally limited to Old Rickshaw verification.
      // Removed slow/unused loan, CHFPL, showroom-delivery and manual-cash
      // billing queries from the page load.
      const o=await get('/billing/old-rickshaw-challans');
      setOldChallans(o.challans||[]);
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  };

  useEffect(()=>{load()},[]);

  return <div className="page">
    <div className="pageHeader">
      <div>
        <h2>Pending Bills / Billing</h2>
        <p className="muted">Old Rickshaw pending verification aur billing workflow.</p>
      </div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <OldRickshawBillingSection rows={oldChallans} onSaved={load}/>
    {loading&&<div className="muted" style={{padding:16}}>Loading…</div>}
  </div>
}

function OldRickshawBillingSection({rows,onSaved}){
 const [edit,setEdit]=useState(null),[form,setForm]=useState({}),[saving,setSaving]=useState(false);
 const open=r=>{setEdit(r);setForm({sale_amount:r.sale_amount||'',file_charge:r.file_charge||'',loan_amount:r.loan_amount||'',down_payment:r.down_payment||'',sale_customer:r.sale_customer||'',sale_mobile:r.sale_mobile||'',sold_at:r.sold_at||new Date().toISOString().slice(0,10)})};
 const save=async()=>{if(!edit)return;setSaving(true);try{await post('/billing/old-rickshaw-challans/'+edit.id+'/sale',form);setEdit(null);onSaved()}catch(e){alert(e.message)}finally{setSaving(false)}};
 const verify=async r=>{if(!confirm('Approve and verify this Old Rickshaw? No bill will be generated.'))return;try{await post('/billing/old-rickshaw-challans/'+r.id+'/approve',{});onSaved()}catch(e){alert(e.message)}};
 return <div className="card" style={{marginBottom:14}}><h3 style={{marginTop:0}}>Old Rickshaw — Pending / Verification</h3><p className="muted">CHFPL seized vehicle → GRD factory challan → dealer stock → Pending → Approval/Verification → Sales & Billing. Old Rickshaw ka Tax Bill yahan generate nahi hoga.</p>
 <div className="tablewrap"><table className="table"><thead><tr><th>Challan</th><th>Date</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Dealer</th><th>Sale / Loan</th><th>Status</th><th>Action</th></tr></thead><tbody>
 {rows.map(r=><tr key={r.id}><td><b>{r.challan_no}</b></td><td>{r.date}</td><td>{r.model_name||'—'}</td><td>{r.vehicle_no||'—'}</td><td>{r.colour||'—'}</td><td>{r.dealer_name||'—'}</td><td><Money value={r.sale_amount}/> / <Money value={r.loan_amount}/></td><td>{r.status}</td><td style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="btn" onClick={()=>open(r)}>Check / Correct</button><button className="btn primary" onClick={()=>verify(r)}>Approve & Verify</button></td></tr>)}{!rows.length&&<tr><td colSpan="9" className="muted">No Old Rickshaw pending for verification.</td></tr>}</tbody></table></div>
 {edit&&<div className="modal"><div className="modalbox"><h2>Old Rickshaw Details — {edit.challan_no}</h2><div className="formgrid"><Field label="Sale Amount" type="number" value={form.sale_amount} onChange={v=>setForm({...form,sale_amount:v})}/><Field label="File Charge" type="number" value={form.file_charge} onChange={v=>setForm({...form,file_charge:v})}/><Field label="Loan Amount" type="number" value={form.loan_amount} onChange={v=>setForm({...form,loan_amount:v})}/><Field label="Down Payment" type="number" value={form.down_payment} onChange={v=>setForm({...form,down_payment:v})}/><Field label="Customer Name" value={form.sale_customer} onChange={v=>setForm({...form,sale_customer:v})}/><Field label="Mobile" value={form.sale_mobile} onChange={v=>setForm({...form,sale_mobile:v})}/><Field label="Sale Date" type="date" value={form.sold_at} onChange={v=>setForm({...form,sold_at:v})}/></div><div className="actions" style={{marginTop:16}}><button className="btn" onClick={()=>setEdit(null)}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving?'Saving…':'Save Details'}</button></div></div></div>}</div>
}


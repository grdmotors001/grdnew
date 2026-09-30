'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {get,post} from '../lib/api';
import {ErrorBanner,EmptyState} from './ui';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const day=v=>String(v||'').slice(0,10);

export function BankLedgerPage(){
  const [rows,setRows]=useState([]),[banks,setBanks]=useState([]),[summary,setSummary]=useState([]),[opening,setOpening]=useState(0);
  const [bank,setBank]=useState(''),[status,setStatus]=useState('all'),[search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[msg,setMsg]=useState('');
  const [edit,setEdit]=useState(null);
  const ref=useRef(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({status});
      if(search.trim())q.set('search',search.trim());
      if(bank)q.set('bank',bank);
      if(from)q.set('from',from);
      if(to)q.set('to',to);
      const d=await get('/bank-ledger?'+q);
      setRows(d.rows||[]);setBanks(d.banks||[]);setSummary(d.summary||[]);setOpening(Number(d.opening||0));
    }catch(e){setError(e.message||'Could not load bank ledger')}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[status,bank,from,to]);
  useEffect(()=>{const t=setTimeout(load,300);return()=>clearTimeout(t)},[search]);

  async function importFile(e){
    const f=e.target.files?.[0];e.target.value='';if(!f)return;
    setBusy(true);setError('');setMsg('');
    try{
      const XLSX=await import('xlsx');
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
      const data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:true});
      if(!data.length)throw new Error('Import file is empty.');
      const r=await post('/bank-ledger/import',{rows:data});
      setMsg(`${r.inserted||0} entries imported to Suspense, ${r.duplicates||0} duplicates skipped, ${r.rejected_count||0} rejected.`+((r.rejected||[]).length?' Rejected: '+r.rejected.slice(0,10).map(x=>`row ${x.row} (${x.reason})`).join('; '):''));
      await load();
    }catch(err){setError(err.message||'Import failed')}finally{setBusy(false)}
  }

  async function save(){
    if(!edit)return;
    setBusy(true);setError('');
    try{
      await post('/bank-ledger/update',edit);
      setEdit(null);setMsg(edit.status==='POSTED'?'Entry posted to ledger.':'Entry updated.');await load();
    }catch(err){setError(err.message||'Could not update entry')}finally{setBusy(false)}
  }

  // Ledger view (one bank): chronological with running balance. Only POSTED entries move the balance.
  const ledger=useMemo(()=>{
    if(!bank)return [];
    let bal=opening;
    return [...rows].reverse().map(r=>{
      const amt=Math.abs(Number(r.amount||0));
      const dr=r.status==='POSTED'&&r.entry_type==='RECEIPT'?amt:0,cr=r.status==='POSTED'&&r.entry_type==='PAYMENT'?amt:0;
      bal+=dr-cr;return {...r,dr,cr,bal};
    });
  },[rows,bank,opening]);
  const suspenseCount=summary.reduce((a,x)=>a+x.suspense_count,0);

  return <div className="page">
    <div className="pageHeader">
      <div><h1>Bank Ledger</h1><p className="muted">Daily bank Excel import → Suspense → manual party/direction → posted to bank ledger</p></div>
      <div className="actions">
        <button className="btn" onClick={()=>ref.current?.click()} disabled={busy}>{busy?'Processing…':'Import Daily Excel'}</button>
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importFile}/>
      </div>
    </div>
    <ErrorBanner message={error}/>{msg&&<div className="card" style={{marginBottom:12}}>{msg}</div>}
    <div className="muted" style={{marginBottom:8}}>Excel columns: Date, Amount, Bank Name (must match Bank Details), Cheque No., UPI / UTR, Narration.</div>

    {summary.length>0&&<div className="tablewrap" style={{marginBottom:12}}><table className="table"><thead><tr><th>Bank</th><th>Receipts</th><th>Payments</th><th>Balance</th><th>Suspense</th><th></th></tr></thead>
      <tbody>{summary.map(x=><tr key={x.bank_name}><td><b>{x.bank_name}</b></td><td>{money(x.receipts)}</td><td>{money(x.payments)}</td><td><b>{money(x.balance)}</b></td>
        <td>{x.suspense_count>0?`${x.suspense_count} (${money(x.suspense_amount)})`:'—'}</td><td><button className="btn" onClick={()=>setBank(x.bank_name)}>Open Ledger</button></td></tr>)}</tbody></table></div>}

    <div className="card" style={{marginBottom:12}}><div className="actions" style={{flexWrap:'wrap'}}>
      <select className="input" value={bank} onChange={e=>setBank(e.target.value)} style={{maxWidth:220}}>
        <option value="">All Banks (list view)</option>{banks.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}
      </select>
      <select className="input" value={status} onChange={e=>setStatus(e.target.value)} style={{maxWidth:200}}>
        <option value="all">All Entries</option><option value="SUSPENSE">Suspense ({suspenseCount})</option><option value="POSTED">Posted</option><option value="CANCELLED">Cancelled</option>
      </select>
      <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{maxWidth:160}}/>
      <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)} style={{maxWidth:160}}/>
      <input className="input" placeholder="Search cheque / UPI / narration / party" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:320}}/>
    </div></div>

    {loading?<div className="card">Loading…</div>:!rows.length?<EmptyState text="No bank entries found."/>:
      <div className="tablewrap"><table className="table"><thead><tr>
        <th>Date</th>{!bank&&<th>Bank</th>}<th>Cheque No.</th><th>UPI / UTR</th><th>Narration</th><th>Party (From / To)</th>
        {bank?<><th>Receipt</th><th>Payment</th><th>Balance</th></>:<th>Amount</th>}<th>Status</th><th>Action</th>
      </tr></thead><tbody>
        {bank&&<tr><td colSpan={5}><b>Opening Balance</b></td><td></td><td></td><td><b>{money(opening)}</b></td><td></td><td></td></tr>}
        {(bank?ledger:rows).map(r=><tr key={r.id} style={r.status==='SUSPENSE'?{background:'rgba(245,158,11,.10)'}:r.status==='CANCELLED'?{opacity:.5}:undefined}>
          <td>{day(r.entry_date)}</td>{!bank&&<td><b>{r.bank_name}</b></td>}<td>{r.cheque_no||'—'}</td><td>{r.upi_ref||'—'}</td><td>{r.narration||'—'}</td><td>{r.party_name||'—'}</td>
          {bank?<><td>{r.dr?money(r.dr):(r.status==='SUSPENSE'?<i>{money(r.amount)}?</i>:'')}</td><td>{r.cr?money(r.cr):''}</td><td>{r.status==='POSTED'?<b>{money(r.bal)}</b>:'—'}</td></>:<td>{money(r.amount)}</td>}
          <td><b>{r.status==='SUSPENSE'?'Suspense':r.status==='POSTED'?(r.entry_type==='RECEIPT'?'Receipt':'Payment'):'Cancelled'}</b></td>
          <td><button className="btn" onClick={()=>setEdit({id:r.id,bank_name:r.bank_name,amount:r.amount,party_name:r.party_name||'',narration:r.narration||'',entry_type:r.entry_type==='PAYMENT'?'PAYMENT':'RECEIPT',status:r.status==='SUSPENSE'?'POSTED':r.status,_was:r.status})}>{r.status==='SUSPENSE'?'Classify':'Edit'}</button></td>
        </tr>)}
        {bank&&ledger.length>0&&<tr><td colSpan={5}><b>Closing Balance</b></td><td></td><td></td><td><b>{money(ledger.filter(x=>x.status==='POSTED').length?ledger.filter(x=>x.status==='POSTED').at(-1).bal:opening)}</b></td><td></td><td></td></tr>}
      </tbody></table></div>}

    {edit&&<div className="modal"><div className="modalbox">
      <h2>{edit._was==='SUSPENSE'?'Classify Suspense Entry':'Edit Bank Entry'}</h2><ErrorBanner message={error}/>
      <div className="formgrid">
        <div className="field"><label>Bank</label><input className="input" value={edit.bank_name} disabled/></div>
        <div className="field"><label>Amount</label><input className="input" value={money(edit.amount)} disabled/></div>
        <div className="field"><label>Direction</label><select className="input" value={edit.entry_type} onChange={e=>setEdit({...edit,entry_type:e.target.value})}><option value="RECEIPT">Receipt (paisa aaya)</option><option value="PAYMENT">Payment (paisa gaya)</option></select></div>
        <div className="field"><label>Party / From-To (manual)</label><input className="input" value={edit.party_name} onChange={e=>setEdit({...edit,party_name:e.target.value})} placeholder="Kis se aaya / kise diya"/></div>
        <div className="field"><label>Narration</label><input className="input" value={edit.narration} onChange={e=>setEdit({...edit,narration:e.target.value})}/></div>
        <div className="field"><label>Status</label><select className="input" value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option value="POSTED">Posted</option><option value="SUSPENSE">Back to Suspense</option><option value="CANCELLED">Cancelled</option></select></div>
      </div>
      <div className="actions" style={{justifyContent:'flex-end',marginTop:14}}><button className="btn" onClick={()=>setEdit(null)}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy?'Saving…':'Save'}</button></div>
    </div></div>}
  </div>
}

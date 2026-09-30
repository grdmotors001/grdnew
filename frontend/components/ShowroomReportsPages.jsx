'use client';

import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { ErrorBanner } from './ui';

const today = () => new Date().toISOString().slice(0,10);
const money = v => '₹ ' + Number(v || 0).toLocaleString('en-IN');
const dateText = v => v ? String(v).slice(0,10) : '—';

function Table({ children }) {
  return <div className="tablewrap"><table className="table">{children}</table></div>;
}

export function ShowroomBatteryStockPage() {
  const [challans,setChallans]=useState([]),[withdrawals,setWithdrawals]=useState([]),[history,setHistory]=useState([]),[dealers,setDealers]=useState([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[typeFilter,setTypeFilter]=useState('ALL');
  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [c,w,h,d]=await Promise.all([
        get('/battery-delivery-challans'),get('/battery-withdrawal'),get('/battery-history'),get('/dealers')
      ]);
      setChallans(c.records||c.rows||c.data||c.items||[]);
      setWithdrawals(w.records||w.rows||w.data||w.items||[]);
      setHistory(h.history||h.rows||[]);
      setDealers(d.dealers||d.rows||[]);
    }catch(e){setError(e.message||'Battery history could not be loaded')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);
  const dealerMap=useMemo(()=>new Map(dealers.map(d=>[Number(d.id),d.name])),[dealers]);
  const q=search.trim().toLowerCase();
  const issued=challans.filter(r=>!q||[r.challan_no,r.battery_maker,r.battery_no,r.dealer_name,dealerMap.get(Number(r.dealer_id)),r.remarks].join(' ').toLowerCase().includes(q));
  const removed=withdrawals.filter(r=>!q||[r.battery_maker,r.battery_no,r.dealer_name,dealerMap.get(Number(r.dealer_id)),r.reference_no,r.remarks,r.entry_type].join(' ').toLowerCase().includes(q));
  const eventDate=r=>dateText(r.fit_date||r.date||r.created_at);
  const batteryNos=r=>[r.battery_no,r.battery_no1,r.battery_no2,r.battery_no3,r.battery_no4].filter(Boolean).join(', ');
  const eventLabel=r=>{
    const t=r.history_type;
    if(t==='FIT')return 'BATTERY FIT';
    if(t==='FACTORY_CHALLAN')return 'FACTORY CHALLAN';
    if(t==='SWAP')return String(r.movement_type||'swap').toUpperCase();
    if(t==='DEALER_MOVEMENT')return String(r.movement_type||'MOVEMENT').toUpperCase();
    const et=String(r.entry_type||'').toUpperCase(),st=String(r.source_type||'').toUpperCase();
    if(et==='IN'&&st.includes('PURCHASE'))return 'PURCHASE IN';
    if(et==='OUT'&&(st.includes('DELIVERY')||st.includes('CHALLAN')))return 'DELIVERY OUT';
    return [et,st].filter(Boolean).join(' · ')||'REGISTER';
  };
  const typeOptions=useMemo(()=>[...new Set(history.map(eventLabel))].sort(),[history]);
  const histRows=history.filter(r=>(typeFilter==='ALL'||eventLabel(r)===typeFilter)&&(!q||[eventLabel(r),r.battery_maker,batteryNos(r),r.dealer_name,r.party_name,r.chassis_no,r.model_name,r.source_no,r.source_type,r.challan_no,r.reference_no,r.voucher_no,r.remarks,r.reason].join(' ').toLowerCase().includes(q)));
  return <div className="page"><div className="card">
    <div className="actions" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
      <div><h2 style={{marginBottom:4}}>Battery Stock & History</h2><p className="muted" style={{margin:0}}>Battery ka complete movement: Factory Challan → Dealer → Fit / Withdrawal / Swap / Addition.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <div className="actions" style={{margin:'12px 0'}}>
      <input className="input" style={{maxWidth:460}} placeholder="Search battery no., maker, challan, dealer, chassis…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select className="input" style={{maxWidth:220}} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
        <option value="ALL">All Types</option>{typeOptions.map(t=><option key={t} value={t}>{t}</option>)}
      </select>
    </div>
    {loading?<div className="muted">Loading…</div>:<>
      <div className="actions" style={{marginBottom:12}}>
        <span className="card" style={{padding:'8px 12px'}}><b>Factory Challans:</b> {issued.length}</span>
        <span className="card" style={{padding:'8px 12px'}}><b>Withdrawals:</b> {removed.length}</span>
        <span className="card" style={{padding:'8px 12px'}}><b>History Events:</b> {histRows.length}</span>
      </div>
      <h3>Complete Battery History</h3>
      <Table><thead><tr><th>Date</th><th>Type</th><th>Battery</th><th>Dealer</th><th>Vehicle / Chassis</th><th>Source / Reference</th><th>Remarks</th></tr></thead><tbody>
        {histRows.map((r,i)=><tr key={String(r.history_type)+'-'+String(r.id)+'-'+i}>
          <td>{eventDate(r)}</td><td><b>{eventLabel(r)}</b></td><td>{r.battery_maker||'—'} {batteryNos(r)?'— '+batteryNos(r):''}</td>
          <td>{r.dealer_name||r.party_name||'—'}</td><td>{r.chassis_no||r.model_name||'—'}</td>
          <td>{r.source_no||r.challan_no||r.reference_no||r.voucher_no||r.shift_ref||r.source_type||'—'}</td><td>{r.remarks||r.reason||'—'}</td>
        </tr>)}
        {!histRows.length&&<tr><td colSpan="7" className="muted">No battery history found.</td></tr>}
      </tbody></Table>

      <h3 style={{marginTop:22}}>Factory Battery Challans</h3>
      <Table><thead><tr><th>Date</th><th>Challan No.</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Qty</th></tr></thead><tbody>
        {issued.map(r=><tr key={'c'+r.id}><td>{dateText(r.date)}</td><td><b>{r.challan_no||'—'}</b></td><td>{r.dealer_name||dealerMap.get(Number(r.dealer_id))||'—'}</td><td>{r.battery_maker||'—'}</td><td>{r.battery_no||r.battery_numbers||'—'}</td><td>{r.qty||1}</td></tr>)}
        {!issued.length&&<tr><td colSpan="6" className="muted">No battery challan records found.</td></tr>}
      </tbody></Table>

      <h3 style={{marginTop:22}}>Battery Withdrawal / Remove</h3>
      <Table><thead><tr><th>Date</th><th>Dealer</th><th>Battery Maker</th><th>Battery No.</th><th>Type</th><th>Reference</th><th>Remarks</th></tr></thead><tbody>
        {removed.map(r=><tr key={'w'+r.id}><td>{dateText(r.date)}</td><td>{r.dealer_name||dealerMap.get(Number(r.dealer_id))||r.party_name||'—'}</td><td>{r.battery_maker||'—'}</td><td>{r.battery_no||'—'}</td><td>{r.entry_type||r.work_type||'WITHDRAWAL'}</td><td>{r.reference_no||r.source_no||'—'}</td><td>{r.remarks||'—'}</td></tr>)}
        {!removed.length&&<tr><td colSpan="7" className="muted">No withdrawal records found.</td></tr>}
      </tbody></Table>
    </>}
  </div></div>;
}

export function ShowroomAllCustomersPage() {
  const [rows,setRows]=useState([]),[dealers,setDealers]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');
  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [c,d]=await Promise.all([get('/dealer/customers'),get('/dealers')]);
      setRows(c.customers||c.rows||c.data||[]);
      setDealers(d.dealers||d.rows||[]);
    }catch(e){setError(e.message||'Customers could not be loaded')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);
  const dealerMap=useMemo(()=>new Map(dealers.map(d=>[Number(d.id),d.name])),[dealers]);
  const q=search.trim().toLowerCase();
  const filtered=rows.filter(r=>[r.name,r.full_name,r.customer_name,r.phone,r.mobile,r.vehicle_no,r.chassis_no,dealerMap.get(Number(r.dealer_id))].join(' ').toLowerCase().includes(q));

  return <div className="page"><div className="card">
    <div className="actions" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
      <div><h2 style={{marginBottom:4}}>All Customers</h2><p className="muted" style={{margin:0}}>Customer Booking se create hue records yahan dikhenge.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <input className="input" style={{maxWidth:420,margin:'12px 0'}} placeholder="Search customer, mobile, vehicle, chassis…" value={search} onChange={e=>setSearch(e.target.value)}/>
    {loading?<div className="muted">Loading…</div>:<Table><thead><tr><th>Customer</th><th>Mobile</th><th>Dealer</th><th>Vehicle</th><th>Chassis</th><th>Date</th><th>Status</th></tr></thead><tbody>
      {filtered.map(r=><tr key={r.id}><td><b>{r.name||r.full_name||r.customer_name||'—'}</b></td><td>{r.phone||r.mobile||r.customer_phone||'—'}</td><td>{r.dealer_name||dealerMap.get(Number(r.dealer_id))||'—'}</td><td>{r.vehicle_no||r.vehicle_reg_no||r.reg_no||'—'}</td><td>{r.chassis_no||'—'}</td><td>{dateText(r.date||r.created_at)}</td><td>{r.status||r.stage||'—'}</td></tr>)}
      {!filtered.length&&<tr><td colSpan="7" className="muted">No customers found.</td></tr>}
    </tbody></Table>}
  </div></div>;
}

export function ShowroomExpensesReportsPage() {
  const [vouchers,setVouchers]=useState([]),[shop,setShop]=useState([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const load=async()=>{
    setLoading(true);setError('');
    try{
      // Backend cancelled/inactive rows hata kar vouchers + shop expenses ek hi call me deta hai.
      const s=await get('/showroom/expenses-reports');
      setVouchers(s.vouchers||[]);
      setShop(s.shop_expenses||[]);
    }catch(e){setError(e.message||'Expenses could not be loaded')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);
  const day=r=>String(r.date||r.expense_date||'').slice(0,10);
  const inRange=r=>{const d=day(r);return (!from||(d&&d>=from))&&(!to||(d&&d<=to))};
  const q=search.trim().toLowerCase();
  const voucherRows=vouchers.filter(r=>inRange(r)&&(!q||[r.expense_type_name,r.expense_type,r.pay_to_name,r.dealer_name,r.remarks,r.bill_no,r.voucher_no].join(' ').toLowerCase().includes(q)));
  const shopRows=shop.filter(r=>inRange(r)&&(!q||[r.category_label,r.category,r.paid_to,r.dealer_name,r.remarks,r.expense_no].join(' ').toLowerCase().includes(q)));
  const sum=rows=>rows.reduce((t,r)=>t+Number(r.amount||0),0);
  const voucherTotal=sum(voucherRows),shopTotal=sum(shopRows),total=voucherTotal+shopTotal;

  return <div className="page"><div className="card">
    <div className="actions" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
      <div><h2 style={{marginBottom:4}}>Expenses Reports</h2><p className="muted" style={{margin:0}}>HO expenses, payment vouchers aur showroom/shop expenses ek jagah.</p></div>
      <button className="btn" onClick={load}>↻ Refresh</button>
    </div>
    <ErrorBanner message={error}/>
    <div className="formgrid" style={{marginTop:12}}>
      <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)} />
      <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)} />
      <input className="input" placeholder="Search expense, paid to, dealer, voucher…" value={search} onChange={e=>setSearch(e.target.value)}/>
    </div>
    {loading?<div className="muted">Loading…</div>:<>
      <div className="card" style={{marginTop:14,padding:12}}><b>Total Expenses: {money(total)}</b> · Payment Vouchers: {voucherRows.length} ({money(voucherTotal)}) · Shop Expenses: {shopRows.length} ({money(shopTotal)})</div>
      <h3 style={{marginTop:20}}>Expense Payment Vouchers</h3>
      <Table><thead><tr><th>Date</th><th>Voucher</th><th>Expense</th><th>Pay To</th><th>Dealer</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead><tbody>
        {voucherRows.map(r=><tr key={'v'+r.id}><td>{dateText(r.date)}</td><td>{r.voucher_no||'—'}</td><td>{r.expense_type_name||r.expense_type||'—'}</td><td>{r.pay_to_name||'—'}</td><td>{r.dealer_name||'—'}</td><td>{money(r.amount)}</td><td>{r.status||'—'}</td><td>{r.payment_status||'—'}</td></tr>)}
        {!voucherRows.length&&<tr><td colSpan="8" className="muted">No expense vouchers found.</td></tr>}
      </tbody></Table>
      <h3 style={{marginTop:22}}>Showroom / Shop Expenses</h3>
      <Table><thead><tr><th>Date</th><th>Expense No.</th><th>Dealer / Branch</th><th>Category</th><th>Paid To</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>
        {shopRows.map(r=><tr key={'s'+r.id}><td>{dateText(r.date||r.expense_date)}</td><td>{r.expense_no||'—'}</td><td>{r.dealer_name||'—'}</td><td>{r.category_label||r.category||'—'}</td><td>{r.paid_to||'—'}</td><td>{money(r.amount)}</td><td>{r.remarks||'—'}</td></tr>)}
        {!shopRows.length&&<tr><td colSpan="7" className="muted">No shop expenses found.</td></tr>}
      </tbody></Table>
    </>}
  </div></div>;
}

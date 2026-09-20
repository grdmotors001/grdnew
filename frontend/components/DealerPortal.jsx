'use client';
import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { useDarkMode } from '../lib/theme';
import { formatDate } from '../lib/date';
import { DealerCashBook } from './DealerCashBook';
import { DealerNewLoanForm } from './DealerNewLoanForm';
import { DealerPaymentPage } from './DealerPaymentPage';
import { DealerCustomerInvoicePage } from './DealerCustomerInvoicePage';
import { DealerLedgerPage } from './DealerLedgerPage';
import { DealerPendingSalesPage } from './DealerPendingSalesPage';

const nav = [
  ['dashboard', '⌂', 'Dashboard'],
  ['stock', '▣', 'My Stock'],
  ['old-stock', '▥', 'Old Rickshaw Stock'],
  ['battery-stock', '🔋', 'Battery Stock'],
  ['challans', '▤', 'Delivery Challans'],
  ['invoices', '▥', 'Tax Invoices'],
  ['cashbook', '₹', 'Cash Book'],
  ['payments', '↔', 'Online Payment'],
  ['ledger', '▤', 'Ledger'],
  ['pending-sales', '▤', 'Pending Sales'],
  ['loan-status', '✓', 'Loan Status'],
];

export function DealerPortal({ dealer, onLogout }) {
  const [stock, setStock] = useState(null);
  const [oldStock, setOldStock] = useState(null);
  const [batteryStock, setBatteryStock] = useState(null);
  const [challans, setChallans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loans, setLoans] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, toggleDark] = useDarkMode();
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const canPurchase = dealer.purchase_access === true;
  const canCashBook = (dealer.dealer_category || 'dealer').toLowerCase() === 'showroom';

  useEffect(() => {
    Promise.all([get('/dealer/stock'), get('/dealer/old-rickshaws'), get('/dealer/battery-stock'), get('/dealer/delivery-challans'), get('/dealer/tax-invoices'), get('/dealer/loan-status')])
      .then(([s, o, b, c, i, l]) => { setStock(s); setOldStock(o); setBatteryStock(b); setChallans(c.challans || []); setInvoices(i.invoices || []); setLoans(l.applications || []); })
      .catch((e) => setError(e.message));
  }, []);

  const q = search.trim().toLowerCase();
  const filteredStock = (stock?.vehicles || []).filter(v => [v.date,v.chassis_no,v.model_name,v.motor_no,v.colour].join(' ').toLowerCase().includes(q));
  const filteredOldStock = (oldStock?.rickshaws || []).filter(v => [v.sale_date,v.vehicle_reg_no,v.model_name,v.owner_name,v.sp_no].join(' ').toLowerCase().includes(q));
  const filteredBatteryStock = (batteryStock?.batteries || []).filter(v => [v.date,v.battery_maker,v.battery_no,v.reference_no].join(' ').toLowerCase().includes(q));
  const filteredChallans = challans.filter(v => [v.date,v.challan_no,v.chassis_no,v.product_name,v.destination].join(' ').toLowerCase().includes(q));
  const filteredInvoices = invoices.filter(v => [v.date,v.bill_no,v.chassis_no,v.product_name,v.buyer_name].join(' ').toLowerCase().includes(q));

  const latest = useMemo(() => [
    ...challans.map(x => ({type:'Delivery Challan',no:x.challan_no,date:x.date,text:x.chassis_no||x.product_name})),
    ...invoices.map(x => ({type:'Tax Invoice',no:x.bill_no,date:x.date,text:x.chassis_no||x.product_name}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,5), [challans,invoices]);

  const dealerName = dealer.name || dealer.full_name || 'Dealer';
  const dealerCode = dealer.code || dealer.login_id || dealer.dealer_code || '';

  if (tab === 'newloan') return <DealerNewLoanForm onBack={() => setTab('dashboard')} />;
  if (tab === 'customer-invoice' && canPurchase) return <DealerCustomerInvoicePage challan={selectedPurchase} dealer={dealer} onBack={() => setTab('purchases')} />;

  return <div className="dealerShell">
    <aside className="dealerSidebar">
      <div className="dealerBrand"><div className="dealerBrandMark">G</div><div><strong>G.R.D. MOTORS</strong><span>Dealer Portal</span></div></div>
      <div className="dealerProfileMini"><div className="dealerAvatar">{dealerName.slice(0,1).toUpperCase()}</div><div><strong>{dealerName}</strong><span>{dealerCode}</span></div></div>
      <nav className="dealerSideNav">{nav.filter(([key]) => (key !== 'purchases' || canPurchase) && (key !== 'cashbook' || canCashBook)).map(([key,icon,label]) =>
        <button key={key} className={'dealerNavItem'+(tab===key?' active':'')} onClick={()=>setTab(key)}><span className="dealerNavIcon">{icon}</span><span>{label}</span></button>
      )}</nav>
      <button className="dealerLogout" onClick={onLogout}><span>↪</span> Log Out</button>
    </aside>

    <main className="dealerMain">
      <header className="dealerTopbar">
        <button className="dealerMobileMenu" onClick={()=>setMobileNav(v=>!v)}>☰</button>
        <div><div className="dealerEyebrow">DEALER PANEL</div><h1>{tab==='dashboard'?'Dashboard':nav.find(x=>x[0]===tab)?.[2]||'Dealer Panel'}</h1></div>
        <div className="dealerTopActions"><div className="dealerWelcome">Welcome, <b>{dealerName}</b></div><button className="dealerThemeToggle" onClick={toggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀' : '☾'}</button><button className="btn dealerLogoutTop" onClick={onLogout}>Log Out</button></div>
      </header>

      {mobileNav && <div className="dealerMobileNav">{nav.filter(([key]) => key !== 'purchases' || canPurchase).map(([key,icon,label])=><button key={key} className={'dealerNavItem'+(tab===key?' active':'')} onClick={()=>{setTab(key);setMobileNav(false)}}><span className="dealerNavIcon">{icon}</span>{label}</button>)}</div>}
      {error && <div className="error dealerError">{error}</div>}

      <nav className="dealerBottomNav dealerBottomNavForce" aria-label="Dealer bottom navigation">
        {nav.filter(x=>['dashboard','stock','purchases','payments','ledger'].includes(x[0]) && (x[0] !== 'purchases' || canPurchase) && (x[0] !== 'cashbook' || canCashBook)).map(([key,icon,label])=>
          <button type="button" key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setMobileNav(false)}}>
            <span>{icon}</span><small>{label}</small>
          </button>
        )}
      </nav>
      {tab==='dashboard' && <DealerDashboard dealerName={dealerName} stockCount={stock?.count} challanCount={challans.length} invoiceCount={invoices.length} latest={latest} onNewLoan={()=>setTab('newloan')} onOpen={setTab}/>}
      {tab!=='dashboard' && <>
        <div className="dealerContentToolbar">
          <div className="dealerPageIntro"><span className="dealerSectionIcon">{nav.find(x=>x[0]===tab)?.[1]}</span><div><strong>{nav.find(x=>x[0]===tab)?.[2]}</strong><small>Dealer-wise records</small></div></div>
          {tab!=='cashbook' && <input className="input dealerSearch" placeholder="Search chassis, bill, challan, model…" value={search} onChange={e=>setSearch(e.target.value)}/>}
        </div>
        {tab==='cashbook' && canCashBook && <DealerCashBook/>}
        {tab==='purchases' && canPurchase && <DealerPurchases onInvoice={(x)=>{setSelectedPurchase(x);setTab('customer-invoice')}}/>}
        {tab==='payments' && <DealerPaymentPage dealer={dealer}/>}
        {tab==='ledger' && <DealerLedgerPage/>}
        {tab==='pending-sales' && <DealerPendingSalesPage/>}
        {tab==='stock' && <DealerTable headers={['Date','Chassis No.','Model','Motor No.','Colour']} rows={filteredStock} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Motor No.">{v.motor_no}</td><td data-label="Colour">{v.colour}</td></>}/>}
        {tab==='old-stock' && <DealerTable headers={['Sale Date','Record No.','Reg. No.','Model','Owner','Sale Amount','Loan','Down Payment','SP No.']} rows={filteredOldStock} row={v=><><td data-label="Sale Date">{formatDate(v.sale_date)}</td><td data-label="Record No.">{v.record_no}</td><td data-label="Reg. No."><b>{v.vehicle_reg_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Owner">{v.owner_name||'—'}</td><td data-label="Sale Amount">{v.sale_amount}</td><td data-label="Loan">{v.loan_amount}</td><td data-label="Down Payment">{v.down_payment}</td><td data-label="SP No.">{v.sp_no||'—'}</td></>}/>}
        {tab==='battery-stock' && <DealerTable headers={['Date','Battery Maker','Battery No.','Reference']} rows={filteredBatteryStock} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Battery Maker">{v.battery_maker||'—'}</td><td data-label="Battery No."><b>{v.battery_no}</b></td><td data-label="Reference">{v.reference_no||'—'}</td></>}/>}
        {tab==='challans' && <DealerTable headers={['Date','Challan No.','Chassis No.','Model','Destination']} rows={filteredChallans} row={c=><><td data-label="Date">{formatDate(c.date)}</td><td data-label="Challan No.">{c.challan_no}</td><td data-label="Chassis No.">{c.chassis_no}</td><td data-label="Model">{c.product_name}</td><td data-label="Destination">{c.destination}</td></>}/>}
        {tab==='invoices' && <DealerTable headers={['Date','Bill No.','Chassis No.','Model','Buyer','Total']} rows={filteredInvoices} row={i=><><td data-label="Date">{formatDate(i.date)}</td><td data-label="Bill No.">{i.bill_no}</td><td data-label="Chassis No.">{i.chassis_no}</td><td data-label="Model">{i.product_name}</td><td data-label="Buyer">{i.buyer_name}</td><td data-label="Total">{i.bill_total}</td></>}/>}
        {tab==='loan-status' && <DealerLoanStatusTable rows={loans}/>}
      </>}
    </main>
  </div>;
}

function DealerDashboard({dealerName,stockCount,challanCount,invoiceCount,loanCount,latest,onNewLoan,onOpen}) {
  const cards=[
    ['Current Stock',stockCount??'—','Vehicles currently assigned','stock','▣'],
    ['Loan Applications',loanCount??0,'CHFPL loan status','loan-status','✓'],
    ['Delivery Challans',challanCount,'Recent challan records','challans','▤'],
    ['Tax Invoices',invoiceCount,'Invoice records','invoices','▥'],
  ];
  return <div className="dealerDashboard">
    <section className="dealerHero"><div><span className="dealerHeroKicker">G.R.D. MOTORS</span><h2>Welcome back, {dealerName}</h2><p>Manage stock, documents, cash book and loan applications from one place.</p></div><button className="dealerPrimaryAction" onClick={onNewLoan}><span>＋</span> New Loan Application</button></section>
    <section className="dealerKpis">{cards.map(([label,value,sub,key,icon])=><button className="dealerKpi" key={key} onClick={()=>onOpen(key)}><div className="dealerKpiIcon">{icon}</div><div className="dealerKpiText"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div><i>→</i></button>)}</section>
    <section className="dealerDashboardGrid">
      <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>Quick Actions</h3><p>Common dealer work</p></div></div>
        <div className="dealerQuickGrid">
          <button onClick={onNewLoan}><span className="quickIcon">＋</span><b>New Loan</b><small>Create customer & loan</small></button>
          <button onClick={()=>onOpen('stock')}><span className="quickIcon">▣</span><b>View Stock</b><small>Check available vehicles</small></button>
          <button onClick={()=>onOpen('challans')}><span className="quickIcon">▤</span><b>Delivery Challans</b><small>View challan history</small></button>
          <button onClick={()=>onOpen('cashbook')}><span className="quickIcon">₹</span><b>Cash Book</b><small>Receipts & handover</small></button>
        </div>
      </div>
      <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>Recent Activity</h3><p>Latest document records</p></div></div>
        {latest.length?<div className="dealerActivity">{latest.map((x,i)=><div className="dealerActivityRow" key={x.type+x.no+i}><span className="activityDot"></span><div><b>{x.type}</b><small>{x.no||'—'} · {x.text||'—'}</small></div><time>{formatDate(x.date)}</time></div>)}</div>:<div className="dealerEmpty">No recent records available.</div>}
      </div>
    </section>
  </div>;
}

function DealerTable({headers,rows,row}) {
  return <div className="tablewrap dealerTable"><table className="table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((item,i)=><tr key={item.id??i}>{row(item)}</tr>)}{!rows.length&&<tr><td colSpan={headers.length}><div className="dealerEmpty">No records found.</div></td></tr>}</tbody></table></div>;
}

function DealerPurchases({onInvoice}) {
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{get('/dealer/purchases').then(d=>setRows(d.purchases||[])).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
  return <div><div className="dealerContentToolbar"><div className="dealerPageIntro"><span className="dealerSectionIcon">▣</span><div><strong>Purchases</strong><small>Delivery Challans received from G.R.D. Motors</small></div></div></div>{error&&<div className="error">{error}</div>}{loading?<div className="dealerEmpty">Loading…</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Challan</th><th>Chassis</th><th>Model</th><th>Purchase Value</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{formatDate(x.date)}</td><td>{x.challan_no}</td><td>{x.chassis_no}</td><td>{x.product_name}</td><td>{x.sale_value||0}</td></tr>)}{!rows.length&&<tr><td colSpan="5">No purchases available.</td></tr>}</tbody></table></div>}</div>
}


function DealerLoanStatusTable({rows}) {
  const statusLabel = (s) => String(s || 'submitted').replace(/_/g,' ').replace(/\b\w/g, m => m.toUpperCase());
  const statusClass = (s) => {
    const v=String(s||'').toLowerCase();
    if(v==='approved'||v==='sanctioned'||v==='disbursed') return 'loanStatus approved';
    if(v==='rejected') return 'loanStatus rejected';
    if(v==='fi_pending'||v==='fi_done') return 'loanStatus review';
    return 'loanStatus submitted';
  };
  return <div>
    <div className="dealerPanel" style={{marginBottom:14}}>
      <div className="dealerPanelHead"><div><h3>My Loan Applications</h3><p>Live status from CHFPL</p></div></div>
      {!rows.length ? <div className="dealerEmpty">No loan applications found.</div> :
      <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Application</th><th>Customer</th><th>Vehicle</th><th>Loan Amount</th><th>Status</th><th>Submitted</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id||r.application_no}>
        <td data-label="Application"><b>{r.application_no}</b></td>
        <td data-label="Customer">{r.customer_name||'—'}</td>
        <td data-label="Vehicle">{r.vehicle_model_name||'—'}</td>
        <td data-label="Loan Amount">₹ {Number(r.loan_amount_requested||0).toLocaleString('en-IN')}</td>
        <td data-label="Status"><span className={statusClass(r.status)}>{statusLabel(r.status)}</span></td>
        <td data-label="Submitted">{r.submitted_at ? formatDate(r.submitted_at) : '—'}</td>
      </tr>)}</tbody></table></div>}
    </div>
  </div>;
}

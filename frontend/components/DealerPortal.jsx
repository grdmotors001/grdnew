'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { useDarkMode } from '../lib/theme';
import { formatDate } from '../lib/date';
import { DealerCashBook } from './DealerCashBook';
import { DealerDelivery } from './DealerDelivery';
import { DealerNewLoanForm } from './DealerNewLoanForm';
import { DealerPaymentPage } from './DealerPaymentPage';
import { DealerCashReceiptPage } from './DealerCashReceiptPage';
import { CashAtDealerPage } from './CashAtDealerPage';
import { ExpensePaymentVoucherPage } from './ExpensePaymentVoucherPage';
import { DealerCustomerInvoicePage } from './DealerCustomerInvoicePage';
import { DealerLedgerPage } from './DealerLedgerPage';
import { DealerPendingSalesPage } from './DealerPendingSalesPage';

const dealerHeaderSections = [
  {label:'Stock', items:[['stock','New Stock'],['old-stock','Old Stock'],['battery-stock','Battery Stock']]},
  {label:'Record', items:[['challans','Delivery Challan'],['invoices','Tax Invoice'],['seized-vehicles','Seized Vehicle']]},
  {label:'Report', items:[['all-customers','All Customers'],['all-receipt','All Receipt'],['expenses-reports','Expenses Reports'],['all-expenses','All Expenses'],['incentive','Incentive Record']]},
  {label:'Daybook', items:[['cashbook','Cashbook'],['receipt-create','Receipt Create'],['expenses-create','Expenses Create'],['cash-handover','Cash Handover'],['payments','Online Payment']]},
  {label:'Pending Sales', items:[['old-rickshaw-sales','Old Rickshaw Sale'],['ledger','Ledger']]},
  {label:'Battery Adjustment', items:[['battery-swap','Battery Exchange'],['battery-withdrawal','Battery Withdrawal'],['battery-addition','Battery Fitting']]},
];

const dealerHeaderSectionByTab = {
  stock:'Stock','old-stock':'Stock','battery-stock':'Stock',
  challans:'Record',invoices:'Record','seized-vehicles':'Record',
  'all-customers':'Report','all-receipt':'Report','expenses-reports':'Report','all-expenses':'Report',incentive:'Report',
  cashbook:'Daybook','receipt-create':'Daybook','expenses-create':'Daybook','cash-handover':'Daybook',payments:'Daybook',
  'pending-sales':'Pending Sales','old-rickshaw-sales':'Pending Sales',ledger:'Pending Sales',
  'battery-swap':'Battery Adjustment','battery-withdrawal':'Battery Adjustment','battery-addition':'Battery Adjustment'
};

const nav = [
  ['dashboard', '⌂', 'Dashboard'],
  ['stock', '▣', 'My Stock'],
  ['old-stock', '▥', 'Old Rickshaw Stock'],
  ['battery-stock', '🔋', 'Battery Stock'],
  ['challans', '▤', 'Delivery Challans'],
  ['invoices', '▥', 'Tax Invoices'],
  ['cashbook', '₹', 'Cash Book'],
  ['delivery', '✓', 'Delivery'],
  ['payments', '↔', 'Online Payment'],
  ['ledger', '▤', 'Ledger'],
  ['pending-sales', '▤', 'Pending Sales'],
  ['loan-status', '✓', 'Loan Status'],
  ['seized-vehicles', '⚠', 'Seized Vehicles'],
  ['battery-withdrawal', '↘', 'Battery Withdrawal'],
  ['battery-swap', '⇄', 'Battery Swap / Exchange'],
  ['battery-addition', '↗', 'Battery Fit to Rickshaw'],
  ['old-rickshaw-sales', '▥', 'Old Rickshaw Sale'],
  ['incentive', '₹', 'Incentive Record'],
];

export function DealerPortal({ dealer, onLogout }) {
  const [stock, setStock] = useState(null);
  const [oldStock, setOldStock] = useState(null);
  const [batteryStock, setBatteryStock] = useState(null);
  const [challans, setChallans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loans, setLoans] = useState([]);
  const [seizedVehicles, setSeizedVehicles] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, toggleDark] = useDarkMode();
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const canPurchase = dealer.purchase_access === true;
  const canCashBook = (dealer.dealer_category || 'dealer').toLowerCase() === 'showroom';
  const canDelivery = canCashBook;
  const portalModules = new Set(dealer.portal_modules || []);
  const canBatteryWithdrawal = portalModules.has('battery-withdrawal');
  const canBatterySwap = portalModules.has('battery-swap');
  const canBatteryAddition = portalModules.has('battery-addition');
  const canOldRickshawSales = portalModules.has('old-rickshaw-sales');
  const activeHeaderSection = dealerHeaderSectionByTab[tab] || null;

  useEffect(() => {
    Promise.all([get('/dealer/stock'), get('/dealer/old-rickshaws'), get('/dealer/battery-stock'), get('/dealer/delivery-challans'), get('/dealer/tax-invoices')])
      .then(([s, o, b, c, i]) => { setStock(s); setOldStock(o); setBatteryStock(b); setChallans(c.challans || []); setInvoices(i.invoices || []); })
      .catch((e) => setError(e.message));
    get('/dealer/loan-status')
      .then((l) => setLoans(l.applications || []))
      .catch(() => setLoans([]));
    get('/dealer/seized-vehicles')
      .then((r) => setSeizedVehicles(r.vehicles || []))
      .catch(() => setSeizedVehicles([]));
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

  const standaloneForm =
    tab === 'newloan' ? <DealerNewLoanForm onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-withdrawal' && canBatteryWithdrawal) ? <DealerBatteryWithdrawal dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-swap' && canBatterySwap) ? <DealerBatterySwap dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-addition' && canBatteryAddition) ? <DealerBatteryAddition dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'old-rickshaw-sales' && canOldRickshawSales) ? <DealerOldRickshawSales dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'customer-invoice' && canPurchase) ? <DealerCustomerInvoicePage challan={selectedPurchase} dealer={dealer} onBack={() => setTab('purchases')} /> :
    (tab === 'delivery' && canDelivery) ? <DealerDelivery onBack={() => setTab('dashboard')} /> : null;

  return <div className="dealerShell">
    <style>{`
      .grdFormPage{padding:12px}
      .grdFormPage .dealerPanel{max-width:980px;background:#fff;border:1px solid #e4e9ef;border-radius:14px;box-shadow:0 5px 18px rgba(31,55,79,.06);padding:16px}
      .grdFormPage .dealerPanelHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
      .grdFormPage .dealerPanelHead h3{margin:0;font-size:18px;color:#172b45}
      .grdFormPage .dealerPanelHead p{margin:3px 0 0;color:#748297;font-size:11px}
      .grdFormPage .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .grdFormPage .grid>div{min-width:0}
      .grdFormPage label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:700;color:#65758a}
      .grdFormPage .input{width:100%;min-height:40px;border:1px solid #d7e0e9;border-radius:8px;background:#fff;box-sizing:border-box;padding:9px 11px;font-size:12px;color:#24384d}
      .grdFormPage .input:focus{outline:none;border-color:#2d79df;box-shadow:0 0 0 2px rgba(45,121,223,.10)}
      .grdFormPage .card{border:1px solid #e2e8ef;border-radius:10px;background:#fbfdff}
      .grdFormPage .btn{border:1px solid #d8e0e8;border-radius:8px;background:#fff;color:#33475b;padding:8px 13px;font-size:11px;font-weight:700;cursor:pointer}
      .grdFormPage .btn.primary{border-color:#246fe8;background:#246fe8;color:#fff}
      .grdFormPage .error{border:1px solid #f3cccc;background:#fff3f3;color:#a52b2b;border-radius:8px;padding:8px 10px;font-size:11px;margin-bottom:12px}
      .grdFormPage .actions{display:flex;gap:8px;margin-top:14px}
      @media(max-width:700px){.grdFormPage{padding:0}.grdFormPage .dealerPanel{border-radius:0 0 12px 12px;padding:13px}.grdFormPage .grid{grid-template-columns:1fr;gap:11px}.grdFormPage .dealerPanelHead h3{font-size:15px}.grdFormPage .input{min-height:38px;font-size:11px}}
      .dealerPortalHeaderNav{display:flex;gap:8px;align-items:stretch;overflow-x:auto;border-bottom:1px solid #e3e8f0;background:#fff;padding:7px 0 8px;scrollbar-width:none;min-height:50px}
      .dealerPortalHeaderNav::-webkit-scrollbar{display:none}
      .dealerPortalHeaderGroup{display:flex;flex-direction:column;gap:3px;flex:0 0 auto;padding:0 8px}
      .dealerPortalHeaderLabel{font-size:9px;font-weight:900;letter-spacing:.55px;text-transform:uppercase;color:#6b7b8f;padding:0 5px}
      .dealerPortalHeaderItems{display:flex;gap:5px}
      .dealerPortalHeaderItem{border:1px solid #e2e8ef;background:#f8fafc;color:#30445b;border-radius:7px;padding:6px 10px;font-size:10px;font-weight:700;white-space:nowrap;cursor:pointer}
      .dealerPortalHeaderItem:hover,.dealerPortalHeaderItem.active{background:#eaf2ff;border-color:#9fc2fa;color:#155dcc}
      .dealerTopbar{position:sticky;top:0;z-index:20;background:#fff}
      .dealerBatteryCard{margin-top:6px}
      .dealerBatteryFormGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px;align-items:end}
      .dealerBatteryFormGrid label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#30445b}
      .dealerBatteryFormGrid input,.dealerBatteryFormGrid select{width:100%;min-height:42px;box-sizing:border-box}
      .dealerBatteryFormActions{display:flex;justify-content:flex-start;margin-top:16px}
      @media(max-width:900px){.dealerBatteryFormGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.dealerBatteryFormGrid{grid-template-columns:1fr}}
      @media(max-width:700px){.dealerPortalHeaderNav{margin:0 -10px;padding-left:10px;padding-right:10px}.dealerPortalHeaderItem{font-size:9px;padding:6px 8px}.dealerPortalHeaderLabel{font-size:8px}}
    `}</style>
    <aside className="dealerSidebar">
      <div className="dealerBrand"><div className="dealerBrandMark">G</div><div><strong>G.R.D. MOTORS</strong><span>Dealer Portal</span></div></div>
      <div className="dealerProfileMini"><div className="dealerAvatar">{dealerName.slice(0,1).toUpperCase()}</div><div><strong>{dealerName}</strong><span>{dealerCode}</span></div></div>
      <nav className="dealerSideNav">{nav.filter(([key]) => (key !== 'purchases' || canPurchase) && (key !== 'cashbook' || canCashBook) && (key !== 'delivery' || canDelivery) && (key !== 'battery-withdrawal' || canBatteryWithdrawal) && (key !== 'battery-swap' || canBatterySwap) && (key !== 'battery-addition' || canBatteryAddition) && (key !== 'old-rickshaw-sales' || canOldRickshawSales)).map(([key,icon,label]) =>
        <button key={key} className={'dealerNavItem'+(tab===key?' active':'')} onClick={()=>setTab(key)}><span className="dealerNavIcon">{icon}</span><span>{label}</span></button>
      )}</nav>
      <button className="dealerLogout" onClick={onLogout}><span>↪</span> Log Out</button>
    </aside>

    <main className="dealerMain">
      <header className="dealerTopbar">
        <button className="dealerMobileMenu" onClick={()=>setMobileNav(v=>!v)}>☰</button>
        <div><div className="dealerEyebrow">DEALER PANEL</div><h1>{tab==='dashboard'?'Dashboard':nav.find(x=>x[0]===tab)?.[2]||'Dealer Panel'}</h1></div>
        <div className="dealerTopActions"><button className="dealerThemeToggle" onClick={toggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀' : '☾'}</button><button className="btn dealerLogoutTop" onClick={onLogout}>Log Out</button></div>
      </header>
      {activeHeaderSection && <nav className="dealerPortalHeaderNav" aria-label="Dealer module submenu">
        {(() => {
          const section = dealerHeaderSections.find(s => s.label === activeHeaderSection);
          if (!section) return null;
          return <div className="dealerPortalHeaderGroup">
            <div className="dealerPortalHeaderLabel">{section.label}</div>
            <div className="dealerPortalHeaderItems">
              {section.items
                .filter(([key]) =>
                  (key !== 'incentive' || canCashBook) &&
                  (key !== 'cashbook' && key !== 'receipt-create' && key !== 'cash-handover' && key !== 'expenses-create' || canCashBook) &&
                  (key !== 'battery-withdrawal' || canBatteryWithdrawal) &&
                  (key !== 'battery-swap' || canBatterySwap) &&
                  (key !== 'battery-addition' || canBatteryAddition) &&
                  (key !== 'old-rickshaw-sales' || canOldRickshawSales)
                )
                .map(([key,label]) => (
                  <button type="button" key={key}
                    className={'dealerPortalHeaderItem'+(tab===key?' active':'')}
                    onClick={()=>setTab(key)}>
                    {label}
                  </button>
                ))}
            </div>
          </div>;
        })()}
      </nav>}

      {mobileNav && <div className="dealerMobileNav">{nav.filter(([key]) => (key !== 'purchases' || canPurchase) && (key !== 'cashbook' || canCashBook) && (key !== 'delivery' || canDelivery) && (key !== 'battery-withdrawal' || canBatteryWithdrawal) && (key !== 'battery-swap' || canBatterySwap) && (key !== 'battery-addition' || canBatteryAddition) && (key !== 'old-rickshaw-sales' || canOldRickshawSales)).map(([key,icon,label])=><button key={key} className={'dealerNavItem'+(tab===key?' active':'')} onClick={()=>{setTab(key);setMobileNav(false)}}><span className="dealerNavIcon">{icon}</span>{label}</button>)}</div>}
      {error && <div className="error dealerError">{error}</div>}

      <nav className="dealerBottomNav dealerBottomNavForce" aria-label="Dealer bottom navigation">
        {nav.filter(x=>['dashboard','stock','purchases','payments','ledger'].includes(x[0]) && (x[0] !== 'purchases' || canPurchase) && (x[0] !== 'cashbook' || canCashBook)).map(([key,icon,label])=>
          <button type="button" key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setMobileNav(false)}}>
            <span>{icon}</span><small>{label}</small>
          </button>
        )}
      </nav>
      {standaloneForm || <>
      {tab==='dashboard' && <DealerDashboard dealerName={dealerName} stockCount={stock?.count} challanCount={challans.length} invoiceCount={invoices.length} loanCount={loans.length} latest={latest} onNewLoan={()=>setTab('newloan')} onOpen={setTab}/>} 
      {tab!=='dashboard' && <>
        <div className="dealerContentToolbar">
          <div className="dealerPageIntro"><span className="dealerSectionIcon">{nav.find(x=>x[0]===tab)?.[1]}</span><div><strong>{nav.find(x=>x[0]===tab)?.[2]}</strong><small>Dealer-wise records</small></div></div>
          {tab!=='cashbook' && <input className="input dealerSearch" placeholder="Search chassis, bill, challan, model…" value={search} onChange={e=>setSearch(e.target.value)}/>}
        </div>
        {tab==='cashbook' && canCashBook && <DealerCashBook/>}
        {tab==='all-expenses' && canCashBook && <DealerAllExpenses/>}
        {tab==='incentive' && canCashBook && <DealerIncentiveRegister dealer={dealer}/>}
        {tab==='receipt-create' && canCashBook && <DealerCashReceiptPage dealer={dealer}/>}
        {tab==='cash-handover' && canCashBook && <CashAtDealerPage/>}
        {tab==='delivery' && canDelivery && <DealerDelivery onBack={() => setTab('dashboard')}/>}
        {tab==='purchases' && canPurchase && <DealerPurchases onInvoice={(x)=>{setSelectedPurchase(x);setTab('customer-invoice')}}/>}
        {tab==='payments' && <DealerPaymentPage dealer={dealer}/>}
        {tab==='ledger' && <DealerLedgerPage/>}
        {tab==='pending-sales' && <DealerPendingSalesPage/>}
        {tab==='stock' && <DealerTable headers={['Date','Chassis No.','Model','Motor No.','Colour']} rows={filteredStock} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Motor No.">{v.motor_no}</td><td data-label="Colour">{v.colour}</td></>}/>}
        {tab==='old-stock' && <DealerTable headers={['Sale Date','Record No.','Reg. No.','Model','Owner','Sale Amount','Loan','Down Payment','SP No.']} rows={filteredOldStock} row={v=><><td data-label="Sale Date">{formatDate(v.sale_date)}</td><td data-label="Record No.">{v.record_no}</td><td data-label="Reg. No."><b>{v.vehicle_reg_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Owner">{v.owner_name||'—'}</td><td data-label="Sale Amount">{v.sale_amount}</td><td data-label="Loan">{v.loan_amount}</td><td data-label="Down Payment">{v.down_payment}</td><td data-label="SP No.">{v.sp_no||'—'}</td></>}/>}
        {tab==='battery-stock' && <DealerTable headers={['Date','Battery Maker','Battery No.','Reference']} rows={filteredBatteryStock} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Battery Maker">{v.battery_maker||'—'}</td><td data-label="Battery No."><b>{v.battery_no}</b></td><td data-label="Reference">{v.reference_no||'—'}</td></>}/>}
        {tab==='challans' && <DealerTable headers={['Date','Challan No.','Chassis No.','Model','Destination']} rows={filteredChallans} row={c=><><td data-label="Date">{formatDate(c.date)}</td><td data-label="Challan No.">{c.challan_no}</td><td data-label="Chassis No.">{c.chassis_no}</td><td data-label="Model">{c.product_name}</td><td data-label="Destination">{c.destination}</td></>}/>}
        {tab==='invoices' && <DealerTable headers={['Date','Bill No.','Chassis No.','Model','Buyer','Total']} rows={filteredInvoices} row={i=><><td data-label="Date">{formatDate(i.date)}</td><td data-label="Bill No.">{i.bill_no}</td><td data-label="Chassis No.">{i.chassis_no}</td><td data-label="Model">{i.product_name}</td><td data-label="Buyer">{i.buyer_name}</td><td data-label="Total">{i.bill_total}</td></>}/>}
        {!['cashbook','receipt-create','cash-handover','delivery','purchases','payments','ledger','pending-sales','stock','old-stock','battery-stock','challans','invoices','loan-status','seized-vehicles'].includes(tab) && tab!=='dashboard' && <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>{dealerHeaderSections.flatMap(s=>s.items).find(x=>x[0]===tab)?.[1] || 'Dealer Module'}</h3><p>This module is available from the top header.</p></div></div><div className="dealerEmpty">Module screen ready — records will appear here.</div></div>}
        {tab==='loan-status' && <DealerLoanStatusTable rows={loans}/>}
        {tab==='seized-vehicles' && <div className="dealerPage"><div className="dealerPanel" style={{marginBottom:14}}><div className="dealerPanelHead"><div><h3>Seized Vehicles</h3><p>Vehicles physically parked at your dealer. CHFPL will release them for sale when applicable.</p></div><span className="pill d">HOLD</span></div>{!seizedVehicles.length?<div className="dealerEmpty">No seized vehicles are currently parked at this dealer.</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Repo Date</th><th>Loan</th><th>Vehicle</th><th>Model</th><th>Colour</th><th>Battery</th><th>RC</th><th>Charger</th><th>Status</th></tr></thead><tbody>{seizedVehicles.map(v=>{const loan=v.loan_applications||{};const customer=loan.customer_profiles||{};return <tr key={v.id}><td>{formatDate(v.repo_date)}</td><td><b>{loan.loan_account_no||loan.application_no||'—'}</b><div className="muted">{customer.full_name||'—'}</div></td><td><b>{v.vehicle_no||'—'}</b></td><td>{v.model_name||loan.grd_model_name||'—'}</td><td>{v.colour||'—'}</td><td>{v.battery_available?v.battery_no||'Yes':'No'}</td><td>{v.rc_available?'Yes':'No'}</td><td>{v.charger_available?'Yes':'No'}</td><td><span className="pill d">HOLD</span></td></tr>})}</tbody></table></div>}</div></div>}
      </>}
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
    <section className="dealerHero"><div><span className="dealerHeroKicker">G.R.D. MOTORS</span><h2>Dealer Dashboard</h2><p>Manage stock, documents, cash book and loan applications from one place.</p></div><button className="dealerPrimaryAction" onClick={onNewLoan}><span>＋</span> New Loan Application</button></section>
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


function DealerBatteryWithdrawal({dealer,onBack}){
  const [type,setType]=useState('new'),[items,setItems]=useState([]),[rickshawId,setRickshawId]=useState(''),[battery,setBattery]=useState(''),[ref,setRef]=useState(''),[remarks,setRemarks]=useState(''),[error,setError]=useState('');
  const load=async()=>{try{const r=await get('/dealer/rickshaw-battery-options?dealer_id='+dealer.id+'&type='+type);setItems(r.rickshaws||[]);setRickshawId('');setBattery('')}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[type]);
  const current=items.find(x=>String(x.id)===String(rickshawId));
  const save=async e=>{e.preventDefault();try{await post('/battery-withdrawal',{date:new Date().toISOString().slice(0,10),dealer_id:dealer.id,rickshaw_type:type,rickshaw_id:Number(rickshawId),battery_no:battery,reference_no:ref,remarks});alert('Battery withdrawn successfully');await load();setRef('');setRemarks('')}catch(e){setError(e.message)}};
  return <div className="dealerPage grdFormPage"><div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>Battery Withdrawal</h3><p>Battery rickshaw se remove karke aapke dealer battery stock me jayegi.</p></div><button className="btn" type="button" onClick={onBack}>Back</button></div>
      {error&&<div className="error">{error}</div>}
      <form onSubmit={save}><div className="grid">
        <label>Rickshaw Type<select className="input" value={type} onChange={e=>setType(e.target.value)}><option value="new">New Rickshaw</option><option value="old">Old Rickshaw</option></select></label>
        <label>Rickshaw<select className="input" value={rickshawId} onChange={e=>setRickshawId(e.target.value)} required><option value="">Select…</option>{items.map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''}</option>)}</select></label>
        <label>Battery No.<select className="input" value={battery} onChange={e=>setBattery(e.target.value)} required><option value="">Select…</option>{(current?.battery_numbers||[]).map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Reference No.<input className="input" value={ref} onChange={e=>setRef(e.target.value)}/></label>
        <label>Remarks<input className="input" value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
      </div><div className="actions"><button className="btn primary">Withdraw Battery</button></div></form>
    </div></div>;
}

function DealerBatteryAddition({dealer,onBack}){
  const [type,setType]=useState('new'),[items,setItems]=useState([]),[batteries,setBatteries]=useState([]),[rickshawId,setRickshawId]=useState(''),[battery,setBattery]=useState(''),[error,setError]=useState('');
  const load=async()=>{try{const [r,b]=await Promise.all([get('/dealer/rickshaw-battery-options?dealer_id='+dealer.id+'&type='+type),get('/battery-addition?dealer_id='+dealer.id)]);setItems((r.rickshaws||[]).filter(x=>!(x.battery_numbers||[]).length));setBatteries(b.batteries||[]);setRickshawId('');setBattery('')}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[type]);
  const save=async e=>{e.preventDefault();try{await post('/battery-addition',{date:new Date().toISOString().slice(0,10),location:'dealer',dealer_id:dealer.id,rickshaw_type:type,rickshaw_id:Number(rickshawId),battery_no:battery});alert('Battery fitted successfully');await load()}catch(e){setError(e.message)}};
  return <div className="dealerPage"><div className="card"><div className="pageHeader"><div><h2>Battery Fit to Rickshaw</h2><p className="muted">Dealer stock ki available battery ko apne rickshaw me fit karein.</p></div><button className="btn" onClick={onBack}>← Back</button></div>{error&&<div className="error">{error}</div>}<form onSubmit={save}><div className="dealerBatteryFormGrid"><label>Rickshaw Type<select value={type} onChange={e=>setType(e.target.value)}><option value="new">New Rickshaw</option><option value="old">Old Rickshaw</option></select></label><label>Rickshaw<select value={rickshawId} onChange={e=>setRickshawId(e.target.value)} required><option value="">Select…</option>{items.map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''}</option>)}</select></label><label>Battery No.<select value={battery} onChange={e=>setBattery(e.target.value)} required><option value="">Select…</option>{batteries.map(x=><option key={x.id} value={x.battery_no}>{x.battery_maker||''} — {x.battery_no}</option>)}</select></label></div><button className="btn primary">Fit Battery to Rickshaw</button></form></div></div>;
}

function DealerBatterySwap({dealer,onBack}){
  const [type,setType]=useState('new'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[items,setItems]=useState({new:[],old:[]}),[error,setError]=useState('');
  const load=async()=>{try{const [n,o]=await Promise.all([get('/dealer/rickshaw-battery-options?dealer_id='+dealer.id+'&type=new'),get('/dealer/rickshaw-battery-options?dealer_id='+dealer.id+'&type=old')]);setItems({new:n.rickshaws||[],old:o.rickshaws||[]})}catch(e){setError(e.message)}};
  useEffect(()=>{load()},[]);
  const opts=items[type]||[];
  const save=async e=>{e.preventDefault();try{await post('/battery-swap-vouchers',{date:new Date().toISOString().slice(0,10),dealer_id:dealer.id,from_type:type,from_id:Number(from),to_type:type,to_id:Number(to),remarks:''});alert('Battery swap saved');await load();setFrom('');setTo('')}catch(e){setError(e.message)}};
  return <div className="dealerPage dealerBatteryFormPage"></style><div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>Battery Swap / Exchange</h3><p>Dealer ke apne rickshaws ke beech battery swap.</p></div><button className="btn" type="button" onClick={onBack}>Back</button></div>
      {error&&<div className="error">{error}</div>}
      <form onSubmit={save}><div className="grid">
        <label>Rickshaw Type<select className="input" value={type} onChange={e=>{setType(e.target.value);setFrom('');setTo('')}}><option value="new">New Rickshaw</option><option value="old">Old Rickshaw</option></select></label>
        <label>From Rickshaw<select className="input" value={from} onChange={e=>setFrom(e.target.value)} required><option value="">Select…</option>{opts.map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''} — {(x.battery_numbers||[]).join(', ')||'No Battery'}</option>)}</select></label>
        <label>To Rickshaw<select className="input" value={to} onChange={e=>setTo(e.target.value)} required><option value="">Select…</option>{opts.filter(x=>String(x.id)!==String(from)).map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''} — {(x.battery_numbers||[]).join(', ')||'No Battery'}</option>)}</select></label>
      </div><div className="actions"><button className="btn primary">Save Battery Swap</button></div></form>
    </div></div>;
}


function DealerOldRickshawSales({dealer,onBack}){
 const [rows,setRows]=useState([]),[edit,setEdit]=useState(null),[form,setForm]=useState({}),[error,setError]=useState('');
 const load=async()=>{try{const r=await get('/dealer/old-rickshaw-challans');setRows(r.challans||[])}catch(e){setError(e.message)}}; useEffect(()=>{load()},[]);
 const open=r=>{setEdit(r);setForm({sale_amount:r.sale_amount||'',file_charge:r.file_charge||'',loan_amount:r.loan_amount||'',down_payment:r.down_payment||'',sale_customer:r.sale_customer||'',sale_mobile:r.sale_mobile||'',sold_at:new Date().toISOString().slice(0,10)})};
 const save=async()=>{try{await post('/billing/old-rickshaw-challans/'+edit.id+'/sale',form);setEdit(null);load()}catch(e){setError(e.message)}};
 return <div className="dealerPage"><div className="card"><div className="pageHeader"><div><h2>Old Rickshaw Sale</h2><p className="muted">Aapke naam ke Factory Old Rickshaw Challans.</p></div><button className="btn" onClick={onBack}>← Back</button></div>{error&&<div className="error">{error}</div>}<div className="tablewrap"><table className="table"><thead><tr><th>Challan</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Status</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.challan_no}</td><td>{r.model_name}</td><td>{r.vehicle_no}</td><td>{r.colour||'—'}</td><td>{r.status}</td><td><button className="btn primary" onClick={()=>open(r)}>Enter Sale Data</button></td></tr>)}{!rows.length&&<tr><td colSpan="6">No pending Old Rickshaw challans.</td></tr>}</tbody></table></div></div>{edit&&<div className="modal"><div className="modalbox"><h2>Sale Data — {edit.challan_no}</h2><div className="formgrid"><label>Sale Amount<input type="number" value={form.sale_amount} onChange={e=>setForm({...form,sale_amount:e.target.value})} /></label><label>File Charge<input type="number" value={form.file_charge} onChange={e=>setForm({...form,file_charge:e.target.value})} /></label><label>Loan Amount<input type="number" value={form.loan_amount} onChange={e=>setForm({...form,loan_amount:e.target.value})} /></label><label>Down Payment<input type="number" value={form.down_payment} onChange={e=>setForm({...form,down_payment:e.target.value})} /></label><label>Customer Name<input value={form.sale_customer} onChange={e=>setForm({...form,sale_customer:e.target.value})} /></label><label>Mobile<input value={form.sale_mobile} onChange={e=>setForm({...form,sale_mobile:e.target.value})} /></label></div><div className="actions"><button className="btn" onClick={()=>setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div></div></div>}</div>
}

function DealerAllExpenses(){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[search,setSearch]=useState('');
  useEffect(()=>{get('/expense-payment-voucher').then(r=>setRows(r.vouchers||[])).catch(e=>setError(e.message||'Could not load expenses')).finally(()=>setLoading(false))},[]);
  const q=search.trim().toLowerCase();
  const filtered=rows.filter(r=>[r.date,r.voucher_no,r.expense_type_name,r.pay_to_name,r.chassis_no,r.work_model_name].join(' ').toLowerCase().includes(q));
  return <div className="dealerPage"><div className="dealerPanel"><div className="dealerPanelHead"><div><h3>All Expenses</h3><p>All expense / work payment vouchers</p></div><input className="input dealerSearch" placeholder="Search expense, voucher, customer/chassis…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {error&&<div className="error">{error}</div>}{loading?<div className="dealerEmpty">Loading…</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Voucher</th><th>Expense</th><th>Pay To</th><th>Chassis / Booking</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead><tbody>
      {filtered.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td><b>{r.voucher_no}</b></td><td>{r.expense_type_name}</td><td>{r.pay_to_name||'—'}</td><td>{r.chassis_no||'—'}</td><td>₹ {Number(r.amount||0).toLocaleString('en-IN')}</td><td>{r.status}</td><td>{r.payment_status}</td></tr>)}{!filtered.length&&<tr><td colSpan="8" className="muted">No expenses found.</td></tr>}</tbody></table></div>}
  </div></div>
}

function DealerIncentiveRegister({dealer}){
  const [data,setData]=useState({rows:[],summary:{}}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[status,setStatus]=useState('all'),[search,setSearch]=useState('');
  const load=async()=>{setLoading(true);try{const r=await get('/dealer/incentive-record');setData(r)}catch(e){setError(e.message||'Could not load incentive record')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const q=search.trim().toLowerCase();
  const rows=(data.rows||[]).filter(r=>status==='all'||r.status.toLowerCase().replace(' ','_')===status).filter(r=>[r.date,r.bill_no,r.model,r.chassis_no,r.customer,r.mobile_no,r.vehicle_no,r.voucher_no,r.status].join(' ').toLowerCase().includes(q));
  const s=data.summary||{};
  return <div className="dealerPage"><div className="dealerPanel">
    <div className="dealerPanelHead"><div><h3>Incentive Record</h3><p>Paid / Pending / Not Recorded incentive status</p></div><input className="input dealerSearch" placeholder="Search bill, customer, chassis…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="actions" style={{marginBottom:12,flexWrap:'wrap'}}>
      <button className={'btn '+(status==='all'?'primary':'')} onClick={()=>setStatus('all')}>All {s.total||0}</button>
      <button className={'btn '+(status==='paid'?'primary':'')} onClick={()=>setStatus('paid')}>Paid {s.paid||0}</button>
      <button className={'btn '+(status==='pending_payment'?'primary':'')} onClick={()=>setStatus('pending_payment')}>Pending {s.pending||0}</button>
      <button className={'btn '+(status==='not_recorded'?'primary':'')} onClick={()=>setStatus('not_recorded')}>Not Recorded {s.not_recorded||0}</button>
    </div>
    {error&&<div className="error">{error}</div>}
    {loading?<div className="dealerEmpty">Loading…</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Bill No.</th><th>Customer</th><th>Chassis</th><th>Model</th><th>Incentive</th><th>Voucher</th><th>Paid Date</th><th>Status</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.vehicle_id}><td>{formatDate(r.date)}</td><td><b>{r.bill_no||'—'}</b></td><td>{r.customer||'—'}<br/><span className="muted">{r.mobile_no||''}</span></td><td>{r.chassis_no||'—'}</td><td>{r.model||'—'}</td><td>₹ {Number(r.incentive_amount||0).toLocaleString('en-IN')}</td><td>{r.voucher_no||'—'}</td><td>{r.paid_date?formatDate(r.paid_date):'—'}</td><td><b>{r.status}</b></td></tr>)}
      {!rows.length&&<tr><td colSpan="9" className="muted">No incentive records found.</td></tr>}
    </tbody></table></div>}
  </div></div>
}

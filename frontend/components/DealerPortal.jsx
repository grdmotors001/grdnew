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
import { DealerAllReceiptsPage, DealerAllCustomersPage, DealerExpenseCreatePage, DealerHandoverCreatePage } from './DealerCashBookExtras';

const dealerHeaderSections = [
  {label:'Stock', items:[['stock','New Stock'],['old-stock','Old Rickshaw Stock'],['battery-stock','Battery Stock'],['seized-vehicles','Seized Vehicle']]},
  {label:'Report', items:[['challans','Delivery Challan'],['invoices','Tax Invoice'],['incentive','Incentive Record'],['expenses-reports','Expenses Reports']]},
  {label:'Bahikhata', items:[['cashbook','Cashbook'],['all-customers','All Customers'],['all-receipt','All Receipt'],['all-expenses','All Expenses'],['expenses-create','Expenses Create'],['handover-create','Record Handover'],['cash-handover','Cash Handover'],['payments','Online Payment']]},
  {label:'Pending Sales', items:[['old-rickshaw-sales','Old Rickshaw Sale'],['ledger','Ledger']]},
  {label:'Battery Adjustment', items:[['battery-stock','Battery Stock'],['battery-swap','Battery Exchange'],['battery-withdrawal','Battery Withdrawal'],['battery-addition','Battery Fitting']]},
];

const dealerHeaderSectionByTab = {
  stock:'Stock','battery-stock':'Stock','seized-vehicles':'Stock',
  challans:'Report',invoices:'Report',incentive:'Report','expenses-reports':'Report',
  cashbook:'Bahikhata','all-customers':'Bahikhata','all-receipt':'Bahikhata','all-expenses':'Bahikhata','expenses-create':'Bahikhata','handover-create':'Bahikhata','cash-handover':'Bahikhata',payments:'Bahikhata',
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
  ['cashbook', '₹', 'Bahikhata'],
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
  ['incentive', '₹', 'Incentive'],
  ['receipt-create', '🧾', 'Create Receipt'],
  ['create-sale', '＋', 'Create Sale'],
];

// Old Rickshaw Stock, Battery Stock and Seized Vehicles are no longer
// separate side-nav entries — they live as tabs inside "My Stock" (see
// dealerHeaderSections' Stock group below). Kept in `nav` above so page
// titles/icons still resolve by key; just hidden from the side/mobile menus.
// Battery Withdrawal, Battery Swap/Exchange and Battery Fit (addition) are
// likewise folded into a single "Battery Adjustment" side-nav entry (see
// BATTERY_ADJUSTMENT_KEYS + the sidebarEntries logic below); Battery Stock
// is also reachable from that same group's top sub-menu.
// Create Receipt used to live inside the Bahikhata sub-menu; it now lives
// only as a Dashboard quick action, so it's hidden from the side/mobile menus.
const SIDEBAR_HIDDEN_KEYS = new Set(['old-stock', 'battery-stock', 'seized-vehicles', 'battery-withdrawal', 'battery-swap', 'battery-addition', 'receipt-create']);
const BATTERY_ADJUSTMENT_KEYS = ['battery-withdrawal', 'battery-swap', 'battery-addition', 'battery-stock'];

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
  // Battery Withdrawal / Swap / Fit are grouped into one "Battery Adjustment"
  // side-nav entry. It shows up if the dealer has access to any of the three,
  // and lands on whichever of them is actually enabled for that dealer.
  const canBatteryAdjustment = canBatteryWithdrawal || canBatterySwap || canBatteryAddition;
  const defaultBatteryTab = canBatteryWithdrawal ? 'battery-withdrawal' : canBatterySwap ? 'battery-swap' : 'battery-addition';
  const sidebarEntries = nav.filter(([key]) => !SIDEBAR_HIDDEN_KEYS.has(key) && (key !== 'purchases' || canPurchase) && (key !== 'cashbook' || canCashBook) && (key !== 'delivery' || canDelivery) && (key !== 'old-rickshaw-sales' || canOldRickshawSales));
  if (canBatteryAdjustment) {
    const batteryEntry = ['battery-adjustment', '🔋', 'Battery Adjustment'];
    const insertAt = sidebarEntries.findIndex(([key]) => key === 'old-rickshaw-sales');
    if (insertAt === -1) sidebarEntries.push(batteryEntry); else sidebarEntries.splice(insertAt, 0, batteryEntry);
  }
  const isBatteryAdjustmentActive = BATTERY_ADJUSTMENT_KEYS.includes(tab);
  const goToSidebarTab = (key) => setTab(key === 'battery-adjustment' ? defaultBatteryTab : key);

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
    tab === 'create-sale' ? <DealerCreateSaleForm stock={stock} oldStock={oldStock} batteryStock={batteryStock} onBack={() => setTab('dashboard')} /> :
    tab === 'newloan' ? <DealerNewLoanForm onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-withdrawal' && canBatteryWithdrawal) ? <DealerBatteryWithdrawal dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-swap' && canBatterySwap) ? <DealerBatterySwap dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-addition' && canBatteryAddition) ? <DealerBatteryAddition dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'old-rickshaw-sales' && canOldRickshawSales) ? <DealerOldRickshawSales dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'customer-invoice' && canPurchase) ? <DealerCustomerInvoicePage challan={selectedPurchase} dealer={dealer} onBack={() => setTab('purchases')} /> :
    (tab === 'delivery' && canDelivery) ? <DealerDelivery onBack={() => setTab('dashboard')} /> : null;

  return <div className="dealerShell">
    <style>{`
      .dealerOldSalePage{padding:4px 0 80px}
      .dealerOldSaleHeader,.dealerOldStockHead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px;padding:4px 2px}
      .dealerOldSaleKicker,.dealerOldStockKicker{font-size:10px;font-weight:900;letter-spacing:1px;color:#2563eb;text-transform:uppercase}
      .dealerOldSaleHeader h2,.dealerOldStockHead h2{margin:2px 0 4px;font-size:24px;color:#172b45}
      .dealerOldSaleHeader p,.dealerOldStockHead p{margin:0;color:#748297;font-size:12px}
      .dealerOldSaleActions{display:flex;gap:8px;flex-wrap:wrap}
      .dealerOldSaleCard,.dealerOldStockCard{border:1px solid #e4e9ef;border-radius:14px;background:#fff;box-shadow:0 5px 18px rgba(31,55,79,.06);overflow:hidden}
      .dealerOldSaleSectionTitle{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #edf1f5}
      .dealerOldSaleSectionTitle strong{display:block;font-size:15px;color:#1f334a}.dealerOldSaleSectionTitle span{display:block;margin-top:3px;font-size:11px;color:#7b8898}
      .dealerOldSaleCount{min-width:30px!important;width:30px;height:30px;border-radius:50%;display:grid!important;place-items:center;background:#edf4ff;color:#2563eb!important;font-weight:800}
      .dealerOldSaleTableWrap,.dealerOldStockTableWrap{overflow-x:auto}.dealerOldSaleTable,.dealerOldStockTable{min-width:720px}
      .dealerOldSaleStatus{display:inline-flex!important;padding:5px 8px;border-radius:999px;background:#fff7df;color:#8a6500!important;font-size:10px!important;font-weight:800}.dealerOldSaleEnter{white-space:nowrap}
      .dealerOldSaleModal{z-index:99999;padding:16px;overflow:auto;align-items:center;isolation:isolate}.dealerOldSaleModalBox{width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;border-radius:18px;box-sizing:border-box;position:relative;z-index:1}
      .dealerOldSaleModalHead{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.dealerOldSaleModalHead h2{margin:2px 0 4px;font-size:22px}.dealerOldSaleModalHead p{margin:0;color:#748297;font-size:12px}
      .dealerOldSaleClose{border:1px solid #dbe2ea;background:#fff;border-radius:10px;width:38px;height:38px;font-size:24px;line-height:1;cursor:pointer;color:#516174}
      .dealerOldSaleSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px}.dealerOldSaleSummary>div{background:#f7faff;border:1px solid #e3ebf5;border-radius:10px;padding:10px 12px;min-width:0}.dealerOldSaleSummary span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#7b8a9c}.dealerOldSaleSummary b{display:block;margin-top:3px;font-size:12px;color:#21364d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dealerOldSaleFormGrid{gap:12px}.dealerOldSaleFormGrid .field label{font-size:11px;font-weight:700;color:#63748a}.dealerOldSaleFormGrid .input{min-height:44px;box-sizing:border-box}
      .dealerOldSaleModalFooter{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid #edf1f5}.dealerOldSaleSave,.dealerOldSaleCancel{min-width:110px}
      .dealerOldStockPage{padding:4px 0 80px}.dealerOldStockGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.dealerOldStockStat{background:#fff;border:1px solid #e4e9ef;border-radius:12px;padding:13px 15px;box-shadow:0 4px 14px rgba(31,55,79,.04)}.dealerOldStockStat span{display:block;color:#718096;font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:.4px}.dealerOldStockStat b{display:block;margin-top:3px;color:#1f334a;font-size:22px}
      .dealerOldStockStatus{display:inline-flex!important;padding:5px 8px;border-radius:999px;font-size:10px!important;font-weight:800}.dealerOldStockStatus.available{background:#eaf8ef;color:#19733a!important}.dealerOldStockStatus.sold{background:#edf1f5;color:#59697b!important}
      @media(max-width:700px){.dealerOldSalePage,.dealerOldStockPage{padding:2px 0 76px}.dealerOldSaleHeader,.dealerOldStockHead{display:block}.dealerOldSaleHeader h2,.dealerOldStockHead h2{font-size:21px}.dealerOldSaleActions{margin-top:10px}.dealerOldSaleActions .btn{flex:1}.dealerOldSaleSectionTitle{padding:13px}.dealerOldSaleSectionTitle span{font-size:10px;max-width:260px}.dealerOldSaleTable,.dealerOldStockTable{min-width:0;width:100%}.dealerOldSaleTable thead,.dealerOldStockTable thead{display:none}.dealerOldSaleTable tbody,.dealerOldStockTable tbody,.dealerOldSaleTable tr,.dealerOldStockTable tr,.dealerOldSaleTable td,.dealerOldStockTable td{display:block;width:100%;box-sizing:border-box}.dealerOldSaleTable tr,.dealerOldStockTable tr{padding:11px 12px;border-bottom:1px solid #edf1f5}.dealerOldSaleTable td,.dealerOldStockTable td{display:flex!important;justify-content:space-between;gap:14px;border:0!important;padding:6px 0!important;text-align:right}.dealerOldSaleTable td:before,.dealerOldStockTable td:before{content:attr(data-label);font-weight:700;color:#738195;text-align:left}.dealerOldSaleTable td:last-child{padding-top:10px!important}.dealerOldSaleEnter{width:100%}.dealerOldSaleSummary{grid-template-columns:1fr 1fr}.dealerOldSaleSummary>div:last-child{grid-column:1/-1}.dealerOldSaleModal{padding:8px;align-items:flex-end}.dealerOldSaleModalBox{max-height:calc(100vh - 16px);padding:16px;border-radius:16px}.dealerOldSaleModalHead h2{font-size:19px}.dealerOldSaleFormGrid{grid-template-columns:1fr!important}.dealerOldSaleModalFooter{position:sticky;bottom:0;background:#fff;margin:16px -16px -16px;padding:12px 16px;z-index:2}.dealerOldSaleSave,.dealerOldSaleCancel{flex:1}.dealerOldStockGrid{grid-template-columns:1fr 1fr}.dealerOldStockStat:first-child{grid-column:1/-1}}
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
      .dealerCreateSalePage{padding:12px}
      .dealerCreateSalePanel{max-width:760px}
      .dealerCreateSaleGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .dealerCreateSaleGrid label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#30445b}
      .dealerCreateSaleGrid input,.dealerCreateSaleGrid select{width:100%;min-height:42px;box-sizing:border-box}
      .dealerCreateSaleItemField{grid-column:1/-1}
      .dealerCreateSaleActions{justify-content:flex-end}
      .dealerCreateSalePreview{margin-top:16px;border:1px solid #dfe7f0;border-radius:12px;background:#f8fbff;overflow:hidden}
      .dealerCreateSalePreviewHead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 13px;border-bottom:1px solid #e5ebf2;color:#24384d;font-size:12px}
      .dealerCreateSalePreviewHead span{font-size:10px;font-weight:800;color:#246fe8}
      .dealerCreateSalePreviewGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:13px}
      .dealerCreateSalePreviewGrid>div{min-width:0}
      .dealerCreateSalePreviewGrid span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.45px;color:#718096;font-weight:800}
      .dealerCreateSalePreviewGrid b{display:block;margin-top:3px;font-size:12px;color:#24384d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:620px){.dealerCreateSalePage{padding:0}.dealerCreateSalePanel{border-radius:0 0 12px 12px;padding:13px}.dealerCreateSaleGrid{grid-template-columns:1fr}.dealerCreateSaleItemField{grid-column:auto}.dealerCreateSaleActions{position:sticky;bottom:0;background:#fff;padding-top:12px}.dealerCreateSalePreviewGrid{grid-template-columns:1fr 1fr}.dealerCreateSalePreviewGrid>div:last-child{grid-column:1/-1}}
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
      <nav className="dealerSideNav">{sidebarEntries.map(([key,icon,label]) =>
        <button key={key} className={'dealerNavItem'+((key==='battery-adjustment'?isBatteryAdjustmentActive:tab===key)?' active':'')} onClick={()=>goToSidebarTab(key)}><span className="dealerNavIcon">{icon}</span><span>{label}</span></button>
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
                  (key !== 'cashbook' && key !== 'cash-handover' && key !== 'expenses-create' && key !== 'handover-create' || canCashBook) &&
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

      {mobileNav && <div className="dealerMobileNav">{sidebarEntries.map(([key,icon,label])=><button key={key} className={'dealerNavItem'+((key==='battery-adjustment'?isBatteryAdjustmentActive:tab===key)?' active':'')} onClick={()=>{goToSidebarTab(key);setMobileNav(false)}}><span className="dealerNavIcon">{icon}</span>{label}</button>)}</div>}
      {error && <div className="error dealerError">{error}</div>}

      <nav className="dealerBottomNav dealerBottomNavForce" aria-label="Dealer bottom navigation">
        {nav.filter(x=>['dashboard','stock','purchases','payments','ledger'].includes(x[0]) && (x[0] !== 'purchases' || canPurchase) && (x[0] !== 'cashbook' || canCashBook)).map(([key,icon,label])=>
          <button type="button" key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setMobileNav(false)}}>
            <span>{icon}</span><small>{label}</small>
          </button>
        )}
      </nav>
      {standaloneForm || <>
      {tab==='dashboard' && <DealerDashboard dealerName={dealerName} stockCount={stock?.count} challanCount={challans.length} invoiceCount={invoices.length} loanCount={loans.length} latest={latest} onNewLoan={()=>setTab('newloan')} onOpen={setTab} canCashBook={canCashBook}/>} 
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
        {tab==='stock' && <DealerTable headers={['Date','Chassis No.','Model','Motor No.','Colour']} rows={filteredStock} pageSize={35} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Motor No.">{v.motor_no}</td><td data-label="Colour">{v.colour}</td></>}/>}
{tab==='old-stock' && <div className="dealerOldStockPage"><div className="dealerOldStockHead"><div><div className="dealerOldStockKicker">STOCK</div><h2>Old Rickshaw Stock</h2><p>Factory challan se dealer ko receive hue Old Rickshaw yahan dikhte hain.</p></div><button type="button" className="btn" onClick={()=>get('/dealer/old-rickshaws').then(setOldStock).catch(e=>setError(e.message))}>↻ Refresh</button></div><div className="dealerOldStockGrid"><div className="dealerOldStockStat"><span>Total</span><b>{filteredOldStock.length}</b></div><div className="dealerOldStockStat"><span>Available</span><b>{filteredOldStock.filter(v=>String(v.status||'').toLowerCase()==='available').length}</b></div><div className="dealerOldStockStat"><span>Sold</span><b>{filteredOldStock.filter(v=>String(v.status||'').toLowerCase()==='sold').length}</b></div></div><div className="card dealerOldStockCard"><div className="tablewrap dealerTable dealerOldStockTableWrap"><table className="table dealerOldStockTable"><thead><tr><th>Date</th><th>Vehicle No.</th><th>Model</th><th>Owner / Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredOldStock.map(v=><tr key={v.id}><td data-label="Date">{formatDate(v.date||v.sale_date)}</td><td data-label="Vehicle No."><b>{v.vehicle_reg_no||'—'}</b></td><td data-label="Model">{v.model_name||'—'}</td><td data-label="Owner / Customer">{v.owner_name||v.sold_to||'—'}</td><td data-label="Amount">{v.sale_amount?'₹ '+Number(v.sale_amount).toLocaleString('en-IN'):'—'}</td><td data-label="Status"><span className={'dealerOldStockStatus '+(String(v.status||'').toLowerCase()==='sold'?'sold':'available')}>{String(v.status||'available').toUpperCase()}</span></td></tr>)}{!filteredOldStock.length&&<tr><td colSpan="6"><div className="dealerEmpty">No Old Rickshaw in stock.</div></td></tr>}</tbody></table></div></div></div>}
        {tab==='battery-stock' && <DealerTable headers={['Date','Battery Maker','Battery No.','Reference']} rows={filteredBatteryStock} pageSize={35} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Battery Maker">{v.battery_maker||'—'}</td><td data-label="Battery No."><b>{v.battery_no}</b></td><td data-label="Reference">{v.reference_no||'—'}</td></>}/>}
        {tab==='challans' && <DealerTable headers={['Date','Challan No.','Chassis No.','Model','Destination']} rows={filteredChallans} pageSize={35} row={c=><><td data-label="Date">{formatDate(c.date)}</td><td data-label="Challan No.">{c.challan_no}</td><td data-label="Chassis No.">{c.chassis_no}</td><td data-label="Model">{c.product_name}</td><td data-label="Destination">{c.destination}</td></>}/>}
        {tab==='invoices' && <DealerTable headers={['Date','Bill No.','Chassis No.','Model','Buyer','Total']} rows={filteredInvoices} pageSize={35} row={i=><><td data-label="Date">{formatDate(i.date)}</td><td data-label="Bill No.">{i.bill_no}</td><td data-label="Chassis No.">{i.chassis_no}</td><td data-label="Model">{i.product_name}</td><td data-label="Buyer">{i.buyer_name}</td><td data-label="Total">{i.bill_total}</td></>}/>}
        {tab==='all-receipt' && <DealerAllReceiptsPage />}
        {tab==='all-customers' && <DealerAllCustomersPage />}
        {tab==='expenses-create' && <DealerExpenseCreatePage />}
        {tab==='handover-create' && <DealerHandoverCreatePage />}
        {!['cashbook','receipt-create','expenses-create','handover-create','cash-handover','all-receipt','all-customers','delivery','purchases','payments','ledger','pending-sales','stock','old-stock','battery-stock','challans','invoices','loan-status','seized-vehicles'].includes(tab) && tab!=='dashboard' && <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>{dealerHeaderSections.flatMap(s=>s.items).find(x=>x[0]===tab)?.[1] || 'Dealer Module'}</h3><p>This module is available from the top header.</p></div></div><div className="dealerEmpty">Module screen ready — records will appear here.</div></div>}
        {tab==='loan-status' && <DealerLoanStatusTable rows={loans}/>}
        {tab==='seized-vehicles' && <div className="dealerPage"><div className="dealerPanel" style={{marginBottom:14}}><div className="dealerPanelHead"><div><h3>Seized Vehicles</h3><p>Vehicles physically parked at your dealer. CHFPL will release them for sale when applicable.</p></div><span className="pill d">HOLD</span></div>{!seizedVehicles.length?<div className="dealerEmpty">No seized vehicles are currently parked at this dealer.</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Repo Date</th><th>Loan</th><th>Vehicle</th><th>Model</th><th>Colour</th><th>Battery</th><th>RC</th><th>Charger</th><th>Status</th></tr></thead><tbody>{seizedVehicles.map(v=>{const loan=v.loan_applications||{};const customer=loan.customer_profiles||{};return <tr key={v.id}><td>{formatDate(v.repo_date)}</td><td><b>{loan.loan_account_no||loan.application_no||'—'}</b><div className="muted">{customer.full_name||'—'}</div></td><td><b>{v.vehicle_no||'—'}</b></td><td>{v.model_name||loan.grd_model_name||'—'}</td><td>{v.colour||'—'}</td><td>{v.battery_available?v.battery_no||'Yes':'No'}</td><td>{v.rc_available?'Yes':'No'}</td><td>{v.charger_available?'Yes':'No'}</td><td><span className="pill d">HOLD</span></td></tr>})}</tbody></table></div>}</div></div>}
      </>}
      </>}
    </main>
  </div>;
}

function DealerCreateSaleForm({stock,oldStock,batteryStock,onBack}) {
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [type,setType]=useState('');
  const [item,setItem]=useState('');

  const newItems=stock?.vehicles||[];
  const oldItems=oldStock?.rickshaws||[];
  const batteryItems=batteryStock?.batteries||[];

  const options=type==='new' ? newItems : type==='old' ? oldItems : type==='battery' ? batteryItems : [];
  const optionValue=(v)=>String(v.id ?? v.chassis_no ?? v.vehicle_reg_no ?? v.battery_no ?? '');
  const selected=options.find(v=>String(v.id ?? v.chassis_no ?? v.vehicle_reg_no ?? v.battery_no ?? '')===String(item));
  const optionLabel=(v)=>{
    if(type==='new') return [v.chassis_no,v.model_name,v.colour].filter(Boolean).join(' · ') || 'New Rickshaw';
    if(type==='old') return [v.model_name,v.battery_name,v.vehicle_reg_no].filter(Boolean).join(' · ') || 'Old Rickshaw';
    return [v.battery_maker,v.battery_no].filter(Boolean).join(' · ') || 'Battery';
  };

  return <div className="grdFormPage dealerCreateSalePage">
    <div className="dealerPanel dealerCreateSalePanel">
      <div className="dealerPanelHead">
        <div><h3>Create Sale</h3><p>Select the sale date, stock type and item.</p></div>
        <button type="button" className="btn" onClick={onBack}>Back</button>
      </div>

      <div className="dealerCreateSaleGrid">
        <label>Date
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </label>

        <label>Sale Type
          <select className="input" value={type} onChange={e=>{setType(e.target.value);setItem('')}}>
            <option value="">Select Type</option>
            <option value="new">New Rickshaw</option>
            <option value="old">Old Rickshaw</option>
            <option value="battery">Battery</option>
          </select>
        </label>

        <label className="dealerCreateSaleItemField">Select {type==='new'?'New Rickshaw':type==='old'?'Old Rickshaw':type==='battery'?'Battery':'Stock Item'}
          <select className="input" value={item} onChange={e=>setItem(e.target.value)} disabled={!type}>
            <option value="">{type ? 'Select item' : 'First select sale type'}</option>
            {options.map(v=><option key={optionValue(v)} value={optionValue(v)}>{optionLabel(v)}</option>)}
          </select>
        </label>
      </div>

      {selected && <div className="dealerCreateSalePreview">
        <div className="dealerCreateSalePreviewHead"><strong>Preview</strong><span>{type==='new'?'New Rickshaw':type==='old'?'Old Rickshaw':'Battery'}</span></div>
        <div className="dealerCreateSalePreviewGrid">
          {type==='new' && <>
            <div><span>Chassis</span><b>{selected.chassis_no||'—'}</b></div>
            <div><span>Model</span><b>{selected.model_name||'—'}</b></div>
            <div><span>Colour</span><b>{selected.colour||'—'}</b></div>
          </>}
          {type==='old' && <>
            <div><span>Model</span><b>{selected.model_name||'—'}</b></div>
            <div><span>Battery Name</span><b>{selected.battery_name||selected.battery_maker||'—'}</b></div>
            <div><span>Vehicle No.</span><b>{selected.vehicle_reg_no||'—'}</b></div>
          </>}
          {type==='battery' && <>
            <div><span>Battery Make</span><b>{selected.battery_maker||'—'}</b></div>
            <div><span>Battery No.</span><b>{selected.battery_no||'—'}</b></div>
          </>}
        </div>
      </div>}

      <div className="actions dealerCreateSaleActions">
        <button type="button" className="btn" onClick={onBack}>Cancel</button>
        <button type="button" className="btn primary" disabled={!date || !type || !item}>Save</button>
      </div>
    </div>
  </div>;
}

function DealerDashboard({dealerName,stockCount,challanCount,invoiceCount,loanCount,latest,onNewLoan,onOpen,canCashBook}) {
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
          <button onClick={()=>onOpen('cashbook')}><span className="quickIcon">₹</span><b>Bahikhata</b><small>Ledger & handover entries</small></button>
          {canCashBook && <button onClick={()=>onOpen('receipt-create')}><span className="quickIcon">🧾</span><b>Create Receipt</b><small>Record a customer receipt</small></button>}
          <button onClick={()=>onOpen('create-sale')}><span className="quickIcon">＋</span><b>Create Sale</b><small>Create sale from available stock</small></button>
        </div>
      </div>
      <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>Recent Activity</h3><p>Latest document records</p></div></div>
        {latest.length?<div className="dealerActivity">{latest.map((x,i)=><div className="dealerActivityRow" key={x.type+x.no+i}><span className="activityDot"></span><div><b>{x.type}</b><small>{x.no||'—'} · {x.text||'—'}</small></div><time>{formatDate(x.date)}</time></div>)}</div>:<div className="dealerEmpty">No recent records available.</div>}
      </div>
    </section>
  </div>;
}

function DealerTable({headers,rows,row,dateKey='date',pageSize=35}) {
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [page,setPage]=useState(1);
  const filtered=(rows||[]).filter(item=>{
    const d=String(item?.[dateKey]||'').slice(0,10);
    return (!from || d>=from) && (!to || d<=to);
  });
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const safePage=Math.min(page,totalPages);
  const visible=filtered.slice((safePage-1)*pageSize,safePage*pageSize);
  useEffect(()=>{setPage(1)},[from,to,rows]);
  return <div>
    <div className="actions" style={{marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700}}>
        From <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{width:145}} />
      </label>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700}}>
        To <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)} style={{width:145}} />
      </label>
      {(from||to) && <button className="btn" onClick={()=>{setFrom('');setTo('')}}>Clear Date</button>}
      <span className="muted" style={{fontSize:11,marginLeft:'auto'}}>{filtered.length} records</span>
    </div>
    <div className="tablewrap dealerTable"><table className="table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map((item,i)=><tr key={item.id??i}>{row(item)}</tr>)}{!visible.length&&<tr><td colSpan={headers.length}><div className="dealerEmpty">No records found.</div></td></tr>}</tbody></table></div>
    {filtered.length>pageSize && <div className="actions" style={{justifyContent:'center',alignItems:'center'}}>
      <button className="btn" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>← Prev</button>
      <span className="muted">Page {safePage} of {totalPages}</span>
      <button className="btn" disabled={safePage>=totalPages} onClick={()=>setPage(safePage+1)}>Next →</button>
    </div>}
  </div>;
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
  return <div className="dealerPage grdFormPage"><div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>Battery Swap / Exchange</h3><p>Dealer ke apne rickshaws ke beech battery swap.</p></div><button className="btn" type="button" onClick={onBack}>Back</button></div>
      {error&&<div className="error">{error}</div>}
      <form onSubmit={save}><div className="grid">
        <label>Rickshaw Type<select className="input" value={type} onChange={e=>{setType(e.target.value);setFrom('');setTo('')}}><option value="new">New Rickshaw</option><option value="old">Old Rickshaw</option></select></label>
        <label>From Rickshaw<select className="input" value={from} onChange={e=>setFrom(e.target.value)} required><option value="">Select…</option>{opts.map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''} — {(x.battery_numbers||[]).join(', ')||'No Battery'}</option>)}</select></label>
        <label>To Rickshaw<select className="input" value={to} onChange={e=>setTo(e.target.value)} required><option value="">Select…</option>{opts.filter(x=>String(x.id)!==String(from)).map(x=><option key={x.id} value={x.id}>{x.reg_no||x.chassis_no} — {x.model_name||''} — {(x.battery_numbers||[]).join(', ')||'No Battery'}</option>)}</select></label>
      </div><div className="actions"><button className="btn primary">Save Battery Swap</button></div></form>
    </div></div>;
}


function DealerOldRickshawSales({dealer,onBack}) {
  const [rows,setRows]=useState([]),[stock,setStock]=useState([]),[edit,setEdit]=useState(null),[form,setForm]=useState({}),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const load=async()=>{
    try{
      setError('');
      const [challanData,stockData]=await Promise.all([
        get('/dealer/old-rickshaw-challans'),
        get('/dealer/old-rickshaws')
      ]);
      setRows(challanData.challans||[]);
      setStock(stockData.rickshaws||[]);
    }catch(e){
      setError(e.message||'Could not load Old Rickshaw records.');
    }
  };
  useEffect(()=>{load()},[]);
  const open=(r)=>{
    setMobileNav(false);
    setEdit(r);
    setError('');
    setForm({
      sale_amount:r.sale_amount||'',
      file_charge:r.file_charge||'',
      loan_amount:r.loan_amount||'',
      down_payment:r.down_payment||'',
      sale_customer:r.sale_customer||'',
      sale_mobile:r.sale_mobile||'',
      sold_at:r.sold_at||new Date().toISOString().slice(0,10)
    });
  };
  const save=async(e)=>{
    e.preventDefault();
    if(!edit)return;
    setSaving(true);
    setError('');
    try{
      await post('/dealer/old-rickshaw-challans/'+edit.id+'/sale',form);
      setEdit(null);
      await load();
    }catch(e){
      setError(e.message||'Could not save sale data.');
    }finally{
      setSaving(false);
    }
  };
  const pending=rows.filter(r=>['PENDING_SALE','APPROVED','VERIFIED'].includes(String(r.status||'').toUpperCase()));
  const availableStock=stock.filter(r=>String(r.status||'').toLowerCase()==='available');
  const soldStock=stock.filter(r=>String(r.status||'').toLowerCase()==='sold');
  const challanForStock=(s)=>pending.find(r=>String(r.vehicle_no||'').trim().toLowerCase()===String(s.vehicle_reg_no||'').trim().toLowerCase());
  return <div className="dealerPage dealerOldSalePage">
    <div className="dealerOldSaleHeader">
      <div><div className="dealerOldSaleKicker">OLD RICKSHAW</div><h2>Old Rickshaw Sale</h2><p>Factory challan se dealer ko aaye Old Rickshaw ka stock aur resale ek hi module se manage karein.</p></div>
      <div className="dealerOldSaleActions"><button type="button" className="btn" onClick={load}>↻ Refresh</button><button type="button" className="btn" onClick={onBack}>← Back</button></div>
    </div>
    {error&&<div className="error dealerOldSaleError">{error}</div>}

    <div className="dealerOldStockGrid">
      <div className="dealerOldStockStat"><span>Total Stock</span><b>{stock.length}</b></div>
      <div className="dealerOldStockStat"><span>Available</span><b>{availableStock.length}</b></div>
      <div className="dealerOldStockStat"><span>Sold</span><b>{soldStock.length}</b></div>
    </div>

    <div className="card dealerOldSaleCard" style={{marginBottom:14}}>
      <div className="dealerOldSaleSectionTitle">
        <div><strong>Old Rickshaw Stock</strong><span>Factory challan se banne wala stock isi module me dikhega. Sale ke liye pending challan ke saath linked record par action milega.</span></div>
        <span className="dealerOldSaleCount">{availableStock.length}</span>
      </div>
      <div className="tablewrap dealerTable dealerOldStockTableWrap">
        <table className="table dealerOldStockTable">
          <thead><tr><th>Date</th><th>Vehicle No.</th><th>Model</th><th>Colour</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {availableStock.map(v=>{
              const linked=challanForStock(v);
              return <tr key={v.id}>
                <td data-label="Date">{formatDate(v.date||v.sale_date)}</td>
                <td data-label="Vehicle No."><b>{v.vehicle_reg_no||'—'}</b></td>
                <td data-label="Model">{v.model_name||'—'}</td>
                <td data-label="Colour">{v.colour||'—'}</td>
                <td data-label="Status"><span className="dealerOldStockStatus available">AVAILABLE</span></td>
                <td data-label="Action">{linked?<button type="button" className="btn primary dealerOldSaleEnter" onClick={()=>open(linked)}>Enter Sale Data</button>:<span className="muted">Challan pending</span>}</td>
              </tr>;
            })}
            {!availableStock.length&&<tr><td colSpan="6"><div className="dealerEmpty">No Old Rickshaw available in stock.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div className="card dealerOldSaleCard">
      <div className="dealerOldSaleSectionTitle">
        <div><strong>Pending Old Rickshaw Sale</strong><span>Enter customer and sale details. Saving will mark the linked Old Rickshaw stock as SOLD.</span></div>
        <span className="dealerOldSaleCount">{pending.length}</span>
      </div>
      <div className="tablewrap dealerTable dealerOldSaleTableWrap">
        <table className="table dealerOldSaleTable">
          <thead><tr><th>Challan</th><th>Model</th><th>Vehicle No.</th><th>Colour</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {pending.map(r=><tr key={r.id}>
              <td data-label="Challan"><b>{r.challan_no||'—'}</b></td>
              <td data-label="Model">{r.model_name||'—'}</td>
              <td data-label="Vehicle No."><b>{r.vehicle_no||'—'}</b></td>
              <td data-label="Colour">{r.colour||'—'}</td>
              <td data-label="Status"><span className="dealerOldSaleStatus">{r.status||'PENDING_SALE'}</span></td>
              <td data-label="Action"><button type="button" className="btn primary dealerOldSaleEnter" onClick={()=>open(r)}>Enter Sale Data</button></td>
            </tr>)}
            {!pending.length&&<tr><td colSpan="6"><div className="dealerEmpty">No pending Old Rickshaw challans.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {edit&&<div className="modal dealerOldSaleModal" onClick={()=>!saving&&setEdit(null)}>
      <form className="modalbox dealerOldSaleModalBox" onSubmit={save} onClick={e=>e.stopPropagation()}>
        <div className="dealerOldSaleModalHead"><div><div className="dealerOldSaleKicker">SALE DETAILS</div><h2>Old Rickshaw Sale</h2><p>{edit.challan_no||'—'} · {edit.vehicle_no||'—'} · {edit.model_name||'—'}</p></div><button type="button" className="dealerOldSaleClose" onClick={()=>setEdit(null)} aria-label="Close">×</button></div>
        <div className="dealerOldSaleSummary"><div><span>Vehicle</span><b>{edit.vehicle_no||'—'}</b></div><div><span>Model</span><b>{edit.model_name||'—'}</b></div><div><span>Challan</span><b>{edit.challan_no||'—'}</b></div></div>
        <div className="formgrid dealerOldSaleFormGrid">
          <div className="field"><label>Sale Amount</label><input className="input" type="number" inputMode="numeric" min="0" value={form.sale_amount} onChange={e=>setForm({...form,sale_amount:e.target.value})} required /></div>
          <div className="field"><label>File Charge</label><input className="input" type="number" inputMode="numeric" min="0" value={form.file_charge} onChange={e=>setForm({...form,file_charge:e.target.value})} /></div>
          <div className="field"><label>Loan Amount</label><input className="input" type="number" inputMode="numeric" min="0" value={form.loan_amount} onChange={e=>setForm({...form,loan_amount:e.target.value})} /></div>
          <div className="field"><label>Down Payment</label><input className="input" type="number" inputMode="numeric" min="0" value={form.down_payment} onChange={e=>setForm({...form,down_payment:e.target.value})} /></div>
          <div className="field"><label>Customer Name</label><input className="input" value={form.sale_customer} onChange={e=>setForm({...form,sale_customer:e.target.value})} required /></div>
          <div className="field"><label>Mobile</label><input className="input" inputMode="numeric" maxLength="10" value={form.sale_mobile} onChange={e=>setForm({...form,sale_mobile:e.target.value.replace(/\D/g,'').slice(0,10)})} required /></div>
        </div>
        <div className="dealerOldSaleModalFooter"><button type="button" className="btn dealerOldSaleCancel" onClick={()=>setEdit(null)} disabled={saving}>Cancel</button><button type="submit" className="btn primary dealerOldSaleSave" disabled={saving}>{saving?'Saving…':'Save Sale'}</button></div>
      </form>
    </div>}
  </div>;
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

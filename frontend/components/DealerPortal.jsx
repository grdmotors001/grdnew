'use client';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { Palette } from 'lucide-react';
import { THEMES, useTheme } from '../lib/theme';
import { formatDate } from '../lib/date';
import { DealerCashBook } from './DealerCashBook';
import { DealerNewLoanForm } from './DealerNewLoanForm';
import { DealerPaymentPage } from './DealerPaymentPage';
import { DealerCashReceiptPage } from './DealerCashReceiptPage';
import { DealerRepairReceiptPage } from './DealerRepairReceiptPage';
import { ExpensePaymentVoucherPage } from './ExpensePaymentVoucherPage';
import { DealerCustomerInvoicePage } from './DealerCustomerInvoicePage';
import { DealerLedgerPage } from './DealerLedgerPage';
import { DealerPendingSalesPage } from './DealerPendingSalesPage';
import { DealerAllReceiptsPage, DealerAllCustomersPage, DealerExpenseCreatePage, DealerHandoverCreatePage } from './DealerCashBookExtras';
import { ChatWidget } from './ChatWidget';
import { DealerProfilePage, DealerPasswordPage } from './DealerProfilePage';
import { Field, ErrorBanner } from './ui';

const dealerHeaderSections = [
  {label:'Stock', items:[['stock','New Stock'],['old-stock','Old Rickshaw Stock'],['battery-stock','Battery Stock'],['seized-vehicles','Seized Vehicle']]},
  {label:'Report', items:[['challans','Delivery Challan'],['invoices','Tax Invoice'],['incentive','Incentive Record'],['expenses-reports','Expenses Reports']]},
  {label:'Bahikhata', items:[['cashbook','Cashbook'],['all-customers','All Customers'],['all-receipt','All Receipt'],['all-expenses','All Expenses'],['expenses-create','Expenses Create'],['handover-create','Cash Handover'],['payments','Online Payment']]},
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
  ['repair-receipt', '🔧', 'Repair Receipt'],
  ['create-sale', '＋', 'Create Sale'],
  ['profile', '👤', 'My Profile'],
  ['password', '🔑', 'Password'],
];

// Old Rickshaw Stock, Battery Stock and Seized Vehicles are no longer
// separate side-nav entries — they live as tabs inside "My Stock" (see
// dealerHeaderSections' Stock group below). Kept in `nav` above so page
// titles/icons still resolve by key; just hidden from the side/mobile menus.
// Battery Withdrawal, Battery Swap/Exchange and Battery Fit (addition) are
// likewise folded into a single "Battery Adjustment" side-nav entry (see
// BATTERY_ADJUSTMENT_KEYS + the sidebarEntries logic below); Battery Stock
// is also reachable from that same group's top sub-menu.
// Create Receipt is available directly from the side/mobile menus for showroom dealers.
const SIDEBAR_HIDDEN_KEYS = new Set(['old-stock', 'battery-stock', 'seized-vehicles', 'battery-withdrawal', 'battery-swap', 'battery-addition']);
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
  const [chatOpen, setChatOpen] = useState(false);
  const { themeId, changeTheme } = useTheme();
  const [showPalette, setShowPalette] = useState(false);
  const [pendingTheme, setPendingTheme] = useState(themeId);
  useEffect(() => { setPendingTheme(themeId); }, [themeId]);
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const canPurchase = dealer.purchase_access === true;
  const canCashBook = (dealer.dealer_category || 'dealer').toLowerCase() === 'showroom';
  const dealerCategory = (dealer.dealer_category || 'dealer').toLowerCase();
  const canCreateSale = ['showroom', 'branch'].includes(dealerCategory);
  const portalModuleList = Array.isArray(dealer?.portal_modules)
    ? dealer.portal_modules.map((x) => String(x).trim()).filter(Boolean)
    : String(dealer?.portal_modules || '').split(',').map((x) => x.trim()).filter(Boolean);
  const portalModules = new Set(portalModuleList);
  const canRepairReceipt = portalModules.has('repair-receipt');
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
  const sidebarEntries = nav.filter(([key]) => !SIDEBAR_HIDDEN_KEYS.has(key) && (key !== 'purchases' || canPurchase) && (key !== 'cashbook' || canCashBook) && (key !== 'receipt-create' || canCashBook) && (key !== 'repair-receipt' || canRepairReceipt) && (key !== 'create-sale' || canCreateSale) && (key !== 'old-rickshaw-sales' || canOldRickshawSales));
  if (canBatteryAdjustment) {
    const batteryEntry = ['battery-adjustment', '🔋', 'Battery Adjustment'];
    const insertAt = sidebarEntries.findIndex(([key]) => key === 'old-rickshaw-sales');
    if (insertAt === -1) sidebarEntries.push(batteryEntry); else sidebarEntries.splice(insertAt, 0, batteryEntry);
  }
  const isBatteryAdjustmentActive = BATTERY_ADJUSTMENT_KEYS.includes(tab);
  const goToSidebarTab = (key) => setTab(key === 'battery-adjustment' ? defaultBatteryTab : key);

  const loadLoanStatus = async () => {
    try {
      const l = await get('/dealer/loan-status', { timeoutMs: 60000, noClientCache: true });
      setLoans(l.applications || []);
    } catch {
      setLoans([]);
    }
  };

  useEffect(() => {
    // Dealer portal must remain usable if one optional data module is unavailable.
    // Load each section independently instead of turning one API failure into a
    // permanent full-page error banner.
    setError('');
    const loads = [
      ['stock', () => get('/dealer/stock').then(setStock)],
      ['old-rickshaws', () => get('/dealer/old-rickshaws').then(setOldStock)],
      ['battery-stock', () => get('/dealer/battery-stock').then(setBatteryStock)],
      ['delivery-challans', () => get('/dealer/delivery-challans').then(r => setChallans(r.challans || []))],
      ['tax-invoices', () => get('/dealer/tax-invoices').then(r => setInvoices(r.invoices || []))],
    ];
    loads.forEach(([name, load]) => load().catch((e) => {
      console.warn('[dealer-portal] optional module failed:', name, e);
    }));
    loadLoanStatus();
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

  const dealerName = String(dealer?.name || dealer?.full_name || 'Dealer');
  const dealerCode = String(dealer?.code || dealer?.login_id || dealer?.dealer_code || '');
  // Salesman logins open the portal of their dealer: show the salesman's own name, dealer name goes underneath.
  const isSalesman = Boolean(dealer?.is_salesman || dealer?.role === 'salesman');
  const personName = isSalesman ? String(dealer?.salesman || 'Salesman') : dealerName;

  const standaloneForm =
    (tab === 'create-sale' && canCreateSale) ? <DealerCreateSaleForm dealer={dealer} stock={stock} oldStock={oldStock} batteryStock={batteryStock} onBack={() => setTab('dashboard')} /> :
    tab === 'newloan' ? <DealerNewLoanForm onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-withdrawal' && canBatteryWithdrawal) ? <DealerBatteryWithdrawal dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-swap' && canBatterySwap) ? <DealerBatterySwap dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'battery-addition' && canBatteryAddition) ? <DealerBatteryAddition dealer={dealer} onBack={() => setTab('dashboard')} /> :
    (tab === 'old-rickshaw-sales' && canOldRickshawSales) ? <DealerOldRickshawSales dealer={dealer} onBack={() => setTab('dashboard')} onSold={() => get('/dealer/old-rickshaws').then(setOldStock).catch(() => {})} /> :
    (tab === 'customer-invoice' && canPurchase) ? <DealerCustomerInvoicePage challan={selectedPurchase} dealer={dealer} onBack={() => setTab('purchases')} /> :
    null;

  return (<div className="dealerShell">
    <style>{`
      .dealerOldSalePage{padding:4px 0 80px}
      .dealerOldSaleHeader,.dealerOldStockHead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px;padding:4px 2px}
      .dealerOldSaleKicker,.dealerOldStockKicker{font-size:10px;font-weight:900;letter-spacing:1px;color:var(--accent);text-transform:uppercase}
      .dealerOldSaleHeader h2,.dealerOldStockHead h2{margin:2px 0 4px;font-size:24px;color:#172b45}
      .dealerOldSaleHeader p,.dealerOldStockHead p{margin:0;color:#748297;font-size:12px}
      .dealerOldSaleActions{display:flex;gap:8px;flex-wrap:wrap}
      .dealerOldSaleCard,.dealerOldStockCard{border:1px solid #e4e9ef;border-radius:14px;background:#fff;box-shadow:0 5px 18px rgba(31,55,79,.06);overflow:hidden}
      .dealerOldSaleSectionTitle{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #edf1f5}
      .dealerOldSaleSectionTitle strong{display:block;font-size:15px;color:#1f334a}.dealerOldSaleSectionTitle span{display:block;margin-top:3px;font-size:11px;color:#7b8898}
      .dealerOldSaleCount{min-width:30px!important;width:30px;height:30px;border-radius:50%;display:grid!important;place-items:center;background:color-mix(in srgb,var(--accent) 12%,white);color:var(--accent)!important;font-weight:800}
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
      .dealerTopbar.grdTopHeader{margin:-28px -32px 22px;padding:0 18px;overflow:visible}
      .dealerTopbar.grdTopHeader .dealerEyebrow{color:#ffffffb0}
      .dealerTopbar.grdTopHeader h1{color:#fff}
      .dealerTopTitleBlock{min-width:0;flex:1 1 auto;overflow:hidden}
      .dealerTopTitleBlock h1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media(max-width:1100px){.dealerTopbar.grdTopHeader{margin:-24px -24px 20px}}
      @media(max-width:700px){.dealerTopbar.grdTopHeader{margin:-14px -14px 14px}.dealerTopbar.grdTopHeader .dealerMobileMenu{display:flex;background:#ffffff1a;border-color:#ffffff40;color:#fff;flex:none}.dealerTopbar.grdTopHeader .grdHeaderUser strong{display:none}}
      .dealerBatteryCard{margin-top:6px}
      .dealerBatteryFormGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px;align-items:end}
      .dealerBatteryFormGrid label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#30445b}
      .dealerBatteryFormGrid input,.dealerBatteryFormGrid select{width:100%;min-height:42px;box-sizing:border-box}
      .dealerBatteryFormActions{display:flex;justify-content:flex-start;margin-top:16px}
      @media(max-width:900px){.dealerBatteryFormGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.dealerBatteryFormGrid{grid-template-columns:1fr}}
      @media(max-width:700px){.dealerPortalHeaderNav{margin:0 -10px;padding-left:10px;padding-right:10px}.dealerPortalHeaderItem{font-size:9px;padding:6px 8px}.dealerPortalHeaderLabel{font-size:8px}}
      .dealerDashboardStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dealerDashStat{border:1px solid #e1e7ef;border-radius:11px;background:#fbfdff;padding:12px;text-align:left;cursor:pointer}.dealerDashStat span{display:block;color:#748297;font-size:10px;font-weight:700}.dealerDashStat b{display:block;margin-top:4px;color:#1f334a;font-size:22px}.dealerDashboardActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.dealerTablePager{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px;border-top:1px solid #edf1f5;font-size:11px;color:#66758a}@media(max-width:700px){.dealerDashboardStats{grid-template-columns:1fr 1fr}.dealerTablePager{justify-content:center}}
    `}</style>
    <aside className="dealerSidebar">
      <div className="dealerBrand"><div className="dealerBrandMark">G</div><div><strong>G.R.D. MOTORS</strong><span>Dealer Portal</span></div></div>
      <div className="dealerProfileMini"><div className="dealerAvatar">{personName.slice(0,1).toUpperCase()}</div><div><strong>{personName}</strong><span>{isSalesman ? dealerName : dealerCode}</span></div></div>
      <nav className="dealerSideNav">{sidebarEntries.map(([key,icon,label]) =>
        <button key={key} className={'dealerNavItem'+((key==='battery-adjustment'?isBatteryAdjustmentActive:tab===key)?' active':'')} onClick={()=>goToSidebarTab(key)}><span className="dealerNavIcon">{icon}</span><span>{label}</span></button>
      )}</nav>
      <button className="dealerLogout" onClick={onLogout}><span>↪</span> Log Out</button>
    </aside>

    <main className="dealerMain">
      <header className="dealerTopbar grdTopHeader">
        <button className="dealerMobileMenu" onClick={()=>setMobileNav(v=>!v)}>☰</button>
        {activeHeaderSection ? (() => {
          const section = dealerHeaderSections.find(s => s.label === activeHeaderSection);
          if (!section) return null;
          const items = section.items.filter(([key]) =>
            (key !== 'incentive' || canCashBook) &&
            (key !== 'cashbook' && key !== 'cash-handover' && key !== 'expenses-create' && key !== 'handover-create' || canCashBook) &&
            (key !== 'battery-withdrawal' || canBatteryWithdrawal) &&
            (key !== 'battery-swap' || canBatterySwap) &&
            (key !== 'battery-addition' || canBatteryAddition) &&
            (key !== 'old-rickshaw-sales' || canOldRickshawSales)
          );
          return (
            <div className="moduleStrip dealerModuleStrip" aria-label={activeHeaderSection}>
              {items.map(([key,label]) => (
                <button type="button" key={key}
                  className={'moduleStripItem'+(tab===key?' active':'')}
                  onClick={()=>setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
          );
        })() : (
          <div className="dealerTopTitleBlock">
            <h1>{tab==='dashboard'?'Dashboard':nav.find(x=>x[0]===tab)?.[2]||'Dealer Panel'}</h1>
          </div>
        )}
        <div className="grdHeaderActions">
          <button type="button" className="grdHeaderIcon" title="Office Chat" aria-label="Office Chat" onClick={()=>{ if (window.innerWidth <= 700) window.location.href = '/chat'; else setChatOpen(v=>!v); }}>💬</button>
          <button type="button" className="grdHeaderIcon" title="Notifications" aria-label="Notifications">🔔</button>
          <div className="themePaletteWrap">
            <button type="button" className="themeColorButton" onClick={() => setShowPalette(v => !v)} title="Themes" aria-label="Open themes"><Palette size={14}/></button>
            {showPalette && <div className="themeChooser" role="dialog" aria-label="Choose theme">
              {THEMES.map(theme => <button
                key={theme.id}
                type="button"
                className={'themeCard'+(pendingTheme===theme.id?' selected':'')}
                style={{background:`linear-gradient(90deg, ${theme.colors.primary} 0 33.333%, ${theme.colors.accent} 33.333% 66.666%, ${theme.colors.bg} 66.666% 100%)`}}
                title={theme.name}
                aria-label={theme.name}
                onClick={() => { changeTheme(theme.id); setPendingTheme(theme.id); setShowPalette(false); }}
              />)}
            </div>}
          </div>
          <div className="grdHeaderUser"><div className="grdHeaderAvatar">{personName.slice(0,1).toUpperCase()}</div><strong>{personName}</strong><span>⌄</span></div>
          <button className="btn dealerLogoutTop" onClick={onLogout}>Log Out</button>
        </div>
      </header>
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
      {tab==='dashboard' && <DealerDashboard dealerName={personName} stockCount={stock?.count} challanCount={challans.length} invoiceCount={invoices.length} loanCount={loans.length} latest={latest} onNewLoan={()=>setTab('newloan')} onOpen={setTab} canCashBook={canCashBook}/>} 
      {tab==='profile' && <DealerProfilePage dealer={dealer}/>}
      {tab==='password' && <DealerPasswordPage/>}
      {tab!=='dashboard' && tab!=='profile' && tab!=='password' && <>
        <div className="dealerContentToolbar">
          <div className="dealerPageIntro"><span className="dealerSectionIcon">{nav.find(x=>x[0]===tab)?.[1]}</span><div><strong>{nav.find(x=>x[0]===tab)?.[2]}</strong><small>Dealer-wise records</small></div></div>
          {tab!=='cashbook' && <input className="input dealerSearch" placeholder="Search chassis, bill, challan, model…" value={search} onChange={e=>setSearch(e.target.value)}/>}
        </div>
        {tab==='cashbook' && canCashBook && <DealerCashBook/>}
        {tab==='all-expenses' && canCashBook && <DealerAllExpenses/>}
        {tab==='incentive' && canCashBook && <DealerIncentiveRegister dealer={dealer}/>}
        {tab==='receipt-create' && canCashBook && <DealerCashReceiptPage dealer={dealer}/>}
        {tab==='repair-receipt' && canRepairReceipt && <DealerRepairReceiptPage dealer={dealer}/>}
        {tab==='purchases' && canPurchase && <DealerTable headers={['Date','Challan No.','Product','Chassis No.','Action']} rows={filteredChallans} row={v=>{
          const invoiced=invoices.some(i=>i.chassis_no&&i.chassis_no===v.chassis_no);
          return <><td>{formatDate(v.date)}</td><td><b>{v.challan_no}</b></td><td>{v.product_name||'—'}</td><td>{v.chassis_no||'—'}</td>
            <td>{invoiced?<span className="muted">Invoiced</span>:<button className="btn primary" onClick={()=>{setSelectedPurchase(v);setTab('customer-invoice')}}>Create Invoice</button>}</td></>}}/>}
        {tab==='payments' && <DealerPaymentPage dealer={dealer}/>}
        {tab==='ledger' && <DealerLedgerPage/>}
        {tab==='pending-sales' && <DealerPendingSalesPage/>}
        {tab==='stock' && <DealerTable headers={['Date','Chassis No.','Model','Motor No.','Colour']} rows={filteredStock} pageSize={35} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Chassis No."><b>{v.chassis_no}</b></td><td data-label="Model">{v.model_name}</td><td data-label="Motor No.">{v.motor_no}</td><td data-label="Colour">{v.colour}</td></>}/>}
{tab==='old-stock' && <div className="dealerOldStockPage"><div className="dealerOldStockHead"><div><div className="dealerOldStockKicker">STOCK</div><h2>Old Rickshaw Stock</h2><p>Factory challan se dealer ko receive hue Old Rickshaw yahan dikhte hain.</p></div><button type="button" className="btn" onClick={()=>get('/dealer/old-rickshaws').then(setOldStock).catch(e=>setError(e.message))}>↻ Refresh</button></div><div className="dealerOldStockGrid"><div className="dealerOldStockStat"><span>Total</span><b>{filteredOldStock.length}</b></div><div className="dealerOldStockStat"><span>Available</span><b>{filteredOldStock.filter(v=>String(v.status||'').toLowerCase()==='available').length}</b></div><div className="dealerOldStockStat"><span>Sold</span><b>{filteredOldStock.filter(v=>String(v.status||'').toLowerCase()==='sold').length}</b></div></div><div className="card dealerOldStockCard"><div className="tablewrap dealerTable dealerOldStockTableWrap"><table className="table dealerOldStockTable"><thead><tr><th>Date</th><th>Vehicle No.</th><th>Model</th><th>Owner / Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredOldStock.map(v=><tr key={v.id}><td data-label="Date">{formatDate(v.date||v.sale_date)}</td><td data-label="Vehicle No."><b>{v.vehicle_reg_no||'—'}</b></td><td data-label="Model">{v.model_name||'—'}</td><td data-label="Owner / Customer">{v.owner_name||v.sold_to||'—'}</td><td data-label="Amount">{v.sale_amount?'₹ '+Number(v.sale_amount).toLocaleString('en-IN'):'—'}</td><td data-label="Status"><span className={'dealerOldStockStatus '+(String(v.status||'').toLowerCase()==='sold'?'sold':'available')}>{v.pending_sale_id?'PENDING SALE':String(v.status||'available').toUpperCase()}</span></td></tr>)}{!filteredOldStock.length&&<tr><td colSpan="6"><div className="dealerEmpty">No Old Rickshaw in stock.</div></td></tr>}</tbody></table></div></div></div>}
        {tab==='battery-stock' && <DealerTable headers={['Date','Battery Maker','Battery No.','Reference']} rows={filteredBatteryStock} pageSize={35} row={v=><><td data-label="Date">{formatDate(v.date)}</td><td data-label="Battery Maker">{v.battery_maker||'—'}</td><td data-label="Battery No."><b>{v.battery_no}</b></td><td data-label="Reference">{v.reference_no||'—'}</td></>}/>}
        {tab==='challans' && <DealerTable headers={['Date','Challan No.','Chassis No.','Model','Destination']} rows={filteredChallans} pageSize={35} row={c=><><td data-label="Date">{formatDate(c.date)}</td><td data-label="Challan No.">{c.challan_no}</td><td data-label="Chassis No.">{c.chassis_no}</td><td data-label="Model">{c.product_name}</td><td data-label="Destination">{c.destination}</td></>}/>}
        {tab==='invoices' && <DealerTable headers={['Date','Bill No.','Chassis No.','Model','Buyer','Total']} rows={filteredInvoices} pageSize={35} row={i=><><td data-label="Date">{formatDate(i.date)}</td><td data-label="Bill No.">{i.bill_no}</td><td data-label="Chassis No.">{i.chassis_no}</td><td data-label="Model">{i.product_name}</td><td data-label="Buyer">{i.buyer_name}</td><td data-label="Total">{i.bill_total}</td></>}/>}
        {tab==='all-receipt' && <DealerAllReceiptsPage dealer={dealer} />}
        {tab==='all-customers' && <DealerAllCustomersPage />}
        {tab==='expenses-create' && <DealerExpenseCreatePage />}
        {tab==='handover-create' && <DealerHandoverCreatePage />}
        {!['cashbook','receipt-create','repair-receipt','expenses-create','handover-create','cash-handover','all-receipt','all-customers','purchases','payments','ledger','pending-sales','stock','old-stock','battery-stock','challans','invoices','loan-status','seized-vehicles'].includes(tab) && tab!=='dashboard' && <div className="dealerPanel"><div className="dealerPanelHead"><div><h3>{dealerHeaderSections.flatMap(s=>s.items).find(x=>x[0]===tab)?.[1] || 'Dealer Module'}</h3><p>This module is available from the top header.</p></div></div><div className="dealerEmpty">Module screen ready — records will appear here.</div></div>}
        {tab==='loan-status' && <DealerLoanStatusTable rows={loans} onRefresh={loadLoanStatus}/>}
        {tab==='seized-vehicles' && <div className="dealerPage"><div className="dealerPanel" style={{marginBottom:14}}><div className="dealerPanelHead"><div><h3>Seized Vehicles</h3><p>Vehicles physically parked at your dealer. CHFPL will release them for sale when applicable.</p></div><span className="pill d">HOLD</span></div>{!seizedVehicles.length?<div className="dealerEmpty">No seized vehicles are currently parked at this dealer.</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Repo Date</th><th>Loan</th><th>Vehicle</th><th>Model</th><th>Colour</th><th>Battery</th><th>RC</th><th>Charger</th><th>Status</th></tr></thead><tbody>{seizedVehicles.map(v=>{const loan=v.loan_applications||{};const customer=loan.customer_profiles||{};return <tr key={v.id}><td>{formatDate(v.repo_date)}</td><td><b>{loan.loan_account_no||loan.application_no||'—'}</b><div className="muted">{customer.full_name||'—'}</div></td><td><b>{v.vehicle_no||'—'}</b></td><td>{v.model_name||loan.grd_model_name||'—'}</td><td>{v.colour||'—'}</td><td>{v.battery_available?v.battery_no||'Yes':'No'}</td><td>{v.rc_available?'Yes':'No'}</td><td>{v.charger_available?'Yes':'No'}</td><td><span className="pill d">HOLD</span></td></tr>})}</tbody></table></div>}</div></div>}
      </>}
      </>}
    </main>
    <ChatWidget open={chatOpen} onOpenChange={setChatOpen} />
  </div>);
}

function DealerDashboard({dealerName,stockCount,challanCount,invoiceCount,loanCount,latest,onNewLoan,onOpen,canCashBook}) {
  const cards = [
    ['New Stock', stockCount ?? 0, 'stock'],
    ['Delivery Challans', challanCount ?? 0, 'challans'],
    ['Tax Invoices', invoiceCount ?? 0, 'invoices'],
    ['Loan Applications', loanCount ?? 0, 'loan-status'],
  ];
  return <div className="dealerPage">
    <div className="dealerPanel" style={{marginBottom:14}}>
      <div className="dealerPanelHead">
        <div><h3>Welcome, {dealerName}</h3><p>Dealer dashboard and recent activity.</p></div>
        <button type="button" className="btn primary" onClick={onNewLoan}>＋ New Loan</button>
      </div>
      <div className="dealerDashboardStats">
        {cards.map(([label,value,key]) => <button type="button" className="dealerDashStat" key={key} onClick={()=>onOpen(key)}>
          <span>{label}</span><b>{value}</b>
        </button>)}
      </div>
      <div className="dealerDashboardActions">
        <button type="button" className="btn" onClick={()=>onOpen('stock')}>My Stock</button>
        <button type="button" className="btn" onClick={()=>onOpen('challans')}>Delivery Challans</button>
        <button type="button" className="btn" onClick={()=>onOpen('invoices')}>Tax Invoices</button>
        {canCashBook && <button type="button" className="btn" onClick={()=>onOpen('cashbook')}>Bahikhata</button>}
      </div>
    </div>
    <div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>Recent Activity</h3><p>Latest delivery challans and tax invoices.</p></div></div>
      {latest?.length ? <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Type</th><th>No.</th><th>Date</th><th>Reference</th></tr></thead><tbody>
        {latest.map((x,i)=><tr key={(x.type||'')+'-'+(x.no||'')+'-'+i}><td>{x.type}</td><td><b>{x.no||'—'}</b></td><td>{formatDate(x.date)}</td><td>{x.text||'—'}</td></tr>)}
      </tbody></table></div> : <div className="dealerEmpty">No recent activity.</div>}
    </div>
  </div>;
}

function DealerTable({headers,rows,row,pageSize=35}) {
  const [page,setPage]=useState(1);
  const totalPages=Math.max(1,Math.ceil((rows?.length||0)/pageSize));
  const current=Math.min(page,totalPages);
  useEffect(()=>{if(page>totalPages)setPage(totalPages)},[page,totalPages]);
  const visible=(rows||[]).slice((current-1)*pageSize,current*pageSize);
  return <div className="card">
    <div className="tablewrap dealerTable"><table className="table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
      <tbody>{visible.map((v,i)=><tr key={v?.id ?? v?.chassis_no ?? v?.challan_no ?? v?.bill_no ?? i}>{row(v)}</tr>)}
      {!visible.length && <tr><td colSpan={headers.length}><div className="dealerEmpty">No records found.</div></td></tr>}</tbody>
    </table></div>
    {totalPages>1 && <div className="dealerTablePager"><button type="button" className="btn" disabled={current<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><span>Page {current} / {totalPages}</span><button type="button" className="btn" disabled={current>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button></div>}
  </div>;
}

function DealerLoanStatusTable({rows,onRefresh}) {
  return <div className="dealerPage"><div className="dealerPanel">
    <div className="dealerPanelHead"><div><h3>Loan Status</h3><p>Dealer loan applications and their current status.</p></div><button type="button" className="btn" onClick={onRefresh}>↻ Refresh</button></div>
    {!rows?.length ? <div className="dealerEmpty">No loan applications found.</div> :
      <div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Application</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        {rows.map((r,i)=><tr key={r.id ?? r.application_no ?? i}><td><b>{r.application_no||r.loan_account_no||'—'}</b></td><td>{r.customer_name||r.name||'—'}</td><td>{r.loan_amount!=null ? '₹ '+Number(r.loan_amount).toLocaleString('en-IN') : '—'}</td><td>{r.status||'—'}</td></tr>)}
      </tbody></table></div>}
  </div></div>;
}

function BatteryAdjustmentShell({title,description,onBack,children}) {
  return <div className="dealerPage">
    <div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>{title}</h3><p>{description}</p></div><button type="button" className="btn" onClick={onBack}>Back</button></div>
      {children}
    </div>
  </div>;
}

function DealerBatteryWithdrawal({dealer,onBack}) {
  const [form,setForm]=useState({date:new Date().toISOString().slice(0,10),battery_maker:'',battery_no:'',reference_no:''});
  const [saving,setSaving]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('');
  const submit=async(e)=>{e.preventDefault();setSaving(true);setError('');setMessage('');try{await post('/battery-withdrawal',form);setMessage('Battery stock added successfully.');setForm({...form,battery_no:'',reference_no:''});}catch(err){setError(err.message||'Could not save withdrawal.')}finally{setSaving(false);}};
  return <BatteryAdjustmentShell title="Battery Withdrawal" description="Withdraw / receive a battery into this dealer's battery stock." onBack={onBack}>
    <form onSubmit={submit} className="formgrid" style={{padding:16}}>
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Battery Maker" value={form.battery_maker} onChange={v=>setForm({...form,battery_maker:v})}/>
      <Field label="Battery No." value={form.battery_no} onChange={v=>setForm({...form,battery_no:v})} required/>
      <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
      {error&&<div style={{gridColumn:'1/-1'}}><ErrorBanner message={error}/></div>}
      {message&&<div style={{gridColumn:'1/-1',padding:10,borderRadius:8,background:'rgba(34,160,90,.16)',color:'var(--ink,#147a42)'}}>{message}</div>}
      <div className="actions" style={{gridColumn:'1/-1'}}><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save Withdrawal'}</button></div>
    </form>
  </BatteryAdjustmentShell>;
}

function DealerBatteryAddition({dealer,onBack}) {
  const [data,setData]=useState({batteries:[],vehicles:[]}),[form,setForm]=useState({date:new Date().toISOString().slice(0,10),battery_no:'',vehicle_id:'',position:1,reference_no:''});
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=()=>get('/dealer/battery-adjustment').then(setData).catch(e=>setError(e.message||'Could not load battery stock.'));
  useEffect(()=>{load()},[]);
  const selected=data.batteries.find(x=>String(x.battery_no)===String(form.battery_no));
  const submit=async(e)=>{e.preventDefault();setSaving(true);setError('');setMessage('');try{await post('/battery-addition',{...form,battery_maker:selected?.battery_maker||''});setMessage('Battery fitted to vehicle successfully.');setForm({...form,battery_no:'',reference_no:''});load();}catch(err){setError(err.message||'Could not fit battery.')}finally{setSaving(false);}};
  return <BatteryAdjustmentShell title="Battery Fitting" description="Fit one battery from dealer stock to a vehicle." onBack={onBack}>
    <form onSubmit={submit} className="formgrid" style={{padding:16}}>
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Vehicle" type="select" value={form.vehicle_id} options={[{value:'',label:'Select Vehicle'},...data.vehicles.map(v=>({value:v.id,label:[v.chassis_no,v.model_name].filter(Boolean).join(' · ')}))]} onChange={v=>setForm({...form,vehicle_id:v})} required/>
      <Field label="Battery" type="select" value={form.battery_no} options={[{value:'',label:'Select Battery'},...data.batteries.map(v=>({value:v.battery_no,label:[v.battery_no,v.battery_maker].filter(Boolean).join(' · ')}))]} onChange={v=>setForm({...form,battery_no:v})} required/>
      <Field label="Battery Position" type="select" value={String(form.position)} options={[1,2,3,4].map(x=>({value:String(x),label:'Battery No. '+x}))} onChange={v=>setForm({...form,position:Number(v)})}/>
      <Field label="Reference No." value={form.reference_no} onChange={v=>setForm({...form,reference_no:v})}/>
      {error&&<div style={{gridColumn:'1/-1'}}><ErrorBanner message={error}/></div>}
      {message&&<div style={{gridColumn:'1/-1',padding:10,borderRadius:8,background:'rgba(34,160,90,.16)',color:'var(--ink,#147a42)'}}>{message}</div>}
      <div className="actions" style={{gridColumn:'1/-1'}}><button className="btn primary" disabled={saving||!data.batteries.length}>{saving?'Saving…':'Fit Battery'}</button></div>
    </form>
  </BatteryAdjustmentShell>;
}

function DealerBatterySwap({dealer,onBack}) {
  const [stock,setStock]=useState({new:[],old:[]}),[form,setForm]=useState({from_type:'new',from_id:'',to_type:'new',to_id:'',mode:'swap',date:new Date().toISOString().slice(0,10),remarks:''});
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=()=>Promise.all([get('/dealer/rickshaw-battery-options?type=new'),get('/dealer/rickshaw-battery-options?type=old')]).then(([n,o])=>setStock({new:n.rickshaws||[],old:o.rickshaws||[]})).catch(e=>setError(e.message||'Could not load rickshaws.'));
  useEffect(()=>{load()},[]);
  const typeOptions=[{value:'new',label:'New Rickshaw'},{value:'old',label:'Old Rickshaw'}];
  const opts=(type,placeholder,skipType,skipId)=>[{value:'',label:placeholder},...(stock[type]||[]).filter(r=>!(type===skipType&&String(r.id)===String(skipId))).map(r=>({value:r.id,label:[r.reg_no||r.chassis_no,r.model_name,r.has_battery?('Battery: '+(r.battery_maker||'—')+' | '+(r.battery_numbers||[]).join(', ')):'NO BATTERY'].filter(Boolean).join(' · ')}))];
  const submit=async(e)=>{e.preventDefault();setSaving(true);setError('');setMessage('');try{await post('/battery-swap-vouchers',{...form,from_id:Number(form.from_id),to_id:Number(form.to_id)});setMessage('Battery exchange completed successfully.');setForm({...form,from_id:'',to_id:'',remarks:''});load();}catch(err){setError(err.message||'Could not exchange batteries.')}finally{setSaving(false);}};
  const total=stock.new.length+stock.old.length;
  return <BatteryAdjustmentShell title="Battery Exchange" description="Exchange batteries between rickshaws in your stock: New ⇄ New, Old ⇄ Old, New ⇄ Old or Old ⇄ New." onBack={onBack}>
    <form onSubmit={submit} className="formgrid" style={{padding:16}}>
      <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/>
      <Field label="Mode" type="select" value={form.mode} options={[{value:'swap',label:'Exchange / Swap'},{value:'transfer',label:'Transfer'}]} onChange={v=>setForm({...form,mode:v})}/>
      <Field label="From Rickshaw Type" type="select" value={form.from_type} options={typeOptions} onChange={v=>{setError('');setForm({...form,from_type:v,from_id:''})}}/>
      <Field label="Source Rickshaw" type="select" value={form.from_id} options={opts(form.from_type,'Select Source Rickshaw')} onChange={v=>{setError('');setForm({...form,from_id:v})}} required/>
      <Field label="To Rickshaw Type" type="select" value={form.to_type} options={typeOptions} onChange={v=>{setError('');setForm({...form,to_type:v,to_id:''})}}/>
      <Field label="Target Rickshaw" type="select" value={form.to_id} options={opts(form.to_type,'Select Target Rickshaw',form.from_type,form.from_id)} onChange={v=>{setError('');setForm({...form,to_id:v})}} required/>
      <Field label="Remarks" value={form.remarks} onChange={v=>setForm({...form,remarks:v})}/>
      {error&&<div style={{gridColumn:'1/-1'}}><ErrorBanner message={error}/></div>}
      {message&&<div style={{gridColumn:'1/-1',padding:10,borderRadius:8,background:'rgba(34,160,90,.16)',color:'var(--ink,#147a42)'}}>{message}</div>}
      <div className="actions" style={{gridColumn:'1/-1'}}><button className="btn primary" disabled={saving||total<2}>{saving?'Saving…':'Exchange Battery'}</button></div>
    </form>
  </BatteryAdjustmentShell>;
}
function DealerOldRickshawSales({dealer,onBack,onSold}) {
  // Dealer ke apne Old Rickshaw stock se sale banata hai. Sale pehle Pending Sales me jaati hai;
  // Billing approval ke baad gaadi Sold hoti hai aur sale data CHFPL ko jata hai.
  const todayStr=()=>new Date().toISOString().slice(0,10);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [row,setRow]=useState(null);
  const [form,setForm]=useState({});
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [customers,setCustomers]=useState([]);

  const load=async()=>{
    try{
      setError('');
      const r=await get('/dealer/old-rickshaws',{noClientCache:true});
      setRows(r.rickshaws||[]);
    }catch(e){setError(e.message||'Could not load Old Rickshaw stock.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);
  // Booking customers (Create Sale wali list). Sirf Old Rickshaw booking wale customers dropdown me aate hain.
  useEffect(()=>{
    (async()=>{
      try{
        const c=await get('/billing/pending-sales/options?part=customers',{noClientCache:true,timeoutMs:30000});
        setCustomers((c.cash_customers||[]).filter(x=>String(x.booking_for||x.vehicle_no||'').trim().toLowerCase()==='old'));
      }catch(e){setError(e.message||'Could not load customers')}
    })();
  },[]);
  const pickCustomer=(id)=>{
    const c=customers.find(x=>String(x.id)===String(id));
    setForm(x=>({...x,customer_id:id,customer_name:c?.name||'',
      sale_amount:c?String(Number(c.sale_amount||0)||''):'',loan_amount:c?String(Number(c.loan_amount||0)||0):'0'}));
  };
  const selCust=customers.find(x=>String(x.id)===String(form.customer_id));
  const paidAmt=Number(selCust?.paid_amount||0);
  const custLabel=c=>[c.page_no?('Page: '+c.page_no):'',c.name,c.phone].filter(Boolean).join(' · ');

  const setF=(k,v)=>setForm(x=>({...x,[k]:v}));
  const balance=Math.max(0,Number(form.sale_amount||0)-Number(form.loan_amount||0)-paidAmt);
  const openSale=(r)=>{
    setNotice('');setError('');setRow(r);
    setForm({sale_date:todayStr(),customer_id:'',customer_name:'',sale_amount:'',loan_amount:'0',do_number:''});
  };
  const save=async(e)=>{
    e.preventDefault();
    if(!selCust){setError('Customer select karo.');return}
    setBusy(true);setError('');
    try{
      await post('/billing/pending-sales/create',{
        sale_category:'OLD',old_rickshaw_id:row.id,sp_no:row.sp_no||'',sale_date:form.sale_date,
        dealer_cash_customer_id:Number(selCust.id),customer_name:selCust.name||form.customer_name,buyer_name:selCust.name||form.customer_name,
        buyer_mobile:selCust.phone||'',customer_phone:selCust.phone||'',dealer_page_no:selCust.page_no||'',
        sale_amount:Number(form.sale_amount||0),loan_amount:Number(form.loan_amount||0),hypothecation_amount:Number(form.loan_amount||0),
        amount_received:paidAmt,do_no:form.do_number||'',ledger_no:''
      },{timeoutMs:60000});
      setNotice('Sale Pending Sales me bhej di gayi: '+(row.vehicle_reg_no||'Old Rickshaw')+' → '+form.customer_name+'. Approval ke baad Sold hogi.');
      setRow(null);
      await load();
      if(onSold)onSold();
    }catch(err){setError(err.message||'Could not create Old Rickshaw sale.')}
    finally{setBusy(false)}
  };

  const q=search.trim().toLowerCase();
  const list=rows.filter(v=>!q||[v.vehicle_reg_no,v.model_name,v.challan_no,v.sp_no,v.customer_name].join(' ').toLowerCase().includes(q));
  const available=list.filter(v=>String(v.status||'').toLowerCase()==='available'&&!v.pending_sale_id);
  const pendingList=list.filter(v=>String(v.status||'').toLowerCase()==='available'&&v.pending_sale_id);
  const sold=list.filter(v=>String(v.status||'').toLowerCase()==='sold');

  return <div className="dealerPage">
    <div className="dealerPanel" style={{marginBottom:14}}>
      <div className="dealerPanelHead">
        <div><h3>Old Rickshaw Sale</h3><p>Apne Old Rickshaw stock me se gaadi select karke sale banayein.</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="input" style={{maxWidth:220}} placeholder="Search vehicle / model…" value={search} onChange={e=>setSearch(e.target.value)} />
          <button type="button" className="btn" onClick={load}>↻ Refresh</button>
          <button type="button" className="btn" onClick={onBack}>Back</button>
        </div>
      </div>
      {!row&&error&&<ErrorBanner message={error}/>}
      {notice&&<div className="muted" style={{margin:'0 0 10px',color:'#15803d',fontWeight:700}}>{notice}</div>}
      {loading?<div className="dealerEmpty">Loading…</div>:!available.length?<div className="dealerEmpty">Sale ke liye koi Available Old Rickshaw nahi hai.</div>:
      <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Date</th><th>Vehicle No.</th><th>Model</th><th>Colour</th><th>Challan No.</th><th>SP No.</th><th>Action</th></tr></thead>
        <tbody>{available.map(v=><tr key={v.id}>
          <td>{formatDate(v.date||v.challan_date)}</td>
          <td><b>{v.vehicle_reg_no||'—'}</b></td>
          <td>{v.model_name||'—'}</td>
          <td>{v.colour||'—'}</td>
          <td>{v.challan_no||'—'}</td>
          <td>{v.sp_no||'—'}</td>
          <td><button type="button" className="btn primary" onClick={()=>openSale(v)}>Create Sale</button></td>
        </tr>)}</tbody>
      </table></div>}
      {pendingList.length>0&&<div className="muted" style={{marginTop:12}}><b>Pending Sale (approval baaki):</b> {pendingList.map(v=>v.vehicle_reg_no||v.sp_no).filter(Boolean).join(', ')}</div>}
    </div>

    {sold.length>0&&<div className="dealerPanel">
      <div className="dealerPanelHead"><div><h3>Sold Old Rickshaw</h3><p>Aapke dwara becchi gayi gaadiyan.</p></div><span className="pill t">{sold.length} Sold</span></div>
      <div className="tablewrap dealerTable"><table className="table">
        <thead><tr><th>Sale Date</th><th>Vehicle No.</th><th>Model</th><th>Customer</th><th>Sale Amt.</th><th>Loan</th><th>Balance</th></tr></thead>
        <tbody>{sold.map(v=><tr key={v.id}>
          <td>{formatDate(v.sale_date||v.date)}</td>
          <td><b>{v.vehicle_reg_no||'—'}</b></td>
          <td>{v.model_name||'—'}</td>
          <td>{v.customer_name||v.out_name||v.owner_name||'—'}</td>
          <td>{v.sale_amount?'₹ '+Number(v.sale_amount).toLocaleString('en-IN'):'—'}</td>
          <td>{v.loan_amount?'₹ '+Number(v.loan_amount).toLocaleString('en-IN'):'—'}</td>
          <td>{v.balance_amount?'₹ '+Number(v.balance_amount).toLocaleString('en-IN'):'—'}</td>
        </tr>)}</tbody>
      </table></div>
    </div>}

    {row&&<div className="modal"><form className="modalbox" onSubmit={save}>
      <h2>Create Old Rickshaw Sale</h2>
      {error&&<ErrorBanner message={error}/>}
      <div className="muted" style={{marginBottom:8}}>Sale pehle Pending Sales me jayegi. Approval ke baad hi Sold hogi.</div>
      <div className="formgrid">
        <Field label="SP No." value={row.sp_no||'—'} readOnly/>
        <Field label="Sale Date" type="date" value={form.sale_date} onChange={v=>setF('sale_date',v)} required/>
        <label className="field"><span>Customer (booking)</span>
          <select className="input" value={form.customer_id||''} onChange={e=>pickCustomer(e.target.value)} required>
            <option value="">{customers.length?'Select Customer':'Koi Old Rickshaw booking customer nahi hai'}</option>
            {customers.map(c=><option key={c.id} value={c.id}>{custLabel(c)}</option>)}
          </select>
        </label>
        <Field label="Sale Amount" type="number" value={form.sale_amount} readOnly/>
        <Field label="Loan Amount" type="number" value={form.loan_amount} onChange={v=>setF("loan_amount",v)}/>
        <Field label="Amount Received (booking)" type="number" value={paidAmt} readOnly/>
        <Field label="Balance" type="number" value={balance} readOnly/>
        <Field label="DO No. (Optional)" value={form.do_number} onChange={v=>setF('do_number',v)}/>
        <Field label="Vehicle No." value={row.vehicle_reg_no||'—'} readOnly/>
        <Field label="Model" value={row.model_name||'—'} readOnly/>
      </div>
      <div className="actions" style={{marginTop:18,justifyContent:'flex-end'}}>
        <button type="button" className="btn" onClick={()=>setRow(null)}>Cancel</button>
        <button className="btn primary" disabled={busy||!selCust||!(Number(form.sale_amount||0)>0)||Number(form.loan_amount||0)>Number(form.sale_amount||0)}>{busy?'Saving…':'Send to Pending'}</button>
      </div>
    </form></div>}
  </div>;
}
function DealerDealerModulePlaceholder({title,description,onBack}) {
  return <div className="dealerPage"><div className="dealerPanel"><div className="dealerPanelHead"><div><h3>{title}</h3><p>{description}</p></div><button type="button" className="btn" onClick={onBack}>Back</button></div><div className="dealerEmpty">Module screen is ready.</div></div></div>;
}

function DealerCreateSaleForm({dealer,stock,oldStock,batteryStock,onBack}) {
  // Showroom / Branch dealers create their own Pending Sale. It goes to Billing (Open for Approve) exactly like an admin-created one.
  // Dealer = logged-in dealer (auto). Sale type New / Old / Battery comes from the customer's booking.
  const [customers,setCustomers]=useState([]);
  const [vehicles,setVehicles]=useState([]);
  const [dealerName,setDealerName]=useState(dealer?.name||dealer?.dealer_name||'');
  const [customerId,setCustomerId]=useState('');
  const [item,setItem]=useState('');
  const [batteryQty,setBatteryQty]=useState('1');
  const [batteryNos,setBatteryNos]=useState(['']);
  const [saleAmount,setSaleAmount]=useState('');
  const [loanAmount,setLoanAmount]=useState('0');
  const [doNo,setDoNo]=useState('');
  const [ledgerNo,setLedgerNo]=useState('');
  const [remarks,setRemarks]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    (async()=>{
      try{
        const [d,v,c]=await Promise.all([
          get('/billing/pending-sales/options?part=dealers',{noClientCache:true,timeoutMs:30000}),
          get('/billing/pending-sales/options?part=vehicles',{noClientCache:true,timeoutMs:30000}),
          get('/billing/pending-sales/options?part=customers',{noClientCache:true,timeoutMs:30000})
        ]);
        setDealerName(d.dealers?.[0]?.name||dealerName);
        setVehicles(v.vehicles||[]);
        setCustomers(c.cash_customers||[]);
      }catch(e){setError(e.message||'Could not load customers / stock')}
      finally{setLoading(false)}
    })();
  },[]);

  const selectedCustomer=customers.find(c=>String(c.id)===String(customerId));
  const bookedType=String(selectedCustomer?.booking_for||selectedCustomer?.vehicle_no||'').trim().toLowerCase();
  const type=['new','old','battery'].includes(bookedType)?bookedType:'';
  const typeLabel=type==='new'?'New Rickshaw':type==='old'?'Old Rickshaw':type==='battery'?'Battery':'—';

  const options=type==='new'
    ? vehicles.map(v=>({value:String(v.challan_id),label:[v.chassis_no,v.model_name||v.product_name,v.colour].filter(Boolean).join(' · ')||'New Rickshaw',raw:v}))
    : type==='old'
    ? (oldStock?.rickshaws||[]).filter(v=>String(v.status||'').toLowerCase()==='available'&&!v.pending_sale_id).map(v=>({value:String(v.id),label:[v.model_name,v.battery_maker,v.vehicle_reg_no].filter(Boolean).join(' · ')||'Old Rickshaw',raw:v}))
    : [];
  const selected=options.find(o=>o.value===String(item))?.raw;

  // Battery sale: Qty ke barabar battery-number select boxes, dealer ke battery stock se (duplicate number nahi).
  const stockBatteries=useMemo(()=>{
    const seen=new Set();
    return (batteryStock?.batteries||[]).filter(v=>{
      const no=String(v.battery_no||'').trim().toUpperCase();
      if(!no||seen.has(no))return false;
      seen.add(no);return true;
    });
  },[batteryStock]);
  const qtyNum=Math.max(1,Math.min(Number(batteryQty)||1,stockBatteries.length||1,50));
  const pickedBatteries=batteryNos.slice(0,qtyNum).map(no=>stockBatteries.find(b=>String(b.battery_no).trim()===String(no).trim())).filter(Boolean);
  const batteryReady=type==='battery'&&pickedBatteries.length===qtyNum;
  const changeBatteryQty=v=>{
    setBatteryQty(v);
    const n=Math.max(1,Math.min(Number(v)||1,stockBatteries.length||1,50));
    setBatteryNos(cur=>Array.from({length:n},(_,i)=>cur[i]||''));
  };
  const setBatteryNoAt=(i,v)=>setBatteryNos(cur=>{const nx=[...cur];nx[i]=v;return nx});

  useEffect(()=>{
    setItem('');setBatteryQty('1');setBatteryNos(['']);
    if(!selectedCustomer){setSaleAmount('');setLoanAmount('0');setDoNo('');return}
    // Booking is the source of truth for amounts.
    setSaleAmount(String(Number(selectedCustomer.sale_amount||0)||''));
    setLoanAmount(String(Number(selectedCustomer.loan_amount||0)||0));
    setDoNo('');
  },[selectedCustomer?.id]);

  const paid=Number(selectedCustomer?.paid_amount||0);
  const balance=Math.max(0,Number(saleAmount||0)-Number(loanAmount||0)-paid);
  const customerLabel=c=>[c.page_no?('Page: '+c.page_no):'',c.name,c.phone,(c.booking_for||c.vehicle_no)?('Type: '+String(c.booking_for||c.vehicle_no).toUpperCase()):''].filter(Boolean).join(' · ');

  const save=async()=>{
    if(!selectedCustomer||!type||(type==='battery'?!batteryReady:!selected))return;
    setSaving(true);setError('');
    try{
      if(!(Number(saleAmount)>0))throw new Error('Booking me Sale Amount nahi hai. Pehle customer booking me Sale Amount bharo.');
      if(Number(loanAmount||0)>Number(saleAmount||0))throw new Error('Loan Amount Sale Amount se zyada nahi ho sakta.');
      let description,extra={};
      if(type==='new'){
        extra={vehicle_id:Number(selected.challan_id),delivery_challan_id:Number(selected.challan_id)};
        description='Internal Sale';
      }else if(type==='old'){
        description='Old Rickshaw · '+[selected.vehicle_reg_no,selected.model_name].filter(Boolean).join(' · ');
        extra={vehicle_id:null,delivery_challan_id:null,vehicle_reg_no:selected.vehicle_reg_no||'',old_rickshaw_id:Number(selected.id),sp_no:selected.sp_no||'',sale_date:new Date().toISOString().slice(0,10)};
      }else{
        const makers=[...new Set(pickedBatteries.map(b=>String(b.battery_maker||'').trim()).filter(Boolean))].join(' / ');
        description='Battery · '+[makers,'Qty '+qtyNum,pickedBatteries.map(b=>String(b.battery_no).trim()).join(', ')].filter(Boolean).join(' · ');
        extra={vehicle_id:null,delivery_challan_id:null};
      }
      await post('/billing/pending-sales/create',{
        sale_category:type.toUpperCase(),dealer_id:Number(dealer?.dealer_id||dealer?.id||0)||undefined,
        dealer_cash_customer_id:Number(selectedCustomer.id),
        buyer_name:selectedCustomer.name||'',customer_name:selectedCustomer.name||'',
        buyer_mobile:selectedCustomer.phone||'',customer_phone:selectedCustomer.phone||'',
        dealer_page_no:selectedCustomer.page_no||'',
        sale_amount:Number(saleAmount),loan_amount:Number(loanAmount||0),hypothecation_amount:Number(loanAmount||0),
        amount_received:paid,do_no:doNo.trim()||'',ledger_no:type==='old'?ledgerNo.trim():'',
        description,internal_sale_details:[description,remarks.trim()].filter(Boolean).join(' | '),
        ...extra
      },{timeoutMs:60000});
      alert('Sale Billing ko approval ke liye bhej di gayi hai.');
      onBack();
    }catch(e){setError(e.message||'Could not save sale')}
    finally{setSaving(false)}
  };

  return <div className="grdFormPage dealerCreateSalePage">
    <div className="dealerPanel dealerCreateSalePanel">
      <div className="dealerPanelHead">
        <div><h3>Create Sale</h3><p>Customer select karte hi booking ka Sale Type (New / Old / Battery) aur Sale Amount automatically aa jayenge. Save ke baad sale Billing approval me jaati hai.</p></div>
        <button type="button" className="btn" onClick={onBack}>Back</button>
      </div>

      {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
      {loading?<div className="dealerEmpty">Loading customers and stock…</div>:
      <div className="dealerCreateSaleGrid">
        <label>Dealer
          <input className="input" value={dealerName||'—'} readOnly />
        </label>

        <label>Customer (booking)
          <select className="input" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
            <option value="">{customers.length?'Select Customer':'No Vehicle Pending Customer'}</option>
            {customers.map(c=><option key={c.id} value={c.id}>{customerLabel(c)}</option>)}
          </select>
        </label>

        <label>Dealer Page No.
          <input className="input" value={selectedCustomer?.page_no||''} readOnly />
        </label>

        <label>Sale Type (booking se)
          <input className="input" value={typeLabel} readOnly />
        </label>

        {type==='battery' ? <>
          <label>Battery Qty
            <input className="input" type="number" min="1" max={stockBatteries.length||1} value={batteryQty} onChange={e=>changeBatteryQty(e.target.value)} />
            <small className="muted">Stock me available: {stockBatteries.length}</small>
          </label>
          {Array.from({length:qtyNum},(_,i)=>{
            const taken=new Set(batteryNos.slice(0,qtyNum).filter((x,j)=>j!==i&&x).map(x=>String(x).trim()));
            return <label key={i}>Battery No. {i+1}
              <select className="input" value={batteryNos[i]||''} onChange={e=>setBatteryNoAt(i,e.target.value)}>
                <option value="">{stockBatteries.length?'Select Battery No.':'Stock me koi battery nahi hai'}</option>
                {stockBatteries.filter(b=>!taken.has(String(b.battery_no).trim())).map(b=><option key={b.battery_no} value={String(b.battery_no).trim()}>{[b.battery_no,b.battery_maker].filter(Boolean).join(' · ')}</option>)}
              </select>
            </label>;
          })}
        </> :         <label className="dealerCreateSaleItemField">Select {type?typeLabel:'Stock Item'}
          <select className="input" value={item} onChange={e=>setItem(e.target.value)} disabled={!type}>
            <option value="">{!type?'Select customer first':options.length?'Select item':'Stock me koi item nahi hai'}</option>
            {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>}

        <label>Sale Amount
          <input className="input" type="number" value={saleAmount} readOnly />
        </label>

        <label>Loan Amount
          <input className="input" type="number" min="0" max={saleAmount||undefined} value={loanAmount} onChange={e=>setLoanAmount(e.target.value)} disabled={!selectedCustomer} />
        </label>

        <label>Amount Received (booking)
          <input className="input" type="number" value={paid} readOnly />
        </label>

        <label>Balance
          <input className="input" type="number" value={balance} readOnly />
        </label>

        <label>DO No. (Optional)
          <input className="input" value={doNo} onChange={e=>setDoNo(e.target.value)} placeholder="Enter DO No. (optional)" />
        </label>

        {type==='old'&&<label>Ledger No. (Optional - approval par admin bharega)
          <input className="input" value={ledgerNo} onChange={e=>setLedgerNo(e.target.value)} placeholder="Enter Ledger No." disabled={!selectedCustomer} />
        </label>}

        <label>Remarks (Optional)
          <input className="input" value={remarks} onChange={e=>setRemarks(e.target.value)} />
        </label>
      </div>}

      {selectedCustomer && <div className="dealerCreateSalePreview">
        <div className="dealerCreateSalePreviewHead"><strong>Booking</strong><span>{typeLabel.toUpperCase()}</span></div>
        <div className="dealerCreateSalePreviewGrid">
          <div><span>Name</span><b>{selectedCustomer.name||'—'}</b></div>
          <div><span>Phone</span><b>{selectedCustomer.phone||'—'}</b></div>
          <div><span>Booking Paid</span><b>₹ {paid.toLocaleString('en-IN')}</b></div>
        </div>
      </div>}

      {(type==='battery'?batteryReady:selected) && <div className="dealerCreateSalePreview">
        <div className="dealerCreateSalePreviewHead"><strong>Vehicle</strong><span>{typeLabel}</span></div>
        <div className="dealerCreateSalePreviewGrid">
          {type==='new' && <>
            <div><span>Chassis</span><b>{selected.chassis_no||'—'}</b></div>
            <div><span>Model</span><b>{selected.model_name||selected.product_name||'—'}</b></div>
            <div><span>Colour</span><b>{selected.colour||'—'}</b></div>
          </>}
          {type==='old' && <>
            <div><span>Model</span><b>{selected.model_name||'—'}</b></div>
            <div><span>Battery Name</span><b>{selected.battery_name||selected.battery_maker||'—'}</b></div>
            <div><span>Vehicle No.</span><b>{selected.vehicle_reg_no||'—'}</b></div>
          </>}
          {type==='battery' && <>
            <div><span>Battery Make</span><b>{[...new Set(pickedBatteries.map(b=>b.battery_maker).filter(Boolean))].join(' / ')||'—'}</b></div>
            <div><span>Qty</span><b>{qtyNum}</b></div>
            <div><span>Battery No(s).</span><b>{pickedBatteries.map(b=>b.battery_no).join(', ')||'—'}</b></div>
          </>}
        </div>
      </div>}

      <div className="actions dealerCreateSaleActions">
        <button type="button" className="btn" onClick={onBack}>Cancel</button>
        <button type="button" className="btn primary"
          disabled={saving||loading||!selectedCustomer||!type||(type==='battery'?!batteryReady:!item)||Number(loanAmount||0)>Number(saleAmount||0)}
          onClick={save}>
          {saving?'Saving…':'Save & Send for Approval'}
        </button>
      </div>
    </div>
  </div>;
}

function DealerAllExpenses(){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[search,setSearch]=useState(''),[cat,setCat]=useState('');
  useEffect(()=>{get('/dealer/cash-book/all-expenses').then(r=>setRows(r.expenses||r.rows||[])).catch(e=>setError(e.message||'Could not load expenses')).finally(()=>setLoading(false))},[]);
  const label=r=>r.category_label||r.category||'Other';
  const cats=[...new Set(rows.map(label))].sort();
  const q=search.trim().toLowerCase();
  const filtered=rows.filter(r=>(!cat||label(r)===cat)&&[r.date,r.expense_no,label(r),r.paid_to,r.remarks].join(' ').toLowerCase().includes(q));
  const total=filtered.reduce((t,r)=>t+Number(r.amount||0),0);
  const byCat=Object.entries(filtered.reduce((m,r)=>{m[label(r)]=(m[label(r)]||0)+Number(r.amount||0);return m},{})).sort((a,b)=>b[1]-a[1]);
  const inr=n=>'\u20b9 '+Number(n||0).toLocaleString('en-IN');
  return <div className="dealerPage"><div className="dealerPanel"><div className="dealerPanelHead"><div><h3>All Expenses</h3><p>Shop expenses \u2014 category wise</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><select className="input" value={cat} onChange={e=>setCat(e.target.value)}><option value="">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select><input className="input dealerSearch" placeholder="Search expense no, paid to, remarks\u2026" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
    {error&&<div className="error">{error}</div>}
    {!loading&&!!byCat.length&&<div className="grid" style={{margin:'12px 0'}}><div className="card" style={{padding:10}}><small className="muted">Total{cat?' \u2014 '+cat:''}</small><b>{inr(total)}</b></div>{!cat&&byCat.map(([c,v])=><div className="card" key={c} style={{padding:10,cursor:'pointer'}} onClick={()=>setCat(c)}><small className="muted">{c}</small><b>{inr(v)}</b></div>)}</div>}
    {loading?<div className="dealerEmpty">Loading\u2026</div>:<div className="tablewrap dealerTable"><table className="table"><thead><tr><th>Date</th><th>Expense No.</th><th>Category</th><th>Paid To</th><th>Remarks</th><th>Amount</th></tr></thead><tbody>
      {filtered.map(r=><tr key={r.id}><td>{formatDate(r.date)}</td><td><b>{r.expense_no||'\u2014'}</b></td><td>{label(r)}</td><td>{r.paid_to||'\u2014'}</td><td>{r.remarks||'\u2014'}</td><td>{inr(r.amount)}</td></tr>)}{!filtered.length&&<tr><td colSpan="6" className="muted">No expenses found.</td></tr>}</tbody><tfoot><tr><th colSpan="5">Total</th><th>{inr(total)}</th></tr></tfoot></table></div>}
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
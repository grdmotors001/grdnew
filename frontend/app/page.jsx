'use client';
// Deployment smoke-trigger: keep the corrected Node frontend on the Vercel production path.
import { useEffect, useState } from 'react';
import { get, setToken, getToken, getPortalKind, setPortalKind } from '../lib/api';
import { Shell } from '../components/Shell';
import { GRDLogin } from '../components/GRDLogin';
import { Dashboard } from '../components/Dashboard';
import { SimpleMasterPage } from '../components/SimpleMasterPage';
import { DealerPage, ProductPage } from '../components/DealerProductPages';
import { CompanyMasterPage } from '../components/CompanyMasterPage';
import { ProductionFormulaPage } from '../components/ProductionFormulaPage';
import { ChassisMasterPage } from '../components/ChassisMasterPage';
import { UserPage, OptionSettingPage, PasswordPage } from '../components/UserPages';
import { NavTabsSettings } from '../components/NavTabsSettings';
import { ProductionVoucherPage } from '../components/ProductionVoucherPage';
import { DeliveryChallanPage } from '../components/DeliveryChallanPage';
import { ChallanShiftPage } from '../components/ChallanShiftPage';
import { TaxInvoicePage } from '../components/TaxInvoicePage';
import { CreditNotePage } from '../components/CreditNotePage';
import { PurchaseBillPage } from '../components/PurchaseBillPage';
import { OldRickshawPage, BatterySwapVoucherPage, BatteryWithdrawalPage, BatteryDeliveryChallanPage, BatteryAdditionPage, BatteryFitPage, JournalStockPage } from '../components/MinorVoucherPages';
import { ExpensePaymentVoucherPage } from '../components/ExpensePaymentVoucherPage';
import { RepairServiceVoucherPage } from '../components/RepairServiceVoucherPage';
import { IncentiveRegisterPage } from '../components/IncentiveRegisterPage';
import { InsuranceRtoRegisterPage } from '../components/InsuranceRtoRegisterPage';
import { RtoExpenseRegisterPage } from '../components/RtoExpenseRegisterPage';
import { BankLedgerPage } from '../components/BankLedgerPage';
import { BillingPendingSalesPage } from '../components/BillingPendingSalesPage';
import { VahanInventoryPage } from '../components/VahanInventoryPage';
import { OldRickshawChallanPage } from '../components/OldRickshawChallanPage';
import { CashAtDealerPage } from '../components/CashAtDealerPage';
import { CashHandoverApprovalPage } from '../components/CashHandoverApprovalPage';
import { DealerCashReceiptPage } from '../components/DealerCashReceiptPage';
import { ClosingStockPremisesPage, ClosingStockDealersPage, ClosingStockRawPage, StockLedgerPremisesPage, StockLedgerDealersPage } from '../components/StockPages';
import { PurchaseRegisterPage, ProductionRegisterPage, DeliveryChallanRegisterPage, SaleRegisterPage, GstRegisterPage, HypothecationRegisterPage, VehicleNoRegisterPage, PaymentReceivablePage, SubsidyReportPage, LedgerPage, DayBookPage, LedgerVPage } from '../components/ReportPages';
import { CustomerExpenseLedgerReportPage } from '../components/CustomerExpenseLedgerReportPage';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { BackupRestorePage } from '../components/BackupRestorePage';
import { BatteryRegisterPage } from '../components/BatteryRegisterPage';
import { FactoryCheckReportPage } from '../components/FactoryCheckReportPage';
import { DailyRawMaterialChecklistPage } from '../components/DailyRawMaterialChecklistPage';
import { DebitNotePage } from '../components/DebitNotePage';
import { ContraVoucherPage } from '../components/ContraVoucherPage';
import { OldRickshawInventoryPage } from '../components/OldRickshawInventoryPage';
import { DealerPortal } from '../components/DealerPortal';
import { HRAttendancePage } from '../components/HRAttendancePage';
import { NotificationPage } from '../components/NotificationPage';
import { ShowroomBatteryStockPage, ShowroomAllCustomersPage, ShowroomExpensesReportsPage } from '../components/ShowroomReportsPages';
import { ProfilePage } from '../components/ProfilePage';
import { BalanceSheetPage, ProfitLossPage, AuditReportPage } from '../components/FinancialReportsPage';
import { LoanWorkflowPage } from '../components/LoanWorkflowPage';
import { LoanApplicationViewPage } from '../components/LoanApplicationViewPage';
import { ChfplRepoVehiclesPage } from '../components/ChfplRepoVehiclesPage';
import { SIMPLE_MASTERS, keyForPath, routeForKey, VOUCHER_PAGE_FOR } from '../lib/menu';

const CUSTOM_PAGES = {
  // Vouchers tab (F4 / F5 / F6): Contra is its own module; Payment & Receipt reuse the Bank & Cash book in voucher mode.
  'v-contra': () => <ContraVoucherPage key="v-contra" />,
  'v-payment': () => <DayBookPage key="v-payment" voucher="PAYMENT" />,
  'v-receipt': () => <DayBookPage key="v-receipt" voucher="RECEIPT" />,
  'showroom-new-stock': () => <ClosingStockPremisesPage />,
  'showroom-old-stock': () => <OldRickshawPage />,
  'showroom-battery-stock': () => <ShowroomBatteryStockPage />,
  'showroom-seized-vehicle': () => <VahanInventoryPage />,
  'showroom-all-customers': () => <ShowroomAllCustomersPage />,
  'showroom-all-receipt': () => <DealerCashReceiptPage />,
  'showroom-expenses-reports': () => <ShowroomExpensesReportsPage />,
  'showroom-cashbook': () => <DayBookPage />,
  'showroom-cash-handover': () => <><CashHandoverApprovalPage /><CashAtDealerPage /></>,
  'showroom-online-payment': () => <PlaceholderPage label="Online Payment" />,
  company: () => <CompanyMasterPage />,
  dealer: () => <DealerPage />,
  product: () => <ProductPage />,
  'production-formula': () => <ProductionFormulaPage />,
  'chassis-master': () => <ChassisMasterPage />,
  user: (ctx) => <UserPage setActive={ctx.setActive} setOptionUserId={ctx.setOptionUserId} />,
  'option-setting': (ctx) => <OptionSettingPage userId={ctx.optionUserId} />,
  password: () => <PasswordPage />,
  'nav-settings': () => <NavTabsSettings />,
  profile: (ctx) => <ProfilePage user={ctx.user} />,
  'purchase-bills': () => <PurchaseBillPage />,
  'billing-pending-sales': () => <BillingPendingSalesPage />,
  'vahan-inventory': () => <VahanInventoryPage />,
  'cash-at-dealer': () => <><CashHandoverApprovalPage /><CashAtDealerPage /></>,
  'dealer-cash-receipt': () => <DealerCashReceiptPage />,
  'production-voucher': () => <ProductionVoucherPage />,
  'delivery-challan': () => <DeliveryChallanPage />,
  'challan-shift': () => <ChallanShiftPage />,
  'tax-invoice': () => <TaxInvoicePage />,
  'credit-note': () => <CreditNotePage />,
  'debit-note': () => <DebitNotePage />,
  'old-rickshaw': () => <OldRickshawPage />,
  'battery-swap': () => <BatterySwapVoucherPage />,
  'battery-withdrawal': () => <BatteryWithdrawalPage />,
  'battery-delivery-challan': () => <BatteryDeliveryChallanPage />,
  'battery-addition': () => <BatteryAdditionPage />,
  'battery-fit': () => <BatteryFitPage />, 
  notifications: () => <NotificationPage />,
  'battery-register': () => <BatteryRegisterPage />,
  'factory-check-report': () => <FactoryCheckReportPage />,
  'daily-raw-material-checklist': () => <DailyRawMaterialChecklistPage />,
  'journal-stock': () => <JournalStockPage />,
  'expense-payment-voucher': () => <ExpensePaymentVoucherPage />,
  'repair-service-voucher': () => <RepairServiceVoucherPage />,
  'old-rickshaw-challan': () => <OldRickshawChallanPage />,
  'old-rickshaw-inventory': () => <OldRickshawInventoryPage />,
  'closing-stock-premises': () => <ClosingStockPremisesPage />,
  'closing-stock-dealers': () => <ClosingStockDealersPage />,
  'closing-stock-raw': () => <ClosingStockRawPage />,
  'stock-ledger-premises': () => <StockLedgerPremisesPage />,
  'stock-ledger-dealers': () => <StockLedgerDealersPage />,
  'loan-workflow': (ctx) => <LoanWorkflowPage user={ctx.user} />,
  'loan-application-view': (ctx) => <LoanApplicationViewPage user={ctx.user} />,
  'chfpl-repo-vehicles': () => <ChfplRepoVehiclesPage />,
  'purchase-register': () => <PurchaseRegisterPage />,
  'production-register': () => <ProductionRegisterPage />,
  'delivery-challan-register': () => <DeliveryChallanRegisterPage />,
  'sale-register': () => <SaleRegisterPage />,
  'gst-register': () => <GstRegisterPage />,
  'hypothecation-register': () => <HypothecationRegisterPage />,
  'vehicle-no-register': () => <VehicleNoRegisterPage />,
  'payment-receivable-report': () => <PaymentReceivablePage />,
  'customer-expense-ledger': () => <CustomerExpenseLedgerReportPage />,
  'incentive-register': () => <IncentiveRegisterPage />,
  'insurance-rto': () => <InsuranceRtoRegisterPage />,
  'rto-expense': () => <RtoExpenseRegisterPage />,
  'bank-ledger': () => <BankLedgerPage />,
  'subsidy-report': () => <SubsidyReportPage />,
  'balance-sheet': () => <BalanceSheetPage />,
  'profit-loss': () => <ProfitLossPage />,
  'audit-report': () => <AuditReportPage />,
  ledger: () => <LedgerPage />,
  'day-book': () => <DayBookPage />,
  'ledger-v': () => <LedgerVPage />,
  'backup-restore': ({ user }) => <BackupRestorePage user={user} />,
  'hr-attendance': () => <HRAttendancePage />,
};

function PageRouter({ active: rawActive, setActive, optionUserId, setOptionUserId, user }) {
  // Vouchers tab keys (v-*) open the existing page of the same voucher.
  if (CUSTOM_PAGES[rawActive] && rawActive.startsWith('v-')) return CUSTOM_PAGES[rawActive]({ setActive, optionUserId, setOptionUserId, user });
  const active = VOUCHER_PAGE_FOR[rawActive] || rawActive;
  if (active === 'dashboard') return <Dashboard setActive={setActive} user={user} />;
  if (SIMPLE_MASTERS[active]) return <SimpleMasterPage kind={active} setActive={setActive} />;
  const render = CUSTOM_PAGES[active];
  if (render) return render({ setActive, optionUserId, setOptionUserId, user });
  return <PlaceholderPage label={active} />;
}

// lib/menu (keyForPath/routeForKey) abhi 'vehicle-no-register' nahi jaanta, isliye refresh/click par Dashboard khul jata tha.
const EXTRA_KEYS = ['vehicle-no-register'];
const keyFromPath = (path) => { const k = String(path || '').replace(/^\//, ''); return EXTRA_KEYS.includes(k) ? k : keyForPath(path); };
const pathFromKey = (key) => (EXTRA_KEYS.includes(key) ? '/' + key : routeForKey(key).path);

export default function App() {
  const [user, setUser] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [active, setActive] = useState('dashboard');
  const [optionUserId, setOptionUserId] = useState(null);

  useEffect(() => {
    const syncFromUrl = () => setActive(keyFromPath(window.location.hash.replace(/^#/, '') || '/dashboard'));
    syncFromUrl();
    window.addEventListener('hashchange', syncFromUrl);
    return () => window.removeEventListener('hashchange', syncFromUrl);
  }, []);

  const navigate = (key) => {
    const path = pathFromKey(key);
    if (window.location.hash.replace(/^#/, '') === path) setActive(key);
    else window.location.hash = path;
  };

  useEffect(() => {
    const token = getToken();
    if (!token) { setCheckedAuth(true); return; }
    const portal = getPortalKind();
    const restore = portal === 'dealer'
      ? get('/dealer/me', { preserveAuthOn401: true }).then((result) => {
          const dealer = result?.dealer || result;
          if (!dealer) throw new Error('Dealer session could not be restored');
          window.localStorage.setItem('grd_dealer_profile', JSON.stringify(dealer));
          setUser({ ...dealer, is_dealer: true });
        })
      : portal === 'staff'
        ? get('/auth/me', { preserveAuthOn401: true }).then((result) => setUser(result?.user || result))
        : get('/auth/me', { preserveAuthOn401: true }).then((result) => setUser(result?.user || result))
            .catch(() => get('/dealer/me', { preserveAuthOn401: true }).then((dealer) => {
              setPortalKind('dealer');
              window.localStorage.setItem('grd_dealer_profile', JSON.stringify(dealer));
              setUser({ ...dealer, is_dealer: true });
            }));

    restore.catch(() => {
      setToken(null);
      setPortalKind(null);
      window.localStorage.removeItem('grd_dealer_profile');
      setUser(null);
    }).finally(() => setCheckedAuth(true));
  }, []);

  if (!checkedAuth) return <div className="appLoadingScreen"><div className="appLoadingCard"><div className="appLoadingMark">G</div><b>G.R.D. MOTORS</b><span>Restoring your session…</span></div></div>;
  if (!user) return <GRDLogin onLogin={setUser} />;
  if (user.is_dealer) return <DealerPortal dealer={user} onLogout={() => { setPortalKind(null); setToken(null); try { window.localStorage.removeItem('grd_dealer_profile'); } catch {} setUser(null); }} />;

  return (
    <Shell active={active} setActive={navigate} user={user} onLogout={() => { setToken(null); setUser(null); }}>
      <PageRouter active={active} setActive={setActive} optionUserId={optionUserId} setOptionUserId={setOptionUserId} user={user} />
    </Shell>
  );
}

// Production deploy trigger: admin sidebar re-login fix is ready.

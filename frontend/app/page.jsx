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
import { TaxInvoicePage } from '../components/TaxInvoicePage';
import { CreditNotePage } from '../components/CreditNotePage';
import { PurchaseBillPage } from '../components/PurchaseBillPage';
import { OldRickshawPage, BatterySwapVoucherPage, BatteryWithdrawalPage, BatteryDeliveryChallanPage, BatteryAdditionPage, JournalStockPage } from '../components/MinorVoucherPages';
import { ExpensePaymentVoucherPage } from '../components/ExpensePaymentVoucherPage';
import { RepairServiceVoucherPage } from '../components/RepairServiceVoucherPage';
import { IncentiveRegisterPage } from '../components/IncentiveRegisterPage';
import { InsuranceRtoRegisterPage } from '../components/InsuranceRtoRegisterPage';
import { BillingPendingSalesPage } from '../components/BillingPendingSalesPage';
import { VahanInventoryPage } from '../components/VahanInventoryPage';
import { OldRickshawChallanPage } from '../components/OldRickshawChallanPage';
import { CashAtDealerPage } from '../components/CashAtDealerPage';
import { DealerCashReceiptPage } from '../components/DealerCashReceiptPage';
import { ClosingStockPremisesPage, ClosingStockDealersPage, ClosingStockRawPage, StockLedgerPremisesPage, StockLedgerDealersPage } from '../components/StockPages';
import { PurchaseRegisterPage, ProductionRegisterPage, DeliveryChallanRegisterPage, SaleRegisterPage, GstRegisterPage, HypothecationRegisterPage, PaymentReceivablePage, SubsidyReportPage, LedgerPage, DayBookPage, LedgerVPage } from '../components/ReportPages';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { BackupRestorePage } from '../components/BackupRestorePage';
import { BatteryRegisterPage } from '../components/BatteryRegisterPage';
import { FactoryCheckReportPage } from '../components/FactoryCheckReportPage';
import { DebitNotePage } from '../components/DebitNotePage';
import { OldRickshawInventoryPage } from '../components/OldRickshawInventoryPage';
import { DealerPortal } from '../components/DealerPortal';
import { HRAttendancePage } from '../components/HRAttendancePage';
import { ProfilePage } from '../components/ProfilePage';
import { BalanceSheetPage, ProfitLossPage } from '../components/FinancialReportsPage';
import { LoanWorkflowPage } from '../components/LoanWorkflowPage';
import { LoanApplicationViewPage } from '../components/LoanApplicationViewPage';
import { SIMPLE_MASTERS, keyForPath, routeForKey } from '../lib/menu';

const CUSTOM_PAGES = {
  'showroom-new-stock': () => <ClosingStockPremisesPage />,
  'showroom-old-stock': () => <OldRickshawPage />,
  'showroom-battery-stock': () => <PlaceholderPage label="Battery Stock" />,
  'showroom-seized-vehicle': () => <VahanInventoryPage />,
  'showroom-all-customers': () => <PlaceholderPage label="All Customers" />,
  'showroom-all-receipt': () => <DealerCashReceiptPage />,
  'showroom-expenses-reports': () => <PlaceholderPage label="Expenses Reports" />,
  'showroom-cashbook': () => <DayBookPage />,
  'showroom-cash-handover': () => <CashAtDealerPage />,
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
  'cash-at-dealer': () => <CashAtDealerPage />,
  'dealer-cash-receipt': () => <DealerCashReceiptPage />,
  'production-voucher': () => <ProductionVoucherPage />,
  'delivery-challan': () => <DeliveryChallanPage />,
  'tax-invoice': () => <TaxInvoicePage />,
  'credit-note': () => <CreditNotePage />,
  'debit-note': () => <DebitNotePage />,
  'old-rickshaw': () => <OldRickshawPage />,
  'battery-swap': () => <BatterySwapVoucherPage />,
  'battery-withdrawal': () => <BatteryWithdrawalPage />,
  'battery-delivery-challan': () => <BatteryDeliveryChallanPage />,
  'battery-addition': () => <BatteryAdditionPage />,
  'battery-register': () => <BatteryRegisterPage />,
  'factory-check-report': () => <FactoryCheckReportPage />,
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
  'purchase-register': () => <PurchaseRegisterPage />,
  'production-register': () => <ProductionRegisterPage />,
  'delivery-challan-register': () => <DeliveryChallanRegisterPage />,
  'sale-register': () => <SaleRegisterPage />,
  'gst-register': () => <GstRegisterPage />,
  'hypothecation-register': () => <HypothecationRegisterPage />,
  'payment-receivable-report': () => <PaymentReceivablePage />,
  'incentive-register': () => <IncentiveRegisterPage />,
  'insurance-rto': () => <InsuranceRtoRegisterPage />,
  'subsidy-report': () => <SubsidyReportPage />,
  'balance-sheet': () => <BalanceSheetPage />,
  'profit-loss': () => <ProfitLossPage />,
  ledger: () => <LedgerPage />,
  'day-book': () => <DayBookPage />,
  'ledger-v': () => <LedgerVPage />,
  'backup-restore': ({ user }) => <BackupRestorePage user={user} />,
  'hr-attendance': () => <HRAttendancePage />,
};

function PageRouter({ active, setActive, optionUserId, setOptionUserId, user }) {
  if (active === 'dashboard') return <Dashboard setActive={setActive} user={user} />;
  if (SIMPLE_MASTERS[active]) return <SimpleMasterPage kind={active} setActive={setActive} />;
  const render = CUSTOM_PAGES[active];
  if (render) return render({ setActive, optionUserId, setOptionUserId, user });
  return <PlaceholderPage label={active} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [active, setActive] = useState('dashboard');
  const [optionUserId, setOptionUserId] = useState(null);

  useEffect(() => {
    const syncFromUrl = () => setActive(keyForPath(window.location.hash.replace(/^#/, '') || '/dashboard'));
    syncFromUrl();
    window.addEventListener('hashchange', syncFromUrl);
    return () => window.removeEventListener('hashchange', syncFromUrl);
  }, []);

  const navigate = (key) => {
    const path = routeForKey(key).path;
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
        ? get('/auth/me', { preserveAuthOn401: true }).then(setUser)
        : get('/auth/me', { preserveAuthOn401: true }).then(setUser)
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

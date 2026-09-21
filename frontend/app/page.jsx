'use client';
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
import {
  ClosingStockPremisesPage, ClosingStockDealersPage, ClosingStockRawPage,
  StockLedgerPremisesPage, StockLedgerDealersPage,
} from '../components/StockPages';
import {
  PurchaseRegisterPage, ProductionRegisterPage, DeliveryChallanRegisterPage, SaleRegisterPage,
  GstRegisterPage, HypothecationRegisterPage, PaymentReceivablePage, SubsidyReportPage,
  LedgerPage, DayBookPage, LedgerVPage,
} from '../components/ReportPages';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { DealerPortal } from '../components/DealerPortal';
import { HRAttendancePage } from '../components/HRAttendancePage';
import { BalanceSheetPage, ProfitLossPage } from '../components/FinancialReportsPage';
import { LoanWorkflowPage } from '../components/LoanWorkflowPage';
import { SIMPLE_MASTERS } from '../lib/menu';

const CUSTOM_PAGES = {
  company: () => <CompanyMasterPage />,
  dealer: () => <DealerPage />,
  product: () => <ProductPage />,
  'production-formula': () => <ProductionFormulaPage />,
  'chassis-master': () => <ChassisMasterPage />,
  user: (ctx) => <UserPage setActive={ctx.setActive} setOptionUserId={ctx.setOptionUserId} />,
  'option-setting': (ctx) => <OptionSettingPage userId={ctx.optionUserId} />,
  password: () => <PasswordPage />,
  'purchase-bills': () => <PurchaseBillPage />,
  'billing-pending-sales': () => <BillingPendingSalesPage />,
  'vahan-inventory': () => <VahanInventoryPage />,
  'cash-at-dealer': () => <CashAtDealerPage />,
  'dealer-cash-receipt': () => <DealerCashReceiptPage />,
  'production-voucher': () => <ProductionVoucherPage />,
  'delivery-challan': () => <DeliveryChallanPage />,
  'tax-invoice': () => <TaxInvoicePage />,
  'credit-note': () => <CreditNotePage />,
  'old-rickshaw': () => <OldRickshawPage />,
  'battery-swap': () => <BatterySwapVoucherPage />,
  'battery-withdrawal': () => <BatteryWithdrawalPage />,
  'battery-delivery-challan': () => <BatteryDeliveryChallanPage />,
  'battery-addition': () => <BatteryAdditionPage />,
  'journal-stock': () => <JournalStockPage />,
  'expense-payment-voucher': () => <ExpensePaymentVoucherPage />,
  'repair-service-voucher': () => <RepairServiceVoucherPage />,
  'old-rickshaw-challan': () => <OldRickshawChallanPage />,
  'closing-stock-premises': () => <ClosingStockPremisesPage />,
  'closing-stock-dealers': () => <ClosingStockDealersPage />,
  'closing-stock-raw': () => <ClosingStockRawPage />,
  'stock-ledger-premises': () => <StockLedgerPremisesPage />,
  'stock-ledger-dealers': () => <StockLedgerDealersPage />,
  'loan-workflow': (ctx) => <LoanWorkflowPage user={ctx.user} />,
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
  'backup-restore': () => <PlaceholderPage label="Backup / Restore" />,
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
    const token = getToken();
    if (!token) { setCheckedAuth(true); return; }

    // Keep the portal type beside the token so a browser refresh can restore
    // the correct dashboard directly instead of probing the other auth system.
    const portal = getPortalKind();
    const restore = portal === 'dealer'
      ? get('/dealer/me', { preserveAuthOn401: true }).then((dealer) => setUser({ ...dealer, is_dealer: true }))
      : portal === 'staff'
        ? get('/auth/me', { preserveAuthOn401: true }).then(setUser)
        : get('/auth/me', { preserveAuthOn401: true })
            .then(setUser)
            .catch(() => get('/dealer/me', { preserveAuthOn401: true }).then((dealer) => {
              setPortalKind('dealer');
              setUser({ ...dealer, is_dealer: true });
            }));

    restore
      .catch(() => {
        setToken(null);
        setPortalKind(null);
        setUser(null);
      })
      .finally(() => setCheckedAuth(true));
  }, []);

  if (!checkedAuth) return <div className="appLoadingScreen"><div className="appLoadingCard"><div className="appLoadingMark">G</div><b>G.R.D. MOTORS</b><span>Restoring your session…</span></div></div>;
  if (!user) return <GRDLogin onLogin={setUser} />;
  if (user.is_dealer) return <DealerPortal dealer={user} onLogout={() => { setPortalKind(null); setToken(null); setUser(null); }} />;

  return (
    <Shell active={active} setActive={setActive} user={user} onLogout={() => { setToken(null); setUser(null); }}>
      <PageRouter active={active} setActive={setActive} optionUserId={optionUserId} setOptionUserId={setOptionUserId} user={user} />
    </Shell>
  );
}

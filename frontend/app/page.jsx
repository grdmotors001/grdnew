'use client';
import { useEffect, useState } from 'react';
import { get, setToken, getToken } from '../lib/api';
import { Login, Shell } from '../components/Shell';
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
import { PurchaseBillPage } from '../components/PurchaseBillPage';
import { OldRickshawPage, BatterySwapVoucherPage, BatteryWithdrawalPage, BatteryDeliveryChallanPage, JournalStockPage } from '../components/MinorVoucherPages';
import { ExpensePaymentVoucherPage } from '../components/ExpensePaymentVoucherPage';
import { IncentiveRegisterPage } from '../components/IncentiveRegisterPage';
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
  'production-voucher': () => <ProductionVoucherPage />,
  'delivery-challan': () => <DeliveryChallanPage />,
  'tax-invoice': () => <TaxInvoicePage />,
  'old-rickshaw': () => <OldRickshawPage />,
  'battery-swap': () => <BatterySwapVoucherPage />,
  'battery-withdrawal': () => <BatteryWithdrawalPage />,
  'battery-delivery-challan': () => <BatteryDeliveryChallanPage />,
  'journal-stock': () => <JournalStockPage />,
  'expense-payment-voucher': () => <ExpensePaymentVoucherPage />,
  'closing-stock-premises': () => <ClosingStockPremisesPage />,
  'closing-stock-dealers': () => <ClosingStockDealersPage />,
  'closing-stock-raw': () => <ClosingStockRawPage />,
  'stock-ledger-premises': () => <StockLedgerPremisesPage />,
  'stock-ledger-dealers': () => <StockLedgerDealersPage />,
  'purchase-register': () => <PurchaseRegisterPage />,
  'production-register': () => <ProductionRegisterPage />,
  'delivery-challan-register': () => <DeliveryChallanRegisterPage />,
  'sale-register': () => <SaleRegisterPage />,
  'gst-register': () => <GstRegisterPage />,
  'hypothecation-register': () => <HypothecationRegisterPage />,
  'payment-receivable-report': () => <PaymentReceivablePage />,
  'incentive-register': () => <IncentiveRegisterPage />,
  'subsidy-report': () => <SubsidyReportPage />,
  ledger: () => <LedgerPage />,
  'day-book': () => <DayBookPage />,
  'ledger-v': () => <LedgerVPage />,
  'backup-restore': () => <PlaceholderPage label="Backup / Restore" />,
  'hr-attendance': () => <HRAttendancePage />,
};

function PageRouter({ active, setActive, optionUserId, setOptionUserId, user }) {
  if (active === 'dashboard') return <Dashboard setActive={setActive} user={user} />;
  if (SIMPLE_MASTERS[active]) return <SimpleMasterPage kind={active} />;
  const render = CUSTOM_PAGES[active];
  if (render) return render({ setActive, optionUserId, setOptionUserId });
  return <PlaceholderPage label={active} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [active, setActive] = useState('dashboard');
  const [optionUserId, setOptionUserId] = useState(null);

  useEffect(() => {
    if (!getToken()) { setCheckedAuth(true); return; }
    get('/auth/me', { preserveAuthOn401: true })
      .then(setUser)
      .catch(() => get('/dealer/me')
        .then((dealer) => setUser({ ...dealer, is_dealer: true }))
        .catch(() => setToken(null)))
      .finally(() => setCheckedAuth(true));
  }, []);

  if (!checkedAuth) return null;
  if (!user) return <Login onLogin={setUser} />;
  if (user.is_dealer) return <DealerPortal dealer={user} onLogout={() => { setToken(null); setUser(null); }} />;

  return (
    <Shell active={active} setActive={setActive} user={user} onLogout={() => { setToken(null); setUser(null); }}>
      <PageRouter active={active} setActive={setActive} optionUserId={optionUserId} setOptionUserId={setOptionUserId} />
    </Shell>
  );
}

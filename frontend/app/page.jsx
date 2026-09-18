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
import { OldRickshawPage, BatteryDeliveryChallanPage, JournalStockPage } from '../components/MinorVoucherPages';
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
  'battery-delivery-challan': () => <BatteryDeliveryChallanPage />,
  'journal-stock': () => <JournalStockPage />,
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
  'subsidy-report': () => <SubsidyReportPage />,
  ledger: () => <LedgerPage />,
  'day-book': () => <DayBookPage />,
  'ledger-v': () => <LedgerVPage />,
  'backup-restore': () => <PlaceholderPage label="Backup / Restore" />,
};

function PageRouter({ active, setActive, optionUserId, setOptionUserId }) {
  if (active === 'dashboard') return <Dashboard setActive={setActive} />;
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
    get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setCheckedAuth(true));
  }, []);

  if (!checkedAuth) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <Shell active={active} setActive={setActive} user={user} onLogout={() => { setToken(null); setUser(null); }}>
      <PageRouter active={active} setActive={setActive} optionUserId={optionUserId} setOptionUserId={setOptionUserId} />
    </Shell>
  );
}

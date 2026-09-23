// Mirrors backend/menu_config.py exactly — same keys, same grouping — so the
// sidebar matches the original desktop software's menu structure
// (Setup | Vouchers | Stock | Reports | Utilities). The original desktop app
// numbered/lettered each item (1., 2., ... A., B., ...); those prefixes are
// intentionally dropped here since they don't carry any meaning in this UI.
export const MENU = {
  Setup: [
    ['company', 'Company Details (GST / Email / Mobile / Website)'],
    ['dealer', 'Dealer Master'],
    ['party', 'Party Master (Raw Material Purchase Parties)'],
    ['product', 'Product Master'],
    ['chassis-master', 'Chassis Master'],
    ['battery-maker', 'Battery Maker Master'],
    ['rto', 'RTO Master'],
    ['financer', 'Financer Master'],
    ['production-formula', 'Production Formula'],
    ['mechanic', 'Mechanic Master'],
    ['user', 'User Master'],
    ['option-setting', 'User wise Option Setting'], ['expense-head', 'Expense Head'],
    ['bank', 'Bank Details'],
    ['colour', 'Colour Master'],
  ],
  Vouchers: [
    ['purchase-bills', 'Purchase Bills'],
    ['production-voucher', 'Production Voucher'],
    ['delivery-challan', 'E-Rickshaw Delivery Challan'],
    ['tax-invoice', 'Tax Invoice'], ['credit-note', 'Credit Note'],
    ['old-rickshaw', 'Old Rickshaw'],
    ['battery-swap', 'Battery Swap / Exchange Voucher'],
    ['battery-withdrawal', 'Battery Withdrawal'],
    ['battery-addition', 'Battery Fit to Rickshaw'],
    ['battery-delivery-challan', 'Battery Delivery Challan'],
    ['repair-service-voucher', 'Repair & Service Voucher'],
  ],
  Expenses: [
    ['insurance-rto', 'Insurance / RTO Expense'],
  ],
  Stock: [
    ['closing-stock-premises', 'Closing Stock - Premises'],
    ['closing-stock-dealers', 'Closing Stock - with Dealers'],
    ['closing-stock-raw', 'Closing Stock - Raw Material'],
    ['stock-ledger-premises', 'Stock Ledger - Premises'],
    ['stock-ledger-dealers', 'Stock Ledger - with Dealers'],
  ],
  Reports: [
    ['purchase-register', 'Purchase Register'],
    ['production-register', 'Production Register'],
    ['delivery-challan-register', 'Delivery Challan Register'],
    ['sale-register', 'Sale Register'],
    ['gst-register', 'GST Register'],
    ['hypothecation-register', 'Hypothecation Register'],
    ['payment-receivable-report', "Payment Rec'able Report"],
    ['incentive-register', 'Incentive Register'], ['insurance-rto', 'Insurance / RTO Expense'],
    ['subsidy-report', 'Subsidy Report'],
    ['ledger', 'Ledger'],
    ['day-book', 'Day Book Entry'],
    ['ledger-v', 'Ledger V'],
    ['password', 'Password'],
  ],
  Utilities: [
    ['backup-restore', 'Backup / Restore'],
    ['hr-attendance', 'HR • Attendance & Salary'],
  ],
};


// Admin navigation: keep the sidebar at the main functional level and show
// the selected group's modules in the sticky header. This prevents a long
// list of individual admin options while keeping every existing module reachable.

export const SHOWROOM_SECTIONS = [
  { label: 'Stock', items: [
    ['showroom-new-stock', 'New Stock'],
    ['showroom-old-stock', 'Old Stock'],
    ['showroom-battery-stock', 'Battery Stock'],
  ]},
  { label: 'Record', items: [
    ['delivery-challan', 'Delivery Challan'],
    ['tax-invoice', 'Tax Invoice'],
    ['showroom-seized-vehicle', 'Seized Vehicle'],
  ]},
  { label: 'Report', items: [
    ['showroom-all-customers', 'All Customers'],
    ['showroom-all-receipt', 'All Receipt'],
    ['showroom-expenses-reports', 'Expenses Reports'],
  ]},
  { label: 'Daybook', items: [
    ['showroom-cashbook', 'Cashbook'],
    ['dealer-cash-receipt', 'Receipt Create'],
    ['expense-payment-voucher', 'Expenses Create'],
    ['showroom-cash-handover', 'Cash Handover'],
    ['showroom-online-payment', 'Online Payment'],
  ]},
  { label: 'Pending Sales', items: [
    ['billing-pending-sales', 'Pending Sales'],
  ]},
  { label: 'Old Rickshaw Sale', items: [
    ['old-rickshaw', 'Old Rickshaw Sale'],
  ]},
  { label: 'Ledger', items: [
    ['ledger', 'Ledger'],
  ]},
  { label: 'Battery Adjustment', items: [
    ['battery-swap', 'Battery Exchange'],
    ['battery-withdrawal', 'Battery Withdrawal'],
    ['battery-addition', 'Battery Fitting'],
  ]},
];

export const NAV_GROUPS = {
  // Showroom is a separate dealer/showroom portal. It must not appear as a
  // staff/admin sidebar group; staff access is controlled by allowed_modules.
  Masters: [
    ['dealer', 'Dealer Master'], ['party', 'Party Master'],
    ['product', 'Product Master'], ['chassis-master', 'Chassis Master'],
    ['production-formula', 'Production Formula'],
    ['mechanic', 'Mechanic Master'], ['fabricator', 'Fabricator Master'], ['salesman', 'Salesman Master'], ['bank', 'Bank Details'], ['colour', 'Colour Master'],
  ],
  Factory: [
    ['repair-service-voucher', 'Repair & Service Voucher'], ['old-rickshaw-challan', 'Old Rickshaw Challan Voucher'], ['journal-stock', 'Journal Stock'],
    ['production-voucher', 'Production Voucher'], ['delivery-challan', 'Delivery Challan'],
  ],
  Battery: [
    ['battery-maker', 'Battery Maker'],
    ['battery-delivery-challan', 'Battery Challan'],
    ['battery-withdrawal', 'Battery Remove'],
    ['battery-swap', 'Battery Swap'],
    ['battery-addition', 'Battery Fit'],
  ],
  'Sales & Billing': [
    ['purchase-bills', 'Purchase Bills'], ['billing-pending-sales', 'Pending Bills / Billing'], ['tax-invoice', 'Tax Invoice'],
    ['old-rickshaw', 'Old Rickshaw'], ['vahan-inventory', 'Vahan Inventory'],
    ['rto', 'RTO Master'], ['financer', 'Financer Master'],
  ],
  Expenses: [
    ['expense-payment-voucher', 'Expense Payment Voucher'],
    ['cash-at-dealer', 'Showroom Branch'],
    ['insurance-rto', 'Insurance / RTO Expense'],
  ],
  Accounts: [
    ['ledger', 'Ledger'], ['ledger-v', 'Ledger V'], ['gst-register', 'GST Register'], ['day-book', 'Day Book'],
    ['balance-sheet', 'Balance Sheet'], ['profit-loss', 'Profit & Loss A/c'],
  ],
  Inventory: [
    ['closing-stock-premises', 'Closing Stock - Premises'], ['closing-stock-dealers', 'Closing Stock - Dealers'],
    ['closing-stock-raw', 'Closing Stock - Raw Material'], ['stock-ledger-premises', 'Stock Ledger - Premises'],
    ['stock-ledger-dealers', 'Stock Ledger - Dealers'],
  ],
  HR: [
    ['company', 'Company Details'], ['user', 'User Master'], ['hr-attendance', 'Attendance & Salary'],
  ],
  Reports: [
['purchase-register', 'Purchase Register'],
    ['delivery-challan-register', 'Delivery Challan Register'], ['sale-register', 'Sale Register'],
    ['payment-receivable-report', 'Payment Receivable'], ['hypothecation-register', 'Hypothecation Register'],
    ['subsidy-report', 'Subsidy Report'], ['incentive-register', 'Incentive Register'],
  ],
  System: [
    ['profile', 'My Profile'], ['password', 'Password'],
  ],
};

// Central routing registry: every menu key gets a stable client route.
// Menu placement and page rendering stay separate, so an item can be moved,
// duplicated in another group, or renamed without changing its page component.
export const ROUTES = {
  dashboard: { path: '/dashboard', title: 'Dashboard' },
  ...Object.fromEntries(
    Object.values(NAV_GROUPS).flat().map(([key, label]) => [
      key,
      { path: '/' + key, title: label },
    ])
  ),
  ...Object.fromEntries(
    SHOWROOM_SECTIONS.flatMap(section => section.items).map(([key, label]) => [
      key,
      { path: '/' + key, title: label },
    ])
  ),
  'showroom-new-stock': { path: '/showroom/new-stock', title: 'New Stock' },
  'showroom-old-stock': { path: '/showroom/old-stock', title: 'Old Stock' },
  'showroom-battery-stock': { path: '/showroom/battery-stock', title: 'Battery Stock' },
  'showroom-seized-vehicle': { path: '/showroom/seized-vehicle', title: 'Seized Vehicle' },
  'showroom-all-customers': { path: '/showroom/all-customers', title: 'All Customers' },
  'showroom-all-receipt': { path: '/showroom/all-receipt', title: 'All Receipt' },
  'showroom-expenses-reports': { path: '/showroom/expenses-reports', title: 'Expenses Reports' },
  'showroom-cashbook': { path: '/showroom/cashbook', title: 'Cashbook' },
  'showroom-cash-handover': { path: '/showroom/cash-handover', title: 'Cash Handover' },
  'showroom-online-payment': { path: '/showroom/online-payment', title: 'Online Payment' },
};

export function routeForKey(key) {
  return ROUTES[key] || { path: '/' + key, title: key };
}

export function keyForPath(path) {
  const clean = String(path || '').split('?')[0].replace(/\\/+$/, '') || '/';
  const found = Object.entries(ROUTES).find(([, route]) => route.path === clean);
  return found ? found[0] : 'dashboard';
}

export function groupForKey(key) {
  for (const [group, items] of Object.entries(NAV_GROUPS)) {
    if (items.some(([k]) => k === key)) return group;
  }
  return 'Dashboard';
}

export function labelFor(key) {
  for (const items of Object.values(MENU)) {
    for (const [k, l] of items) if (k === key) return l;
  }
  return key;
}

// Simple masters, keyed exactly like backend SIMPLE_KINDS, with the field
// lists from menu_config.py's per-module `fields`.
export const SIMPLE_MASTERS = {
  party: { label: 'Party Master', fields: [['name', 'Name', 'text'], ['address', 'Address', 'text'], ['mobile', 'Mobile No.', 'text'], ['extra', 'GSTIN', 'text']] },
  'battery-maker': { label: 'Battery Maker Master', fields: [['name', 'Battery Maker Name', 'text']] },
  rto: { label: 'RTO Master', fields: [['name', 'RTO Name', 'text'], ['code', 'RTO Code', 'text'], ['address', 'Address', 'text']] },
  financer: { label: 'Financer Master', fields: [['name', 'Name', 'text'], ['address', 'Address', 'text']] },
  mechanic: { label: 'Mechanic Master', fields: [['name', 'Mechanic Name', 'text']] },
  fabricator: { label: 'Fabricator Master', fields: [['name', 'Fabricator Name', 'text']] },
  salesman: { label: 'Salesman Master', fields: [['name', 'Salesman Name', 'text']] },
  fabricator: { label: 'Fabricator Master', fields: [['name', 'Fabricator Name', 'text']] },
  bank: { label: 'Bank Details', fields: [['name', 'Bank Name', 'text'], ['account_no', 'Account No.', 'text'], ['ifsc', 'IFSC', 'text'], ['is_default', 'Default (auto-fills on new Invoices)', 'checkbox']] },
  colour: { label: 'Colour Master', fields: [['name', 'Colour', 'text'], ['code', 'Colour Code', 'text'], ['color_hex', 'RGB / HEX', 'color'], ['color_hex2', 'Second Tone RGB / HEX', 'color'], ['is_double_tone', 'Double Tone', 'checkbox']] },
};

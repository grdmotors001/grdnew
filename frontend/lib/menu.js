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
    ['battery-maker', 'Battery Maker Master'], ['battery-register', 'Battery Register'],
    ['rto', 'RTO Master'],
    ['financer', 'Financer Master'],
    ['production-formula', 'Production Formula'],
    ['mechanic', 'Mechanic Master'],
    ['user', 'User Master'],
    ['option-setting', 'User wise Option Setting'], ['expense-head', 'Account Head Master'], ['expense-type', 'Expense Type Master'],
    ['bank', 'Bank Details'],
    ['colour', 'Colour Master'],
  ],
  Vouchers: [
    ['purchase-bills', 'Purchase Bills'],
    ['production-voucher', 'Production Voucher'],
    ['factory-check-report', 'Factory Check Report'],
    ['daily-raw-material-checklist', 'Daily Raw Material Issue'],
    ['delivery-challan', 'E-Rickshaw Delivery Challan'], ['challan-shift', 'Challan Shift'],
    ['tax-invoice', 'Tax Invoice'], ['credit-note', 'Credit Note'],
    ['old-rickshaw', 'Old Rickshaw'],
    ['battery-swap', 'Battery Swap / Exchange Voucher'],
    ['battery-withdrawal', 'Battery Withdrawal'],
    ['battery-addition', 'Battery Fit to Rickshaw'], ['battery-fit', 'Factory → Dealer Battery Fit'],
    ['battery-delivery-challan', 'Battery Delivery Challan'],
    ['repair-service-voucher', 'Repair & Service Voucher'],
  ],
  Expenses: [
    ['insurance-rto', 'Insurance Register'], ['rto-expense', 'RTO Expense Register'],
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
    ['incentive-register', 'Incentive Register'], ['insurance-rto', 'Insurance Register'], ['rto-expense', 'RTO Expense Register'],
    ['subsidy-report', 'Subsidy Report'],
    ['ledger', 'Ledger'],
    ['day-book', 'Bank & Cash'],
    ['ledger-v', 'Ledger V'],
    ['password', 'Password'],
  ],
  Utilities: [
    ['notifications', 'Notifications'],
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
  // Tally-style Vouchers tab. Every entry has its OWN key (v-*) that renders an
  // already existing page (see VOUCHER_PAGE_FOR in this file / CUSTOM_PAGES in
  // app/page.jsx), so the top strip stays inside "Vouchers" and does not jump to
  // the group the original page lives in. Order = as requested. F-key = keyboard shortcut.
  Vouchers: [
    ['v-contra', 'F4 · Contra'],
    ['v-payment', 'F5 · Payment'],
    ['v-receipt', 'F6 · Receipt'],
    ['v-journal', 'F7 · Stock Journal'],
    ['v-sales', 'F8 · Sales'],
    ['v-purchase', 'F9 · Purchase'],
    ['v-f10', 'F10 · Journal'],
    ['v-credit-note', 'F1 · Credit Note'],
    ['v-debit-note', 'F2 · Debit Note'],
    ['v-production', 'F3 · Production'],
  ],
  Factory: [
    ['debit-note', 'Debit Note'],
    ['repair-service-voucher', 'Repair & Service Voucher'], ['old-rickshaw-challan', 'Old Rickshaw Challan Voucher'], ['journal-stock', 'Journal Stock'],
    ['production-voucher', 'Production Voucher'], ['daily-raw-material-checklist', 'Daily Raw Material Issue'], ['delivery-challan', 'Delivery Challan'], ['challan-shift', 'Challan Shift'],
  ],
  Battery: [
    ['battery-maker', 'Battery Maker'], ['battery-register', 'Battery Register'],
    ['battery-delivery-challan', 'Battery Challan'],
    ['battery-withdrawal', 'Battery Remove'],
    ['battery-swap', 'Battery Swap'],
    ['battery-addition', 'Battery Fit'],
  ],
  'Sales & Billing': [
    ['loan-application-view', 'Loan Application'], ['billing-pending-sales', 'Pending Bills / Billing'], ['tax-invoice', 'Tax Invoice'], ['credit-note', 'Credit Note'], ['purchase-bills', 'Purchase Bills'],
    ['old-rickshaw', 'Old Rickshaw'], ['vahan-inventory', 'Vahan Inventory'],
    ['rto', 'RTO Master'], ['financer', 'Financer Master'],
  ],
  Expenses: [
    ['expense-type', 'Expense Type Master'], ['expense-head', 'Account Head Master'],
    ['expense-payment-voucher', 'Expense Payment Voucher'], ['rc-fee-voucher', 'RC Fee Voucher & RC Register'],
    ['cash-at-dealer', 'Showroom Cash'],
    ['showroom-stock', 'Showroom Stock'],
    ['insurance-rto', 'Insurance Register'], ['rto-expense', 'RTO Expense Register'],
  ],
  Cashier: [
    ['cashier-pending', 'Pending'], ['cashier-approved', 'Approved'], ['cashier-paid', 'Paid'],
    ['cashier-handover', 'Cash Handover'], ['cashier-all-receipts', 'All Receipts (Cash)'], ['cashier-receipt', 'F6 · Receipt (Cash)'],
  ],
  Accounts: [
    ['ledger', 'Ledger'], ['ledger-v', 'Ledger V'], ['gst-register', 'GST Register'], ['day-book', 'Bank & Cash'],
    ['balance-sheet', 'Balance Sheet'], ['profit-loss', 'Profit & Loss A/c'], ['sale-record', 'Record'],
  ],
  Inventory: [
    ['seized-stock', 'Seized Stock'],
    ['old-rickshaw-inventory', 'Old Rickshaw Inventory'],
    ['chfpl-repo-vehicles', 'CHFPL Repo Vehicles'],
    ['closing-stock-premises', 'Closing Stock - Premises'], ['closing-stock-dealers', 'Closing Stock - Dealers'],
    ['closing-stock-raw', 'Closing Stock - Raw Material'], ['stock-ledger-premises', 'Stock Ledger - Premises'],
    ['stock-ledger-dealers', 'Stock Ledger - Dealers'],
    ['daily-raw-material-checklist', 'Daily Raw Material Issue'],
  ],
  HR: [
    ['company', 'Company Details'], ['user', 'User Master'], ['hr-attendance', 'Attendance & Salary'],
  ],
  Reports: [
['purchase-register', 'Purchase Register'],
    ['delivery-challan-register', 'Delivery Challan Register'], ['sale-register', 'Sale Register'],
    ['payment-receivable-report', 'Payment Receivable'], ['customer-expense-ledger', 'Customer Expense / Complete Ledger'], ['hypothecation-register', 'Hypothecation Register'],
    ['subsidy-report', 'Subsidy Report'], ['audit-report', 'User Activity / Audit Report'], ['incentive-register', 'Incentive Register'],
  ],
  System: [
    ['profile', 'My Profile'], ['password', 'Password'],
    ['nav-settings', 'Menu / Tabs Settings'],
  ],
};

// Voucher tab: F-key -> menu key, and menu key -> existing page's module key
// (used for permission check: a user who may open Tax Invoice may open F8 Sales).
export const VOUCHER_SHORTCUTS = {
  F4: 'v-contra', F5: 'v-payment', F6: 'v-receipt', F7: 'v-journal',
  F8: 'v-sales', F9: 'v-purchase', F10: 'v-f10', F1: 'v-credit-note', F2: 'v-debit-note', F3: 'v-production',
};
export const VOUCHER_PAGE_FOR = {
  // Showroom Stock ka permission Showroom Cash (cash-at-dealer) jaisa hi hai.
  'showroom-stock': 'cash-at-dealer',
  // v-contra / v-payment / v-receipt render their own page (see CUSTOM_PAGES in app/page.jsx).
  // v-payment & v-receipt use the Bank & Cash book, so they follow its permission ('day-book');
  // v-contra has no entry here on purpose: it is its own module key.
  'v-payment': 'day-book',
  'v-receipt': 'day-book',
  'v-journal': 'journal-stock',
  'v-sales': 'tax-invoice',
  'v-purchase': 'purchase-bills',
  'v-credit-note': 'credit-note',
  'v-debit-note': 'debit-note',
  'v-production': 'production-voucher',
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

// Flat catalog of every module key + label the admin can put into a sidebar
// tab, grouped by its original NAV_GROUPS section (just for organising the
// picker UI — a tab can mix items from any group).
export const NAV_CATALOG = Object.entries(NAV_GROUPS).map(([group, items]) => ({
  group,
  items: items.map(([key, label]) => ({ key, label })),
}));

// Icon names an admin can pick for a custom tab. Kept to a small fixed set
// that Shell.jsx already imports from lucide-react, so no extra bundle cost.
export const NAV_ICON_NAMES = [
  'Sliders', 'Factory', 'BatteryCharging', 'Receipt', 'Wallet', 'CreditCard',
  'Warehouse', 'Users', 'BarChart3', 'Settings2', 'Building2', 'Package',
  'Landmark', 'HandCoins', 'FlaskConical', 'Wrench', 'UserCog', 'Banknote',
  'ShoppingCart', 'Truck', 'Car', 'BookOpen', 'Store', 'Boxes',
  'ClipboardList', 'FileText', 'Gift', 'Calendar', 'Key', 'Database',
  'Palette', 'MessageCircle', 'LayoutDashboard',
];

// Given the admin-configured tabs from GET /nav-config (or null/undefined
// when none are set up yet), build the same shape as NAV_GROUPS —
// { [tabLabel]: [[key,label], ...] } — falling back to the static layout.
// Also returns iconByGroup, a { [tabLabel]: iconName } map for custom tabs.
// Bank Ledger ab Bank & Cash (day-book) page me merge ho gaya — DB me saved purana tab bhi na dikhe.
const HIDDEN_NAV_KEYS = new Set(['bank-ledger']);

export function buildNavGroups(customTabs) {
  // Built-in groups can now be persisted in NavTab rows so admins can
  // rename, hide, reorder and edit their modules. Truly custom tabs remain
  // additive and never remove the standard groups that are not configured.
  const configured = customTabs || [];
  const configuredBuiltIns = new Set(
    configured.filter((tab) => Object.prototype.hasOwnProperty.call(NAV_GROUPS, tab.key)).map((tab) => tab.key)
  );
  const groups = Object.fromEntries(
    Object.entries(NAV_GROUPS)
      .filter(([group]) => !configuredBuiltIns.has(group))
      .map(([group, items]) => [group, [...items]])
  );
  const iconByGroup = {};

  for (const tab of configured) {
    if (tab.hidden || !String(tab.label || '').trim()) continue;

    const label = String(tab.label).trim();
    const items = (tab.items || []).filter((key) => !HIDDEN_NAV_KEYS.has(key)).map((key) => [key, labelFor(key)]);

    if (Object.prototype.hasOwnProperty.call(NAV_GROUPS, tab.key)) {
      groups[label] = items;
    } else if (groups[label]) {
      const existingKeys = new Set(groups[label].map(([key]) => key));
      groups[label] = [
        ...groups[label],
        ...items.filter(([key]) => !existingKeys.has(key)),
      ];
    } else {
      groups[label] = items;
    }

    if (tab.icon) iconByGroup[label] = tab.icon;
  }

  // Always keep System reachable so Menu / Tabs Settings cannot disappear.
  if (!Object.values(groups).flat().some(([key]) => key === 'nav-settings')) {
    groups.System = NAV_GROUPS.System;
  }

  return { groups, iconByGroup };
}
// Permissions (User wise Option Setting) page ke liye: sidebar jaisa hi grouping (NAV_GROUPS / admin ke saved tabs),
// taaki admin har sub-option ko usi jagah se allow/deny kare jahan wo sidebar me dikhta hai.
// Vouchers tab ke F-key items (v-*) apne page ke permission key par map hote hain (VOUCHER_PAGE_FOR),
// isliye wahi key toggle hoti hai jo sidebar check karta hai. MENU ke jo keys sidebar me nahi hain wo "Other" me aate hain.
export function buildPermissionGroups(navGroups) {
  const out = {};
  const seen = new Set();
  for (const [group, items] of Object.entries(navGroups || NAV_GROUPS)) {
    const inGroup = new Set();
    for (const [key, label] of items) {
      const permKey = VOUCHER_PAGE_FOR[key] || key;
      if (inGroup.has(permKey)) continue;
      inGroup.add(permKey); seen.add(permKey);
      (out[group] = out[group] || []).push([permKey, String(label).replace(/^F\d+\s*·\s*/, '')]);
    }
  }
  const extra = [];
  for (const items of Object.values(MENU)) for (const [k, l] of items) if (!seen.has(k)) { seen.add(k); extra.push([k, l]); }
  if (extra.length) out['Other'] = extra;
  return out;
}
export function routeForKey(key) {
  return ROUTES[key] || { path: '/' + key, title: key };
}

export function keyForPath(path) {
  const clean = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
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
  // MENU (above) only mirrors the original desktop grouping; NAV_GROUPS has
  // since grown a few keys (debit-note, balance-sheet, fabricator, ...) that
  // never made it back into MENU, so fall back to it before giving up.
  for (const items of Object.values(NAV_GROUPS)) {
    for (const [k, l] of items) if (k === key) return l;
  }
  return key;
}

// Simple masters, keyed exactly like backend SIMPLE_KINDS, with the field
// lists from menu_config.py's per-module `fields`.
export const EXPENSE_TYPE_OPTIONS = [
  ['office_exp', 'Office Expense'], ['commission', 'Commission'], ['incentive', 'Incentive'],
  ['assembly', 'Assembly Work'], ['fabrication', 'Fabrication Work'], ['passing_exp', 'Passing Expense'],
  ['insurance', 'Insurance'], ['rto_expense', 'RTO Expense'], ['dl_exp', 'DL Expense'],
  ['ll_exp', 'LL Expense'], ['pcc_cvr_exp', 'PCC/CVR Expense'], ['fitness', 'Fitness Expense'], ['other', 'Other Expense']
].map(([value, label]) => ({ value, label }));

export const SIMPLE_MASTERS = {
  party: { label: 'Party Master', fields: [['name', 'Name', 'text'], ['sub_category', 'Party Type', 'select', [{ value: 'insurance', label: 'Insurance Provider / Agent' }, { value: 'rto', label: 'RTO Passing Person / Provider' }]], ['address', 'Address', 'text'], ['mobile', 'Mobile No.', 'text'], ['extra', 'GSTIN', 'text'], ['expense_type', 'Expense Head (kis expense ke under)', 'select', EXPENSE_TYPE_OPTIONS]] },
  'battery-maker': { label: 'Battery Maker Master', fields: [['name', 'Battery Maker Name', 'text']] },
  rto: { label: 'RTO Master', fields: [['name', 'RTO Name', 'text'], ['code', 'RTO Code', 'text'], ['address', 'Address Line 1', 'text'], ['address2', 'Address Line 2', 'text']] },
  financer: { label: 'Financer Master', fields: [['name', 'Name', 'text'], ['address', 'Address', 'text']] },
  mechanic: { label: 'Mechanic Master', fields: [['name', 'Mechanic Name', 'text']] },
  fabricator: { label: 'Fabricator Master', fields: [['name', 'Fabricator Name', 'text']] },
  salesman: { label: 'Salesman Master', fields: [['name', 'Salesman Name', 'text']] },
  bank: { label: 'Bank Details', fields: [['name', 'Bank Name', 'text'], ['account_no', 'Account No.', 'text'], ['ifsc', 'IFSC', 'text'], ['is_default', 'Default (auto-fills on new Invoices)', 'checkbox']] },
  'expense-head': {
    label: 'Account Head Master',
    fields: [
      ['name', 'Account Head', 'text'],
      ['sub_category', 'Sub Category', 'select', [
        'Current Asset', 'Fixed Asset', 'Other / Non-Current Asset',
        'Current Liability', 'Long Term Liability', 'Capital & Reserves',
        'Direct Expense', 'Indirect Expense', 'Direct Income', 'Indirect Income'
      ].map(v => ({ value: v, label: v }))],
      ['expense_type', 'Expense Type (Expense Payment Voucher me kis type ke under dikhe)', 'select', EXPENSE_TYPE_OPTIONS]
    ]
  },
  'expense-type': {
    label: 'Expense Type Master',
    fields: [
      ['name', 'Expense Type Name', 'text'],
      ['sub_category', 'Category (P&L me kahan dikhe)', 'select', ['Direct Expense', 'Indirect Expense'].map(v => ({ value: v, label: v }))],
      ['inactive', 'Band (naye voucher me na dikhe)', 'checkbox']
    ]
  },
  colour: { label: 'Colour Master', fields: [['name', 'Colour', 'text'], ['code', 'Colour Code', 'text'], ['color_hex', 'RGB / HEX', 'color'], ['color_hex2', 'Second Tone RGB / HEX', 'color'], ['is_double_tone', 'Double Tone', 'checkbox']] },
};

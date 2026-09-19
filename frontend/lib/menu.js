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
    ['option-setting', 'User wise Option Setting'],
    ['bank', 'Bank Details'],
    ['colour', 'Colour Master'],
  ],
  Vouchers: [
    ['purchase-bills', 'Purchase Bills'],
    ['production-voucher', 'Production Voucher'],
    ['delivery-challan', 'E-Rickshaw Delivery Challan'],
    ['tax-invoice', 'Tax Invoice'],
    ['old-rickshaw', 'Old Rickshaw'],
    ['battery-swap', 'Battery Swap / Exchange Voucher'],
    ['battery-withdrawal', 'Battery Withdrawal'],
    ['battery-delivery-challan', 'Battery Delivery Challan'],
    ['journal-stock', 'Journal Stock'],
    ['expense-payment-voucher', 'Expense Payment Voucher'],
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
    ['incentive-register', 'Incentive Register'],
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
export const NAV_GROUPS = {
  Masters: [
    ['company', 'Company Details'], ['dealer', 'Dealer Master'], ['party', 'Party Master'],
    ['product', 'Product Master'], ['chassis-master', 'Chassis Master'], ['battery-maker', 'Battery Maker'],
    ['rto', 'RTO Master'], ['financer', 'Financer Master'], ['production-formula', 'Production Formula'],
    ['mechanic', 'Mechanic Master'], ['fabricator', 'Fabricator Master'], ['bank', 'Bank Details'], ['colour', 'Colour Master'],
    ['user', 'User Master'], ['option-setting', 'User Option Setting'],
  ],
  Factory: [
    ['production-voucher', 'Production Voucher'], ['delivery-challan', 'Delivery Challan'],
    ['battery-delivery-challan', 'Battery Delivery Challan'],
    ['battery-swap', 'Battery Swap / Exchange'], ['battery-withdrawal', 'Battery Withdrawal'],
  ],
  'Sales & Billing': [
    ['purchase-bills', 'Purchase Bills'], ['tax-invoice', 'Tax Invoice'],
    ['old-rickshaw', 'Old Rickshaw'],
  ],
  Accounts: [
    ['journal-stock', 'Journal Stock'], ['expense-payment-voucher', 'Expense Payment Voucher'],
    ['ledger', 'Ledger'], ['day-book', 'Day Book'], ['ledger-v', 'Ledger V'],
    ['payment-receivable-report', 'Payment Receivable'], ['gst-register', 'GST Register'],
    ['hypothecation-register', 'Hypothecation Register'], ['incentive-register', 'Incentive Register'],
    ['subsidy-report', 'Subsidy Report'],
  ],
  Inventory: [
    ['closing-stock-premises', 'Closing Stock - Premises'], ['closing-stock-dealers', 'Closing Stock - Dealers'],
    ['closing-stock-raw', 'Closing Stock - Raw Material'], ['stock-ledger-premises', 'Stock Ledger - Premises'],
    ['stock-ledger-dealers', 'Stock Ledger - Dealers'],
  ],
  HR: [
    ['hr-attendance', 'Attendance & Salary'],
  ],
  Reports: [
    ['purchase-register', 'Purchase Register'], ['production-register', 'Production Register'],
    ['delivery-challan-register', 'Delivery Challan Register'], ['sale-register', 'Sale Register'],
  ],
  System: [
    ['backup-restore', 'Backup / Restore'], ['password', 'Password'],
  ],
};

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
  bank: { label: 'Bank Details', fields: [['name', 'Bank Name', 'text'], ['account_no', 'Account No.', 'text'], ['ifsc', 'IFSC', 'text'], ['is_default', 'Default (auto-fills on new Invoices)', 'checkbox']] },
  colour: { label: 'Colour Master', fields: [['name', 'Colour', 'text'], ['code', 'Colour Code', 'text']] },
};

Activity Log: Credit Note + New Invoice

Is zip me 3 files hain (same path par overwrite karein):
  app/api/[...path]/route.ts   - Credit Note issue / Cancel Challan par audit entry; activity-log me 'credit-notes' shamil
  lib/server/billing.ts        - Pending Sales -> Save Invoice (new bill) par "Bill (Tax Invoice) created" audit entry
  components/StockPages.jsx    - Activity Log page me "Credit Note" filter + details (CN no, bill, chassis, amount, reason)
  lib/server/production.ts     - Production Voucher create par audit entry (edit/delete pehle se logged the)

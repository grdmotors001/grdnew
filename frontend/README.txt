Activity Log: Credit Note + New Invoice

Is zip me 3 files hain (same path par overwrite karein):
  app/api/[...path]/route.ts   - Credit Note issue / Cancel Challan par audit entry; activity-log me 'credit-notes' shamil
  lib/server/billing.ts        - Pending Sales -> Save Invoice (new bill) par "Bill (Tax Invoice) created" audit entry
  components/StockPages.jsx    - Activity Log page me "Credit Note" filter + details (CN no, bill, chassis, amount, reason)
  lib/server/production.ts     - Production Voucher create par audit entry (edit/delete pehle se logged the)

Salesman: Delivery Challan Edit me read-only, sirf Dealer Master se
  components/DeliveryChallanPage.jsx, components/ReportPages.jsx - Edit form me Salesman readOnly
  lib/server/delivery-challan.ts - create par dealer master se; edit (PUT) me salesman ignore; register/filter/print me dealer master wala salesman
  lib/server/reports-sales.ts    - sale report me salesman pehle dealer master se

Challan print: components/PrintDocs.jsx - Battery box sirf lagi hui battery ke hisaab se (1-4), koi nahi to 1 blank; numbers ki jagah ➤

Tax Invoice print: HSN product master se (hsn_code), niche ki "DHAN DHAN..." strip hata di (header me hai)
  components/PrintDocs.jsx, lib/server/tax-invoice.ts, lib/server/billing.ts, app/api/[...path]/route.ts

Invoice GST: local sale me CGST 2.5% + SGST 2.5% alag lines, inter-state me IGST 5% (components/PrintDocs.jsx)

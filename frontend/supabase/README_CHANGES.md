# Changes (28-09-2026)

Purchase bills: purchase_bill.items column already exists with data, so NO SQL needed for it (01 script removed).
Real bug: GST Register "inward" (purchase side) had taxable/cgst/sgst/igst hardcoded to 0.
Fixed in route.ts via purchaseBillTotals() (reads items jsonb).

Customer master:
1. Run sql/02_billing_customer.sql in Supabase SQL Editor (test DB first).
2. Replace in repo frontend/:
   - app/api/[...path]/route.ts
   - components/TaxInvoicePage.jsx

UMRN logo on Tax Invoice / Delivery Challan print:
Root cause: umrn_code was read from the VEHICLE table (which has no umrn column) -> always blank -> _default.png.
It lives on the PRODUCT master, so now looked up by product name; tries UMRN code, chassis item code, product name as file names.
Also replace:
   - app/api/backend/tax-invoices/[id]/print/route.ts
   - app/api/backend/delivery-challans/[id]/print/route.ts
   - components/PrintDocs.jsx

# Pending Sales workflow (28-09-2026, 2nd change)

No SQL needed. Replace in repo frontend/:
   - app/api/[...path]/route.ts
   - components/BillingPendingSalesPage.jsx

1. List me direct "Approve" button hata diya. Pending row par: [Open for Approve] [Edit] [Delete].
   "Open for Approve" -> sale form dobara khulta hai VIEW (read-only) me, saari details (Applicant / Internal / Amount-Tax) dikhti hain,
   aur Approve usi form ke andar se hota hai.
2. Approve ke baad: Sale Amount (internal) aur Loan / Hypothecation Amount change nahi hote, sale delete nahi hoti
   (server par bhi enforce: PUT/DELETE billing/pending-sales/:id). Approved sale me sirf View + Create Sale / Complete Sale.
   Naya handler zaroori tha: pehle ye path generic CRUD se loan_workflow table par map hota tha.
3. Create Sale (Tax Invoice) form me Tax Invoice form ki saari details (Applicant, Internal, GST) pre-filled; Sale Amount / Loan Amount read-only.
   save-invoice server par bhi Sale Amount / Loan Amount approved sale se hi leta hai, form se nahi.
4. Bill No. sirf New Rickshaw par. Old Rickshaw / Battery: "Complete Sale (No Bill)", koi bill no nahi (save-invoice server par bhi block).

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

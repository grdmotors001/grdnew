# Bug fixes (30-09-2026) - frontend/app/api/[...path]/route.ts
1. PUT/PATCH/DELETE body was read twice (scope check + handler) -> handler got {} . json() now caches per request.
2. Salesman dealer restriction was write-only. Generic GET now filters by assigned dealers; dealer table id checked; customer-complete-report scoped.
3. genericGet ignored ?column=value filters (WHERE never appended) - fixed.
4. Action permissions (View/Create/Edit/Delete/Approve) never matched for URLs with record id (e.g. delivery-challans/12) - key now normalised.
5. Audit: permission change now logs old->new; password reset and module-access changes now logged.
6. P&L: stock valued at purchase cost (was sale price), purchases on taxable value (GST excluded), date/timezone bug fixed.
7. Customer report: with customer_id only, expenses/payments matched '%%' = ALL customers. Fixed; added total_gst, total_expenses, expense_breakup.
8. Battery: stock-insufficient block removed (minus allowed); duplicate issued serial check was inverted (>0 -> <0).

# Insurance Register + Bank Ledger review (30-09-2026)
Bugs fixed:
1. Non-admin staff could not use Insurance Register: API path `insurance-register` vs menu module id `insurance-rto`. Alias added (permissions + allowed_modules).
2. "Insurer account paid" was always 0: query used column `paid_at` which does not exist (error swallowed by .catch). Now uses expense vouchers (type insurance, not cancelled/rejected). Also it repeated the insurer's total on every row -> replaced by an Insurer On-Account Ledger (payable New+Old, paid, balance).
3. Insurance list ran 2 queries per row (10000 rows) -> batched.
4. Excel dates (serial number / dd/mm/yyyy) went straight into ::date -> import failed or swapped day/month. Central importDate()/importAmount() added (amounts like "1,25,000" or "500 Cr" also work).
5. Import headers matched exact strings only ("Chassis No." failed). Header matching is now case/space/dot insensitive.
6. Old Insurance had no duplicate check (re-import doubled data) -> unique by SP No. (else Vehicle). New stays unique by Chassis No. Duplicates inside the same file are caught too.
7. Old Insurance is now TAGGED against Old Rickshaw inventory (SP No. / vehicle reg no.); status filter works for Old tab.
8. Insurance Edit/Delete added (API + UI), with duplicate check.
9. Bank import: duplicate check ignored narration, so two different UPI payments of the same amount on the same day were dropped. Now key includes narration and repeats inside one file are kept.
10. Bank import accepted any bank name (typos = phantom ledgers). Name must match Bank Details master; otherwise row is rejected with reason. Import is one transaction and returns rejected rows.
11. Posting a suspense entry no longer possible without Party (kis se aaya / kise diya) and Receipt/Payment direction; entry can be sent back to Suspense.
12. Bank Ledger is now a real ledger: per-bank totals, bank/date filters, opening balance, running balance (only POSTED entries), suspense shown separately.
13. Audit log added for insurance create/edit/delete/import and bank import/post.

# RTO Expense Register (30-09-2026)
- New menu "RTO Expense Register" (module id `rto-expense`, API `rto-register`), table `rto_expense_register` (auto-created).
- Tabs New Rickshaw (Chassis No. required, Bill No. optional, auto-mapped to tax invoice) / Old Rickshaw (SP No. or Vehicle, tagged to Old Rickshaw inventory).
- Fields: Date, Customer, RTO Expense Amount, Work/Particulars (optional), RTO Agent, Chassis/Bill or SP/Vehicle, Remarks. Nothing goes on invoice; Registration Fee stays as on invoice.
- Import Excel/CSV (header-insensitive, date/amount safe, duplicate + rejected report), Edit, Delete, audit log.
- Duplicate rule: same chassis (or SP/vehicle) + same work + same amount + same date. One vehicle can have several different RTO works.
- RTO Agent On-Account Ledger: total expense - Expense Vouchers (type RTO Expense) paid to the agent = balance.
- Regression found: the rewritten Insurance page had dropped the RTO tab, and the old per-rickshaw workflow endpoints (party-pending / party-rickshaws) are not implemented in the API. RTO now has its own register.
- Expense Payment Voucher (Insurance / RTO): rickshaw selection no longer mandatory; no selection = ON-ACCOUNT lump-sum payment.

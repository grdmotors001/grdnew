Is zip ki sab files apne repo me same path par replace/add karein (frontend/ folder ke andar), phir git push.

Naya/badla:
- components/HRDashboard.jsx             NAYI  (HR Dashboard tab)
- components/HRAttendancePage.jsx        Dashboard tab + Salary tab me Paid/Baaki/Status
- components/ExpensePaymentVoucherPage.jsx  Salary payable -> employee dropdown + Salary Month
- lib/server/expense-voucher.ts          Bank voucher approve par seedha Paid; cash Cashier se; salary voucher employee link
- lib/server/hr-salary.ts                HR salary me paid_amount / paid_modes / in_process
- app/api/[...path]/route.ts             hr/salary me paid data
- app/api/hr-device-push/route.ts        BioMax device push (secret key wali, route.ts me key bharein)

purane_bank_vouchers.sql: optional, ek baar chalayein.
Naye columns (hr_employee_id, salary_month) apne aap ban jate hain.

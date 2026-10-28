HR: Salary Slip (Excel jaisi, employee-wise)

Pehle pichla zip (HR_Import_Update.zip) lagaa lein. Phir is zip ki 3 files same path par overwrite karein:
  app/api/[...path]/route.ts        - hr/salary (slip ke fields), hr/salary/process, naya hr/salary/adjust
  components/HRAttendancePage.jsx   - Salary tab: employee search + "Slip" button + slip + Print
  lib/server/hr-salary.ts           - NAYI file: salary ka calculation (Process Salary aur Slip dono yahi use karte hain)

Naya SQL chalane ki zaroorat nahi (naye columns apne aap ban jate hain).

Use karne ka tareeka:
  1. HR -> Attendance & Salary -> Salary tab -> mahina chunein -> "Process Salary".
  2. Employee ki row me "Slip" dabayein.
  3. Slip me Present Days, Extra Sundays/Nights (din), Holiday Deducted (din), Salary Loan Advances, PL Loan, Paid date bharein -> Save.
  4. "Print" se slip print/PDF.

Formula:
  Per-day = Salary / 30 (mahina 31 din ka ho tab bhi 30, aapki Excel slip jaisa)
  Net = Per-day x Present + Allowances + OT + (Per-day x Extra) - (Per-day x Holiday Deducted) - Advance - PL Loan
  Present Days badalne par wo "Manual" ho jata hai aur Process Salary dobara chalane par bhi bana rehta hai.
  Extra / Holiday / Advance / PL Loan bhi dobara Process Salary par bache rehte hain.

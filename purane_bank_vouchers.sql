-- Optional (ek baar): jo bank/UPI/cheque voucher pehle se Approved me padey hain unhe Paid kar do.
UPDATE expense_payment_voucher
SET payment_status='paid', paid_at=NOW(), paid_by='Bank (direct)'
WHERE status='approved'
  AND COALESCE(payment_status,'')<>'paid'
  AND lower(COALESCE(payment_mode,'cash'))<>'cash';

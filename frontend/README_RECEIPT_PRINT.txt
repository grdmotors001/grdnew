Receipt Print (Bank + Cash) - G.R.D. Motors

Ye 5 files apne project me same path par daalein (overwrite):
  components/ReportPages.jsx              - Bank & Cash Book: row icon + popup "Print Receipt"
  components/CashierAllReceiptsPage.jsx   - Cashier > All Receipts (Cash): har row par print icon
  components/bankReceiptPrint.js          - receipt print (A4 portrait, receipt page ke upar; neeche ka hissa dobara print ke liye khali)
  public/bank-receipt-template.png        - "Bank Receipt" template
  public/cash-receipt-template.png        - "Cash Receipt" template (heading Cash Receipt)

Cash entry (bank khali) ka print "Cash Receipt" template me niklega, bank wali ka "Bank Receipt" me.

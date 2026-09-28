// 58mm thermal receipt (Posiflow / ESC-POS style mobile printers) — prints via the browser print dialog.
// Hidden iframe use hota hai, isliye popup-blocker ka issue nahi aata aur poora page print nahi hota.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = v => 'Rs ' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = d => { const x = String(d || '').slice(0, 10).split('-'); return x.length === 3 ? `${x[2]}-${x[1]}-${x[0]}` : String(d || ''); };
const typeLabel = t => t === 'balance_payment' ? 'BALANCE PAYMENT' : 'NEW BOOKING';

export function buildReceiptHtml(r, opts = {}) {
  const shop = opts.dealerName || '';
  const row = (k, v) => v === undefined || v === null || v === '' ? '' : `<div class="r"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
  const hasBal = r.balance_after !== undefined && r.balance_after !== null && r.balance_after !== '';
  const sale = Number(r.sale_amount || 0), loan = Number(r.loan_amount || 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.receipt_no)}</title>
<style>
  @page{size:58mm auto;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff}
  body{width:48mm;margin:0 auto;padding:3mm 0 6mm;font-family:"Courier New",monospace;font-size:11px;line-height:1.35;color:#000}
  .c{text-align:center}.b{font-weight:700}
  .h1{font-size:15px;font-weight:800;letter-spacing:.5px}
  .sep{border-top:1px dashed #000;margin:5px 0}
  .r{display:flex;justify-content:space-between;gap:6px}
  .r span:last-child{text-align:right;word-break:break-word}
  .big{font-size:14px;font-weight:800}
  .sig{margin-top:22px;border-top:1px solid #000;padding-top:2px;text-align:center;font-size:10px}
</style></head><body>
  <div class="c h1">G.R.D. MOTORS</div>
  ${shop ? `<div class="c">${esc(shop)}</div>` : ''}
  <div class="sep"></div>
  <div class="c b">CASH RECEIPT</div>
  <div class="c">${typeLabel(r.receipt_type)}</div>
  <div class="sep"></div>
  ${row('Receipt No', r.receipt_no)}
  ${row('Date', fmtDate(r.date || r.receipt_date))}
  ${row('Customer', r.customer_name)}
  ${row('Mobile', r.customer_phone)}
  ${row('Page No', r.dealer_register_page_no)}
  <div class="sep"></div>
  ${sale > 0 ? row('Sale Amt', inr(sale)) : ''}
  ${loan > 0 ? row('Loan Amt', inr(loan)) : ''}
  <div class="r big"><span>RECEIVED</span><span>${esc(inr(r.amount))}</span></div>
  ${row('Mode', String(r.payment_mode || 'cash').toUpperCase())}
  ${row('Ref No', r.reference_no)}
  ${hasBal ? `<div class="sep"></div><div class="r b"><span>BALANCE DUE</span><span>${esc(inr(r.balance_after))}</span></div>` : ''}
  ${r.remarks ? `<div class="sep"></div><div>Remarks: ${esc(r.remarks)}</div>` : ''}
  <div class="sep"></div>
  <div class="c">Thank you!</div>
  <div class="sig">Authorised Signature</div>
</body></html>`;
}

export function printCashReceipt(receipt, opts = {}) {
  if (!receipt) return;
  const html = buildReceiptHtml(receipt, opts);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.error('[print receipt]', e); }
    setTimeout(() => frame.remove(), 60000);
  };
  // thoda ruk ke print taaki content render ho jaye
  setTimeout(go, 150);
}

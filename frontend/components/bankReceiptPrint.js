// G.R.D. Motors — "Bank Receipt" print (A5 landscape).
// Blank template image (public/bank-receipt-template.png) ke upar fields overlay hoti hain.
// UTR / Reference line = imported narration jaisi hi (koi cleaning nahi).

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));

// 270000 -> "Two Lakh Seventy Thousand Only"
export function amountToWords(amount) {
  const total = Math.round(Math.abs(Number(amount) || 0) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (!rupees && !paise) return 'Zero Only';
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (rupees) parts.push(three(rupees));
  let words = parts.join(' ');
  if (paise) words += (words ? ' and ' : '') + two(paise) + ' Paise';
  return words + ' Only';
}

const fmtDate = (v) => {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const fmtAmount = (v) => {
  const n = Number(v) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
};

// Payment Type / Cheque No. — narration se mode pakadta hai, nahi mila to bank = "BANK TRF", bank khali = "CASH".
export function guessPayType({ narration, bank, cheque }) {
  if (cheque) return 'CHEQUE ' + cheque;
  if (!bank || /^cash$/i.test(bank)) return 'CASH';
  const m = String(narration || '').toUpperCase().match(/\b(RTGS|NEFT|IMPS|UPI|CHEQUE|CHQ|CDM|CASH DEPOSIT)\b/);
  if (m) return m[1] === 'CHQ' ? 'CHEQUE' : m[1];
  return 'BANK TRF';
}

// d = { no, date (yyyy-mm-dd), party, payType, utr, bank, amount, cash (true = "Cash Receipt" template) }
export function printBankReceipt(d) {
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — print ke liye pop-up allow karein.'); return; }
  const img = `${window.location.origin}/${d.cash ? 'cash' : 'bank'}-receipt-template.png`;
  const utr = String(d.utr || '');
  // lambi narration ke liye font chhota (wrap bhi hota hai)
  const utrSize = utr.length > 90 ? 1.05 : utr.length > 60 ? 1.24 : utr.length > 40 ? 1.48 : 1.76;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${d.cash ? 'Cash' : 'Bank'} Receipt ${esc(d.no)}</title>
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
.sheet{position:relative;width:190mm;margin:8mm auto 0;aspect-ratio:1125/785;container-type:inline-size;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#10213f;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet img{position:absolute;inset:0;width:100%;height:100%;display:block}
.f{position:absolute;display:flex;align-items:center;line-height:1.12;font-weight:600;overflow:hidden}
.val{font-size:1.76cqw}
.amt{font-size:3.43cqw;font-weight:800}
@media screen{body{background:#ddd;padding:0 10px 10px}.sheet{box-shadow:0 2px 12px rgba(0,0,0,.3)}}
@media print{html,body{overflow:hidden}}
</style></head><body>
<div class="sheet">
  <img id="tpl" src="${img}" alt="">
  <div class="f val" style="left:62.2%;top:25.6%;width:16%;height:5.5%;font-weight:800">${esc(d.no)}</div>
  <div class="f val" style="left:84%;top:25.6%;width:14%;height:5.5%;font-weight:800">${esc(fmtDate(d.date))}</div>
  <div class="f val" style="left:36.5%;top:33.4%;width:60%;height:6.4%">${esc(d.party)}</div>
  <div class="f val" style="left:36.5%;top:41.6%;width:60%;height:6.4%">${esc(d.payType)}</div>
  <div class="f" style="left:36.5%;top:51.3%;width:60%;height:6.4%;font-size:${utrSize}cqw">${esc(utr)}</div>
  <div class="f val" style="left:36.5%;top:59.7%;width:60%;height:6.4%">${esc(d.amountWords || amountToWords(d.amount))}</div>
  <div class="f val" style="left:36.5%;top:67.5%;width:60%;height:6.4%">${esc(d.bank)}</div>
  <div class="f amt" style="left:50.5%;top:78.2%;width:23%;height:8.5%">${esc(fmtAmount(d.amount))}</div>
</div>
<script>
(function(){var done=false;function go(){if(done)return;done=true;setTimeout(function(){window.focus();window.print()},150)}
var i=document.getElementById('tpl');if(i.complete)go();else{i.onload=go;i.onerror=go}})();
<\/script></body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

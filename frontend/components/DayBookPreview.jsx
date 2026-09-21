'use client';

import { useMemo, useState } from 'react';
import { formatDate } from '../lib/date';

const money = v => Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2});
const isoToday = () => new Date().toISOString().slice(0,10);

export function DayBookPreview({
  date=isoToday(),
  dealerLabel='Showroom Branch',
  receipts=[],
  payments=[],
  openingBalance=0,
  closingBalance,
  onDateChange,
  onPrev,
  onNext,
  onPrint,
  onExport,
}) {
  const [search,setSearch]=useState('');
  const q=search.trim().toLowerCase();
  const match=x=>!q || [x.no,x.particulars,x.folio].join(' ').toLowerCase().includes(q);
  const rs=useMemo(()=>receipts.filter(match),[receipts,q]);
  const ps=useMemo(()=>payments.filter(match),[payments,q]);
  const totalReceipts=rs.reduce((s,x)=>s+Number(x.amount||0),0);
  const totalPayments=ps.reduce((s,x)=>s+Number(x.amount||0),0);
  const close=closingBalance == null ? Number(openingBalance||0)+totalReceipts-totalPayments : Number(closingBalance||0);

  const dateLabel=formatDate(date);
  const dayShift=d=>{const x=new Date((d||isoToday())+'T00:00:00');x.setDate(x.getDate()+1);return x.toISOString().slice(0,10)};
  const dayBack=d=>{const x=new Date((d||isoToday())+'T00:00:00');x.setDate(x.getDate()-1);return x.toISOString().slice(0,10)};

  return <div className="grdDayBook">
    <style>{`
      .grdDayBook{background:#fff;border:1px solid #e4eaf2;border-radius:16px;padding:18px;box-shadow:0 8px 28px rgba(16,42,80,.07);color:#12305d}
      .grdDayBook *{box-sizing:border-box}
      .grdDayBookTop{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}
      .grdDayBookTitle{display:flex;align-items:center;gap:12px}.grdDayBookIcon{width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:#eaf2ff;font-size:25px}
      .grdDayBookTitle h2{margin:0;font-size:26px;color:#12305d}.grdDayBookTitle p{margin:3px 0 0;color:#718096;font-size:12px}
      .grdDayBookActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.grdDayBookActions button,.grdDayBookActions input{height:40px;border:1px solid #d7e0ec;border-radius:9px;background:#fff;padding:0 13px;color:#12305d;font-weight:700}
      .grdDayBookDate{display:flex;align-items:center;gap:8px}.grdDayBookDate input{font-weight:800}
      .grdDayBookSearch{width:180px}.grdDayBookBtn{cursor:pointer}.grdDayBookBtn.primary{background:#1667d9;color:#fff;border-color:#1667d9}
      .grdDayBookPages{display:grid;grid-template-columns:1fr 1fr;gap:18px}
      .grdDayBookPanel{border:1px solid #dce5f0;border-radius:13px;overflow:hidden}
      .grdDayBookPanelHead{padding:13px 15px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
      .grdDayBookPanelHead.receipt{background:linear-gradient(90deg,#eafaf2,#f8fffb);color:#08734b}.grdDayBookPanelHead.payment{background:linear-gradient(90deg,#fff0f2,#fffafa);color:#bd1730}
      .grdDayBookPanelHead h3{margin:0;font-size:20px}.grdDayBookPanelHead .date{font-size:12px;margin-top:4px;color:#25456e}
      .grdDayBookBranch{text-align:right;font-size:12px;font-weight:800;color:#526782}.grdDayBookBranch small{display:block;color:#8290a3;font-weight:600;margin-top:2px}
      .grdDayBookTable{width:100%;border-collapse:collapse;table-layout:fixed}.grdDayBookTable th,.grdDayBookTable td{border:1px solid #dbe3ed;padding:9px 8px;font-size:12px;vertical-align:middle}.grdDayBookTable th{background:#f7f9fc;font-weight:900;text-align:center}.grdDayBookTable th:nth-child(1){width:18%}.grdDayBookTable th:nth-child(3){width:17%}.grdDayBookTable th:nth-child(4){width:20%;text-align:right}.grdDayBookTable td:first-child{text-align:center;font-weight:800}.grdDayBookTable td:nth-child(3){text-align:center}.grdDayBookTable td:last-child{text-align:right;font-weight:800}
      .grdDayBookTable tbody tr:hover{background:#f8fbff}.grdDayBookEmpty{height:44px}
      .grdDayBookTotal{display:flex;justify-content:flex-end;gap:30px;padding:12px 14px;font-weight:900;font-size:15px;border-top:2px solid #d9e3ee}.receiptTotal{background:#eafaf2;color:#08734b}.paymentTotal{background:#fff0f2;color:#bd1730}
      .grdDayBookSummary{display:grid;grid-template-columns:1fr 30px 1fr 30px 1fr 30px 1fr;gap:8px;align-items:center;margin-top:18px}.grdDayBookSummaryCard{border:1px solid #d8e1ec;border-radius:11px;padding:13px 16px;background:#fff}.grdDayBookSummaryCard span{display:block;font-size:11px;color:#68798f;font-weight:800}.grdDayBookSummaryCard strong{display:block;font-size:22px;margin-top:3px}.grdDayBookSummaryCard.open strong,.grdDayBookSummaryCard.close strong{color:#1764d1}.grdDayBookSummaryCard.receipt strong{color:#08734b}.grdDayBookSummaryCard.payment strong{color:#bd1730}.grdDayBookOp{font-size:24px;font-weight:900;text-align:center;color:#738197}
      @media(max-width:900px){.grdDayBookPages{grid-template-columns:1fr}.grdDayBookSummary{grid-template-columns:1fr}.grdDayBookOp{display:none}.grdDayBookSearch{width:150px}}
      @media(max-width:600px){.grdDayBook{padding:10px}.grdDayBookTitle h2{font-size:21px}.grdDayBookActions{width:100%}.grdDayBookActions>*{flex:1;min-width:110px}.grdDayBookTable th,.grdDayBookTable td{padding:7px 5px;font-size:10px}.grdDayBookTable th:nth-child(1){width:22%}.grdDayBookTable th:nth-child(3){width:17%}.grdDayBookTable th:nth-child(4){width:22%}.grdDayBookSummaryCard strong{font-size:19px}}
      @media print{.grdDayBook{box-shadow:none;border:0;padding:0}.grdDayBookActions{display:none}.grdDayBookPages{gap:8px}.grdDayBookSummary{margin-top:10px}.grdDayBookPanelHead{padding:8px}.grdDayBookTable th,.grdDayBookTable td{padding:5px;font-size:9px}}
    `}</style>
    <div className="grdDayBookTop">
      <div className="grdDayBookTitle"><div className="grdDayBookIcon">📖</div><div><h2>Cash / Day Book</h2><p>G.R.D. MOTORS · {dealerLabel}</p></div></div>
      <div className="grdDayBookActions">
        <div className="grdDayBookDate">📅 <input aria-label="Select date" type="date" value={date} onChange={e=>onDateChange?onDateChange(e.target.value):null}/></div>
        <button className="grdDayBookBtn" onClick={()=>onPrev?onPrev():onDateChange?.(dayBack(date))}>‹ Previous Day</button>
        <button className="grdDayBookBtn" onClick={()=>onNext?onNext():onDateChange?.(dayShift(date))}>Next Day ›</button>
        <input className="grdDayBookSearch" placeholder="Search" value={search} onChange={e=>setSearch(e.target.value)}/>
        <button className="grdDayBookBtn" onClick={()=>onPrint?onPrint():window.print()}>🖨 Print</button>
        <button className="grdDayBookBtn primary" onClick={onExport}>⇩ Export</button>
      </div>
    </div>

    <div className="grdDayBookPages">
      <section className="grdDayBookPanel">
        <div className="grdDayBookPanelHead receipt"><div><h3>RECEIPTS</h3><div className="date">Date : {dateLabel}</div></div><div className="grdDayBookBranch">{dealerLabel}<small>Cash Receipts</small></div></div>
        <table className="grdDayBookTable"><thead><tr><th>No.<br/>(Receipt No.)</th><th>Particulars</th><th>Folio<br/>(Page No.)</th><th>Amount<br/>(Rs.)</th></tr></thead>
          <tbody>{rs.map((r,i)=><tr key={r.id||r.no||i}><td>{r.no||'—'}<br/><span style={{fontWeight:500,color:'#728096'}}>({formatDate(r.date||date)})</span></td><td>{r.particulars||'—'}</td><td>{r.folio||'—'}</td><td>{money(r.amount)}</td></tr>)}{Array.from({length:Math.max(0,Math.min(4,7-rs.length))}).map((_,i)=><tr className="grdDayBookEmpty" key={'er'+i}><td></td><td></td><td></td><td></td></tr>)}</tbody>
        </table><div className="grdDayBookTotal receiptTotal"><span>Total Receipts</span><span>₹{money(totalReceipts)}</span></div>
      </section>

      <section className="grdDayBookPanel">
        <div className="grdDayBookPanelHead payment"><div><h3>PAYMENTS</h3><div className="date">Date : {dateLabel}</div></div><div className="grdDayBookBranch">{dealerLabel}<small>Cash Payments</small></div></div>
        <table className="grdDayBookTable"><thead><tr><th>No.<br/>(Voucher No.)</th><th>Particulars</th><th>Folio<br/>(Page No.)</th><th>Amount<br/>(Rs.)</th></tr></thead>
          <tbody>{ps.map((p,i)=><tr key={p.id||p.no||i}><td>{p.no||'—'}<br/><span style={{fontWeight:500,color:'#728096'}}>({formatDate(p.date||date)})</span></td><td>{p.particulars||'—'}</td><td>{p.folio||'—'}</td><td>{money(p.amount)}</td></tr>)}{Array.from({length:Math.max(0,Math.min(4,7-ps.length))}).map((_,i)=><tr className="grdDayBookEmpty" key={'ep'+i}><td></td><td></td><td></td><td></td></tr>)}</tbody>
        </table><div className="grdDayBookTotal paymentTotal"><span>Total Payments</span><span>₹{money(totalPayments)}</span></div>
      </section>
    </div>

    <div className="grdDayBookSummary">
      <div className="grdDayBookSummaryCard open"><span>Opening Balance · {dateLabel}</span><strong>₹{money(openingBalance)}</strong></div><div className="grdDayBookOp">+</div>
      <div className="grdDayBookSummaryCard receipt"><span>Total Receipts · {dateLabel}</span><strong>₹{money(totalReceipts)}</strong></div><div className="grdDayBookOp">−</div>
      <div className="grdDayBookSummaryCard payment"><span>Total Payments · {dateLabel}</span><strong>₹{money(totalPayments)}</strong></div><div className="grdDayBookOp">=</div>
      <div className="grdDayBookSummaryCard close"><span>Closing Balance · {dateLabel}</span><strong>₹{money(close)}</strong></div>
    </div>
  </div>;
}

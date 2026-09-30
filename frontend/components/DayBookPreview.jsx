'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDate } from '../lib/date';

const money = v => Number(v || 0).toLocaleString('en-IN',{maximumFractionDigits:2});
const isoToday = () => new Date().toISOString().slice(0,10);

export function Pagination({page,pageSize,total,onPage,onPageSize,sizes=[25,50,100,200]}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const cur=Math.min(page,pages);
  const from=total?(cur-1)*pageSize+1:0;
  const to=Math.min(total,cur*pageSize);
  const btn={height:32,minWidth:32,border:'1px solid var(--line,#d7e0ec)',borderRadius:8,background:'var(--card,#fff)',color:'var(--ink,#12305d)',fontWeight:700,cursor:'pointer',padding:'0 10px'};
  const dis={...btn,opacity:.45,cursor:'not-allowed'};
  return <div className="grdPager" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',padding:'10px 14px',fontSize:12,color:'var(--muted,#4a5d78)'}}>
    <span>Showing <b>{from}–{to}</b> of <b>{total}</b> entries</span>
    <span style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
      <label>Rows&nbsp;
        <select value={pageSize} onChange={e=>onPageSize(Number(e.target.value))} style={{height:32,border:'1px solid var(--line,#d7e0ec)',borderRadius:8,padding:'0 6px',background:'var(--input-bg,#fff)',color:'var(--ink,#12305d)'}}>
          {sizes.map(n=><option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" style={cur<=1?dis:btn} disabled={cur<=1} onClick={()=>onPage(1)}>«</button>
      <button type="button" style={cur<=1?dis:btn} disabled={cur<=1} onClick={()=>onPage(cur-1)}>‹ Prev</button>
      <span>Page <b>{cur}</b> / {pages}</span>
      <button type="button" style={cur>=pages?dis:btn} disabled={cur>=pages} onClick={()=>onPage(cur+1)}>Next ›</button>
      <button type="button" style={cur>=pages?dis:btn} disabled={cur>=pages} onClick={()=>onPage(pages)}>»</button>
    </span>
  </div>;
}

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
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(50);
  const q=search.trim().toLowerCase();
  const match=x=>!q || [x.no,x.particulars,x.folio].join(' ').toLowerCase().includes(q);
  const rs=useMemo(()=>receipts.filter(match),[receipts,q]);
  const ps=useMemo(()=>payments.filter(match),[payments,q]);
  const totalReceipts=rs.reduce((s,x)=>s+Number(x.amount||0),0);
  const totalPayments=ps.reduce((s,x)=>s+Number(x.amount||0),0);
  const close=closingBalance == null ? Number(openingBalance||0)+totalReceipts-totalPayments : Number(closingBalance||0);
  const rows=useMemo(()=>{
    const combined=[
      ...rs.map(x=>({...x,type:'DEBIT',debit:Number(x.amount||0),credit:0})),
      ...ps.map(x=>({...x,type:'CREDIT',debit:0,credit:Number(x.amount||0)})),
    ].sort((a,b)=>String(a.date||date).localeCompare(String(b.date||date)) || String(a.no||'').localeCompare(String(b.no||''),undefined,{numeric:true}));
    let running=Number(openingBalance||0);
    return combined.map(x=>{
      const rowOpening=running;
      running += Number(x.debit||0)-Number(x.credit||0);
      return {...x,rowOpening,running};
    });
  },[rs,ps,openingBalance,date]);

  useEffect(()=>{setPage(1)},[q,date,pageSize,receipts.length,payments.length]);
  const pageRows=useMemo(()=>rows.slice((page-1)*pageSize,page*pageSize),[rows,page,pageSize]);
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
      .grdCashSummary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
      .grdCashSummaryCard{border:1px solid #d8e1ec;border-radius:11px;padding:13px 15px;background:#fff}
      .grdCashSummaryCard span{display:block;font-size:10px;color:#68798f;font-weight:800;text-transform:uppercase;letter-spacing:.3px}
      .grdCashSummaryCard strong{display:block;font-size:20px;margin-top:4px}.grdCashSummaryCard.open strong,.grdCashSummaryCard.running strong{color:#1764d1}.grdCashSummaryCard.debit strong{color:#08734b}.grdCashSummaryCard.credit strong{color:#bd1730}
      .grdCashLedger{border:1px solid #dce5f0;border-radius:13px;overflow:auto}
      .grdCashLedgerTable{width:100%;min-width:760px;border-collapse:collapse;table-layout:fixed}.grdCashLedgerTable th,.grdCashLedgerTable td{border-bottom:1px solid #dbe3ed;padding:10px 9px;font-size:12px;vertical-align:middle}
      .grdCashLedgerTable th{background:#f7f9fc;font-weight:900;text-align:center;color:#25456e;position:sticky;top:0;z-index:1}
      .grdCashLedgerTable th:nth-child(1){width:12%}.grdCashLedgerTable th:nth-child(2){width:34%}.grdCashLedgerTable th:nth-child(3){width:17%}.grdCashLedgerTable th:nth-child(4){width:13%}.grdCashLedgerTable th:nth-child(5){width:13%}.grdCashLedgerTable th:nth-child(6){width:17%}
      .grdCashLedgerTable td:nth-child(1){text-align:center;white-space:nowrap}.grdCashLedgerTable td:nth-child(3),.grdCashLedgerTable td:nth-child(4),.grdCashLedgerTable td:nth-child(5),.grdCashLedgerTable td:nth-child(6){text-align:right;font-weight:800}
      .grdCashLedgerTable td:nth-child(2){font-weight:700}.grdCashLedgerTable tbody tr:hover{background:#f8fbff}
      .grdCashLedgerTable .debit{color:#08734b}.grdCashLedgerTable .credit{color:#bd1730}.grdCashLedgerTable .running{color:#1764d1}
      .grdCashLedgerEmpty td{text-align:center!important;height:58px;color:#8795a8;font-weight:600!important}
      .grdCashLedgerFooter{display:flex;justify-content:flex-end;gap:28px;padding:12px 14px;background:#f7f9fc;font-weight:900}
      .grdCashLedgerFooter .debit{color:#08734b}.grdCashLedgerFooter .credit{color:#bd1730}.grdCashLedgerFooter .running{color:#1764d1}
      @media(max-width:900px){.grdCashSummary{grid-template-columns:1fr 1fr}}
      @media(max-width:600px){
        .grdDayBook{padding:10px}.grdDayBookTitle h2{font-size:21px}.grdDayBookActions{width:100%}.grdDayBookActions>*{flex:1;min-width:110px}
        .grdCashSummary{grid-template-columns:1fr 1fr;gap:7px}.grdCashSummaryCard{padding:10px}.grdCashSummaryCard strong{font-size:17px}
        .grdCashLedgerTable{min-width:700px}.grdCashLedgerTable th,.grdCashLedgerTable td{padding:8px 6px;font-size:10px}
      }
      @media print{.grdPager{display:none!important}.grdDayBook{box-shadow:none;border:0;padding:0}.grdDayBookActions{display:none}.grdCashLedgerTable th,.grdCashLedgerTable td{padding:6px;font-size:9px}}
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

    <div className="grdCashSummary">
      <div className="grdCashSummaryCard open"><span>Opening Balance</span><strong>₹{money(openingBalance)}</strong></div>
      <div className="grdCashSummaryCard debit"><span>Total Debit · Cash In</span><strong>₹{money(totalReceipts)}</strong></div>
      <div className="grdCashSummaryCard credit"><span>Total Credit · Cash Out</span><strong>₹{money(totalPayments)}</strong></div>
      <div className="grdCashSummaryCard running"><span>Running Balance / Closing</span><strong>₹{money(close)}</strong></div>
    </div>

    <div className="grdCashLedger">
      <table className="grdCashLedgerTable">
        <thead><tr>
          <th>Date</th>
          <th>Particulars</th>
          <th>Opening Balance</th>
          <th>Debit<br/><small>Cash In</small></th>
          <th>Credit<br/><small>Cash Out</small></th>
          <th>Running Balance</th>
        </tr></thead>
        <tbody>
          {page===1&&<tr>
            <td>{dateLabel}</td>
            <td><b>Opening Balance</b></td>
            <td>{money(openingBalance)}</td>
            <td>—</td>
            <td>—</td>
            <td className="running">{money(openingBalance)}</td>
          </tr>}
          {pageRows.map((row,i)=><tr key={row.id||row.no||i}>
            <td>{formatDate(row.date||date)}</td>
            <td>{row.particulars||'—'}{row.no && <div style={{fontSize:10,color:'#728096',marginTop:2}}>{row.type==='DEBIT'?'Receipt':'Voucher'}: {row.no}{row.folio ? ' · Page '+row.folio : ''}</div>}</td>
            <td>{money(row.rowOpening)}</td>
            <td className="debit">{row.debit ? money(row.debit) : '—'}</td>
            <td className="credit">{row.credit ? money(row.credit) : '—'}</td>
            <td className="running">{money(row.running)}</td>
          </tr>)}
          {!rows.length && <tr className="grdCashLedgerEmpty"><td colSpan="6">No cash transactions for this date.</td></tr>}
        </tbody>
      </table>
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize}/>
      <div className="grdCashLedgerFooter">
        <span>Debit ₹{money(totalReceipts)}</span>
        <span>Credit ₹{money(totalPayments)}</span>
        <span className="running">Running Balance ₹{money(close)}</span>
      </div>
    </div>
  </div>;
}


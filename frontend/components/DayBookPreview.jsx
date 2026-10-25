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
  hideSummary=false, // true: parent page already shows Opening / Cash In / Out / Closing cards
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
      running += Number(x.debit||0)-Number(x.credit||0);
      return {...x,running};
    });
  },[rs,ps,openingBalance,date]);

  useEffect(()=>{setPage(1)},[q,date,pageSize,receipts.length,payments.length]);
  const pageRows=useMemo(()=>rows.slice((page-1)*pageSize,page*pageSize),[rows,page,pageSize]);
  const dateLabel=formatDate(date);
  const shift=(d,n)=>{const x=new Date((d||isoToday())+'T00:00:00');x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)};
  const goPrev=()=>onPrev?onPrev():onDateChange?.(shift(date,-1));
  const goNext=()=>onNext?onNext():onDateChange?.(shift(date,1));
  const ref=row=>row.no?(row.type==='DEBIT'?'Receipt':'Voucher')+': '+row.no+(row.folio?' · Page '+row.folio:''):'';

  return <div className="grdDb">
    <style>{`
      .grdDb{background:var(--card,#fff);border:1px solid var(--line,#d7e0ec);border-radius:16px;padding:16px;color:var(--ink,#12305d);box-shadow:0 1px 2px #00000008;min-width:0}
      .grdDb *{box-sizing:border-box}
      .grdDbTop{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .grdDbTitle{display:flex;align-items:center;gap:12px;min-width:0}
      .grdDbIcon{width:42px;height:42px;flex:none;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,#1667d9) 14%,transparent);font-size:21px}
      .grdDbTitle h2{margin:0;font-size:21px;line-height:1.2;color:var(--ink,#12305d)}
      .grdDbTitle p{margin:2px 0 0;color:var(--muted,#718096);font-size:12px}
      .grdDbTools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .grdDbNav{display:flex;align-items:stretch;border:1px solid var(--line,#d7e0ec);border-radius:10px;overflow:hidden;background:var(--input-bg,#fff)}
      .grdDbNav button,.grdDbNav input{height:38px;border:0;background:transparent;color:var(--ink,#12305d);font-weight:700;font-size:13px;padding:0 12px;font-family:inherit}
      .grdDbNav button{cursor:pointer;font-size:18px;line-height:1;padding:0 13px}
      .grdDbNav button:hover{background:color-mix(in srgb,var(--accent,#1667d9) 12%,transparent)}
      .grdDbNav input{border-left:1px solid var(--line,#d7e0ec);border-right:1px solid var(--line,#d7e0ec);min-width:140px;text-align:center}
      [data-theme="midnight-dark"] .grdDbNav input,[data-theme="midnight-dark"] .grdDbSearch{color-scheme:dark}
      .grdDbSearch{height:38px;width:170px;border:1px solid var(--line,#d7e0ec);border-radius:10px;background:var(--input-bg,#fff);color:var(--ink,#12305d);padding:0 12px;font-size:13px}
      .grdDbBtn{height:38px;border:1px solid var(--line,#d7e0ec);border-radius:10px;background:var(--input-bg,#fff);color:var(--ink,#12305d);font-weight:700;font-size:13px;padding:0 14px;cursor:pointer;white-space:nowrap}
      .grdDbBtn.primary{background:var(--accent,#1667d9);border-color:var(--accent,#1667d9);color:#fff}
      .grdDbSum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
      .grdDbSumCard{border:1px solid var(--line,#d8e1ec);border-radius:11px;padding:11px 14px;background:var(--strip-bg,transparent)}
      .grdDbSumCard span{display:block;font-size:10px;color:var(--muted,#68798f);font-weight:800;text-transform:uppercase;letter-spacing:.3px}
      .grdDbSumCard strong{display:block;font-size:19px;margin-top:3px}
      .grdDbBox{border:1px solid var(--line,#dce5f0);border-radius:13px;overflow:hidden}
      .grdDbScroll{overflow-x:auto}
      .grdDbTable{width:100%;border-collapse:collapse;table-layout:fixed;min-width:640px}
      .grdDbTable th,.grdDbTable td{border-bottom:1px solid var(--line,#dbe3ed);padding:11px 14px;font-size:13px;vertical-align:middle;text-align:left}
      .grdDbTable th{background:var(--th-bg,transparent);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:var(--muted,#25456e)}
      .grdDbTable th small{display:block;font-weight:600;text-transform:none;letter-spacing:0;font-size:10px;opacity:.8}
      .grdDbTable .c1{width:14%}.grdDbTable .c2{width:38%}.grdDbTable .c3,.grdDbTable .c4,.grdDbTable .c5{width:16%}
      .grdDbTable th.num,.grdDbTable td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:800}
      .grdDbTable td.date{white-space:nowrap;color:var(--muted,#4a5d78)}
      .grdDbTable tbody tr:last-child td{border-bottom:0}
      .grdDbTable tbody tr:hover{background:color-mix(in srgb,var(--accent,#1667d9) 6%,transparent)}
      .grdDbRef{font-size:11px;color:var(--muted,#728096);margin-top:2px;font-weight:500}
      .grdDbTable .debit,.grdDbList .debit{color:#16a36a}.grdDbTable .credit,.grdDbList .credit{color:#e5484d}.grdDbTable .run,.grdDbList .run{color:var(--ink,#12305d)}
      .grdDbOpenRow td{background:color-mix(in srgb,var(--accent,#1667d9) 7%,transparent);font-weight:700}
      .grdDbEmpty{padding:26px 14px;text-align:center;color:var(--muted,#8795a8);font-size:13px}
      .grdDbList{display:none}
      .grdDbFoot{display:flex;justify-content:flex-end;gap:24px;flex-wrap:wrap;padding:12px 14px;border-top:1px solid var(--line,#dbe3ed);font-weight:800;font-size:13px}
      .grdDbFoot .debit{color:#16a36a}.grdDbFoot .credit{color:#e5484d}
      @media(max-width:900px){.grdDbSum{grid-template-columns:1fr 1fr}.grdDbTop{align-items:flex-start}}
      @media(max-width:700px){
        .grdDb{padding:12px;border-radius:14px}
        .grdDbTitle h2{font-size:18px}.grdDbIcon{width:36px;height:36px;font-size:18px}
        .grdDbTools{width:100%}
        .grdDbNav{width:100%}.grdDbNav input{flex:1;min-width:0}
        .grdDbSearch{flex:1 1 100%;width:100%;order:3}
        .grdDbBtn{flex:1}
        .grdDbSumCard strong{font-size:16px}
        .grdDbScroll{display:none}
        .grdDbList{display:block}
        .grdDbItem{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:11px 12px;border-bottom:1px solid var(--line,#dbe3ed)}
        .grdDbItem:last-child{border-bottom:0}
        .grdDbItem .p{font-weight:700;font-size:13px;min-width:0;overflow-wrap:anywhere}
        .grdDbItem .a{font-weight:800;font-size:14px;text-align:right;font-variant-numeric:tabular-nums}
        .grdDbItem .m{font-size:11px;color:var(--muted,#728096)}
        .grdDbItem .b{font-size:11px;color:var(--muted,#728096);text-align:right}
        .grdDbItem.open{background:color-mix(in srgb,var(--accent,#1667d9) 7%,transparent)}
        .grdDbFoot{justify-content:space-between;gap:10px;font-size:12px}
      }
      @media print{.grdPager,.grdDbTools,.grdDbList{display:none!important}.grdDbScroll{display:block!important}.grdDb{box-shadow:none;border:0;padding:0}.grdDbTable th,.grdDbTable td{padding:6px;font-size:9px}}
    `}</style>

    <div className="grdDbTop">
      <div className="grdDbTitle"><div className="grdDbIcon">📖</div><div><h2>Cash / Day Book</h2><p>G.R.D. MOTORS · {dealerLabel}</p></div></div>
      <div className="grdDbTools">
        <div className="grdDbNav">
          <button type="button" aria-label="Previous day" onClick={goPrev}>‹</button>
          <input aria-label="Select date" type="date" value={date} onChange={e=>onDateChange?onDateChange(e.target.value):null}/>
          <button type="button" aria-label="Next day" onClick={goNext}>›</button>
        </div>
        <input className="grdDbSearch" placeholder="Search" value={search} onChange={e=>setSearch(e.target.value)}/>
        <button type="button" className="grdDbBtn" onClick={()=>onPrint?onPrint():window.print()}>🖨 Print</button>
        <button type="button" className="grdDbBtn primary" onClick={onExport}>⇩ Export</button>
      </div>
    </div>

    {!hideSummary&&<div className="grdDbSum">
      <div className="grdDbSumCard"><span>Opening Balance</span><strong>₹{money(openingBalance)}</strong></div>
      <div className="grdDbSumCard"><span>Total Debit · Cash In</span><strong className="debit">₹{money(totalReceipts)}</strong></div>
      <div className="grdDbSumCard"><span>Total Credit · Cash Out</span><strong className="credit">₹{money(totalPayments)}</strong></div>
      <div className="grdDbSumCard"><span>Closing Balance</span><strong>₹{money(close)}</strong></div>
    </div>}

    <div className="grdDbBox">
      <div className="grdDbScroll">
        <table className="grdDbTable">
          <thead><tr>
            <th className="c1">Date</th>
            <th className="c2">Particulars</th>
            <th className="c3 num">Debit<small>Cash In</small></th>
            <th className="c4 num">Credit<small>Cash Out</small></th>
            <th className="c5 num">Balance</th>
          </tr></thead>
          <tbody>
            {page===1&&<tr className="grdDbOpenRow">
              <td className="date">{dateLabel}</td>
              <td>Opening Balance</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num run">{money(openingBalance)}</td>
            </tr>}
            {pageRows.map((row,i)=><tr key={row.id||row.no||i}>
              <td className="date">{formatDate(row.date||date)}</td>
              <td><div style={{fontWeight:700}}>{row.particulars||'—'}</div>{row.no&&<div className="grdDbRef">{ref(row)}</div>}</td>
              <td className="num debit">{row.debit?money(row.debit):'—'}</td>
              <td className="num credit">{row.credit?money(row.credit):'—'}</td>
              <td className="num run">{money(row.running)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="grdDbList">
        {page===1&&<div className="grdDbItem open"><div className="p">Opening Balance</div><div className="a run">₹{money(openingBalance)}</div><div className="m">{dateLabel}</div></div>}
        {pageRows.map((row,i)=><div className="grdDbItem" key={'m'+(row.id||row.no||i)}>
          <div className="p">{row.particulars||'—'}</div>
          <div className={'a '+(row.debit?'debit':'credit')}>{row.debit?'+ ':'− '}₹{money(row.debit||row.credit)}</div>
          <div className="m">{formatDate(row.date||date)}{ref(row)?' · '+ref(row):''}</div>
          <div className="b">Bal ₹{money(row.running)}</div>
        </div>)}
      </div>

      {!rows.length&&<div className="grdDbEmpty">No cash transactions for this date.</div>}
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize}/>
      {!hideSummary&&<div className="grdDbFoot">
        <span>Debit <span className="debit">₹{money(totalReceipts)}</span></span>
        <span>Credit <span className="credit">₹{money(totalPayments)}</span></span>
        <span>Closing ₹{money(close)}</span>
      </div>}
    </div>
  </div>;
}

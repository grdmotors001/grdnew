'use client';
import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { ErrorBanner, Field } from './ui';
import { formatDate } from '../lib/date';
import { Pagination } from './DayBookPreview';

// Bank / Financer (Hypothecation) / Other party ledger.
// Dealer ledger alag (existing) hai; yeh Day Book + Bank Ledger + Hypothecation bills se statement banata hai.

const toList = (d) => Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.items || []);
const ymd10 = (v) => String(v || '').slice(0, 10);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const drcr = (n) => `${inr(Math.abs(n))} ${n >= 0 ? 'Dr' : 'Cr'}`;

const META = {
  BANK: { title: 'Bank Ledger', pick: 'Bank', dr: 'Debit (Received in Bank)', cr: 'Credit (Paid from Bank)', note: 'Debit = bank me paisa aaya, Credit = bank se gaya. Balance Dr = bank me jama.' },
  FINANCER: { title: 'Financer (Hypothecation) Ledger', pick: 'Financer', dr: 'Debit (Loan Bill)', cr: 'Credit (Received)', note: 'Debit = bill par hypothecation (financer se lena), Credit = financer se mila paisa. Balance Dr = financer se abhi lena baaki.' },
  OTHER: { title: 'Other Party Ledger', pick: 'Party', dr: 'Debit (Paid)', cr: 'Credit (Received)', note: 'Debit = party ko diya, Credit = party se mila. Balance Dr = party se lena, Cr = party ko dena.' },
};

export function PartyLedgerView({ type }) {
  const meta = META[type];
  const [dayBook, setDayBook] = useState(null);
  const [bankRows, setBankRows] = useState([]);
  const [banks, setBanks] = useState([]);
  const [financers, setFinancers] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [bills, setBills] = useState([]);
  const [error, setError] = useState('');
  const [party, setParty] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const fail = (e) => setError(e.message || 'Load failed');
    get('/day-book').then(setDayBook).catch(fail);
    get('/bank-ledger?status=all').then((d) => setBankRows(d?.rows || [])).catch(() => {});
    get('/masters/bank').then((d) => setBanks(toList(d))).catch(() => {});
    get('/masters/financer').then((d) => setFinancers(toList(d))).catch(() => {});
    get('/dealers').then((d) => setDealers(d?.dealers || toList(d))).catch(() => {});
    if (type === 'FINANCER') get('/reports/hypothecation-register').then((d) => setBills(toList(d?.invoices ? { rows: d.invoices } : d))).catch(() => {});
  }, [type]);

  // Saari events (sabhi parties ki) ek baar banao
  const { events, names } = useMemo(() => {
    const bankNameById = (id) => banks.find((b) => String(b.id) === String(id))?.name || 'Bank';
    const finSet = new Map(financers.map((f) => [norm(f.name), f.name]));
    const dealerSet = new Set(dealers.map((d) => norm(d.name)));
    const canon = (raw) => finSet.get(norm(raw)) || String(raw || '').trim();
    const ev = [];
    const dbRows = toList(dayBook);
    const posted = bankRows.filter((r) => r.status === 'POSTED');

    if (type === 'BANK') {
      dbRows.filter((r) => r.bank_id).forEach((r) => ev.push({
        party: bankNameById(r.bank_id), date: ymd10(r.date), order: 1, ref: r.vr_no == null ? '' : String(r.vr_no), mode: 'Day Book',
        text: [r.dealer_name, r.narration].filter(Boolean).join(' - '), debit: Number(r.credit_received || 0), credit: Number(r.debit_paid || 0),
      }));
      posted.forEach((r) => ev.push({
        party: r.bank_name || 'Bank', date: ymd10(r.entry_date), order: 1, ref: [r.cheque_no, r.upi_ref].filter(Boolean).join(' / '), mode: 'Bank Excel',
        text: [r.party_name, r.narration].filter(Boolean).join(' - '),
        debit: r.entry_type === 'RECEIPT' ? Math.abs(Number(r.amount || 0)) : 0, credit: r.entry_type === 'PAYMENT' ? Math.abs(Number(r.amount || 0)) : 0,
      }));
    } else if (type === 'FINANCER') {
      bills.filter((b) => Number(b.hypothecation_amount || 0) > 0 && String(b.financer_name || '').trim()).forEach((b) => ev.push({
        party: canon(b.financer_name), date: ymd10(b.date), order: 0, ref: b.bill_no || '', mode: 'Bill',
        text: `Bill ${b.bill_no || '-'} - ${b.buyer_name || ''}${b.chassis_no ? ' (' + b.chassis_no + ')' : ''}`, debit: Number(b.hypothecation_amount || 0), credit: 0,
      }));
      dbRows.filter((r) => finSet.has(norm(r.dealer_name))).forEach((r) => ev.push({
        party: canon(r.dealer_name), date: ymd10(r.date), order: 1, ref: r.vr_no == null ? '' : String(r.vr_no), mode: r.bank_id ? bankNameById(r.bank_id) : 'Cash',
        text: r.narration || 'Receipt', debit: Number(r.debit_paid || 0), credit: Number(r.credit_received || 0),
      }));
      posted.filter((r) => finSet.has(norm(r.party_name))).forEach((r) => ev.push({
        party: canon(r.party_name), date: ymd10(r.entry_date), order: 1, ref: [r.cheque_no, r.upi_ref].filter(Boolean).join(' / '), mode: r.bank_name || 'Bank',
        text: r.narration || 'Receipt',
        debit: r.entry_type === 'PAYMENT' ? Math.abs(Number(r.amount || 0)) : 0, credit: r.entry_type === 'RECEIPT' ? Math.abs(Number(r.amount || 0)) : 0,
      }));
    } else {
      const isOther = (n) => n && !finSet.has(norm(n)) && !dealerSet.has(norm(n));
      dbRows.filter((r) => isOther(r.dealer_name)).forEach((r) => ev.push({
        party: String(r.dealer_name).trim(), date: ymd10(r.date), order: 1, ref: r.vr_no == null ? '' : String(r.vr_no), mode: r.bank_id ? bankNameById(r.bank_id) : 'Cash',
        text: r.narration || '', debit: Number(r.debit_paid || 0), credit: Number(r.credit_received || 0),
      }));
      posted.filter((r) => isOther(r.party_name)).forEach((r) => ev.push({
        party: String(r.party_name).trim(), date: ymd10(r.entry_date), order: 1, ref: [r.cheque_no, r.upi_ref].filter(Boolean).join(' / '), mode: r.bank_name || 'Bank',
        text: r.narration || '',
        debit: r.entry_type === 'PAYMENT' ? Math.abs(Number(r.amount || 0)) : 0, credit: r.entry_type === 'RECEIPT' ? Math.abs(Number(r.amount || 0)) : 0,
      }));
    }
    const base = type === 'BANK' ? banks.map((b) => b.name) : type === 'FINANCER' ? financers.map((f) => f.name) : [];
    return { events: ev, names: [...new Set([...base, ...ev.map((e) => e.party)].filter(Boolean))].sort((a, b) => a.localeCompare(b)) };
  }, [type, dayBook, bankRows, banks, financers, dealers, bills]);

  useEffect(() => { setPage(1); }, [party, from, to, search, pageSize]);

  const balanceOf = (name) => events.filter((e) => e.party === name).reduce((s, e) => s + e.debit - e.credit, 0);
  const summary = useMemo(() => names.map((n) => ({ name: n, balance: balanceOf(n), count: events.filter((e) => e.party === n).length })), [names, events]);

  // ---- Ek party ka statement ----
  const mine = events.filter((e) => e.party === party).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const opening = from ? mine.filter((e) => e.date < from).reduce((s, e) => s + e.debit - e.credit, 0) : 0;
  let run = opening;
  const inRange = mine.filter((e) => (!from || e.date >= from) && (!to || e.date <= to)).map((e) => { run += e.debit - e.credit; return { ...e, bal: run }; });
  const q = search.trim().toLowerCase();
  const rows = q ? inRange.filter((e) => [e.text, e.ref, e.mode, e.date].join(' ').toLowerCase().includes(q)) : inRange;
  const totDr = rows.reduce((s, e) => s + e.debit, 0), totCr = rows.reduce((s, e) => s + e.credit, 0);
  const closing = opening + inRange.reduce((s, e) => s + e.debit - e.credit, 0);
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  const rangeLabel = (from || to) ? `${from ? formatDate(from) : 'Start'} to ${to ? formatDate(to) : 'Today'}` : 'All dates';
  const printIt = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const body = rows.map((e) => `<tr><td>${esc(formatDate(e.date))}</td><td>${esc(e.text)}</td><td>${esc(e.mode)}</td><td>${esc(e.ref)}</td><td class="n">${e.debit ? inr(e.debit) : ''}</td><td class="n">${e.credit ? inr(e.credit) : ''}</td><td class="n">${drcr(e.bal)}</td></tr>`).join('');
    w.document.write(`<html><head><title>${esc(party)}</title><style>body{font-family:Arial,sans-serif;font-size:11px;padding:16px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.n{text-align:right}tfoot td{font-weight:700}</style></head><body><h2>G.R.D. MOTORS — ${esc(meta.title)}</h2><div><b>${esc(party)}</b> · ${esc(rangeLabel)}</div><table><thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th>Ref</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${from ? `<tr><td colspan="6"><b>Opening Balance</b></td><td class="n">${drcr(opening)}</td></tr>` : ''}${body}</tbody><tfoot><tr><td colspan="4">Total</td><td class="n">${inr(totDr)}</td><td class="n">${inr(totCr)}</td><td class="n">${drcr(closing)}</td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };
  const exportIt = async () => {
    try {
      const XLSX = await import('xlsx');
      const aoa = [['Date', 'Particulars', 'Mode', 'Ref', 'Debit', 'Credit', 'Balance'],
        ...(from ? [['', 'Opening Balance', '', '', '', '', drcr(opening)]] : []),
        ...rows.map((e) => [formatDate(e.date), e.text, e.mode, e.ref, e.debit || '', e.credit || '', drcr(e.bal)]),
        ['', 'Total', '', '', totDr, totCr, drcr(closing)]];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Ledger');
      XLSX.writeFile(wb, `${meta.pick}_Ledger_${party.replace(/[^a-z0-9]+/gi, '_')}.xlsx`);
    } catch (e) { setError(e.message || 'Export failed'); }
  };

  if (!dayBook && !error) return <div className="card">Loading…</div>;

  // ---- Party list (summary) ----
  if (!party) {
    const list = summary.filter((s) => !listSearch || s.name.toLowerCase().includes(listSearch.toLowerCase()));
    return <>
      <ErrorBanner message={error} />
      <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>{meta.note}</div>
      <div className="toolbar"><Field label={`Search ${meta.pick}`} value={listSearch} onChange={setListSearch} /></div>
      {!list.length ? <div className="card muted">Koi {meta.pick.toLowerCase()} nahi mila.</div> : (
        <div className="tablewrap"><table className="table">
          <thead><tr><th>{meta.pick}</th><th style={{ textAlign: 'right' }}>Entries</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
          <tbody>{list.map((s) => <tr key={s.name} onClick={() => setParty(s.name)} style={{ cursor: 'pointer' }} title="Click to view ledger">
            <td><b>{s.name}</b></td><td style={{ textAlign: 'right' }}>{s.count}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{s.count ? drcr(s.balance) : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </>;
  }

  // ---- Statement ----
  return <>
    <ErrorBanner message={error} />
    <div className="toolbar">
      <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setParty(''); setFrom(''); setTo(''); setSearch(''); }}>← All {meta.pick}s</button>
      <Field label={meta.pick} type="select" value={party} options={names.map((n) => ({ value: n, label: n }))} onChange={(v) => setParty(v)} />
      <Field label="From" type="date" value={from} onChange={setFrom} />
      <Field label="To" type="date" value={to} onChange={setTo} />
      <Field label="Search" value={search} onChange={setSearch} />
      <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={printIt}>Print</button>
      <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={exportIt}>Export Excel</button>
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
      <div className="card" style={{ flex: '1 1 180px' }}><div className="muted">Total Debit</div><div className="metric" style={{ fontSize: 22 }}>₹{inr(totDr)}</div></div>
      <div className="card" style={{ flex: '1 1 180px' }}><div className="muted">Total Credit</div><div className="metric" style={{ fontSize: 22 }}>₹{inr(totCr)}</div></div>
      <div className="card" style={{ flex: '1 1 180px' }}><div className="muted">Balance</div><div className="metric" style={{ fontSize: 22, color: 'var(--accent)' }}>₹{drcr(closing)}</div></div>
    </div>
    <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>{meta.note}</div>
    <div className="tablewrap"><table className="table">
      <thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th>Ref</th><th style={{ textAlign: 'right' }}>{meta.dr}</th><th style={{ textAlign: 'right' }}>{meta.cr}</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
      <tbody>
        {from && page === 1 && <tr><td colSpan={6}><b>Opening Balance</b></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{drcr(opening)}</td></tr>}
        {paged.map((e, i) => <tr key={i}>
          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td><td>{e.text || '—'}</td><td>{e.mode}</td><td>{e.ref || '—'}</td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{e.debit ? inr(e.debit) : ''}</td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{e.credit ? inr(e.credit) : ''}</td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{drcr(e.bal)}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Is period me koi entry nahi.</td></tr>}
      </tbody>
      {rows.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 800 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(totDr)}</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(totCr)}</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{drcr(closing)}</td></tr></tfoot>}
    </table>
    <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} /></div>
  </>;
}

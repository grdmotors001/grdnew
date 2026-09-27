'use client';

import { useEffect, useState } from 'react';
import { get, downloadExcel } from '../lib/api';
import { ErrorBanner, EmptyState, Field, Money } from './ui';

function ExpenseLine({ label, value }) {
  return <div className="clExpenseLine"><span>{label}</span><b><Money value={value} /></b></div>;
}

function Detail({ row, onClose }) {
  if (!row) return null;
  const expenses = [
    ['Sale Value', row.sale_value],
    ['Loan Value', row.loan_value],
    ['File Charge', row.file_charge],
    ['Incentive', row.incentive_amount],
    ['Registration', row.registration_amount],
    ['Insurance', row.insurance_amount],
    ['Commission', row.commission_amount],
    ['RTO Fee', row.rto_fee],
    ['Insurance Fee', row.insurance_fee],
    ['Subsidy', row.subsidy_amount],
    ['Amount Received', row.amount_received],
    ['Balance', row.balance],
  ];
  const extras = Array.isArray(row.expense_details) ? row.expense_details : [];

  return (
    <div className="modal customerLedgerModal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>`
        .customerLedgerPrintRoot{background:#fff;color:#172b43;max-width:1000px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif}
        .clTop{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #173d67;padding-bottom:14px}
        .clIdentity{display:flex;gap:16px;align-items:center}.clPhoto{width:82px;height:82px;border-radius:12px;border:1px solid #d5e0e8;object-fit:cover;background:#f5f8fa}
        .clTitle{margin:0;font-size:22px}.clSub{color:#66798c;font-size:12px;margin-top:4px}
        .clMeta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}
        .clMetaBox{border:1px solid #dce5ec;border-radius:9px;padding:9px}.clMetaBox span{display:block;color:#718397;font-size:10px;text-transform:uppercase}.clMetaBox b{font-size:13px}
        .clGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.clCard{border:1px solid #dce5ec;border-radius:10px;padding:13px}.clCard h4{margin:0 0 10px;color:#173d67}
        .clExpenseLine{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #edf1f4;padding:7px 0;font-size:12px}.clExpenseLine:last-child{border-bottom:0}
        .clTable{width:100%;border-collapse:collapse;font-size:11px}.clTable th,.clTable td{border:1px solid #dce5ec;padding:7px;text-align:left}.clTable th{background:#f3f7fa}
        .clActions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
        @media(max-width:700px){.clMeta,.clGrid{grid-template-columns:1fr}.customerLedgerPrintRoot{padding:14px}.clTop{flex-direction:column}}
        @media print{
          body *{visibility:hidden!important}
          .customerLedgerPrintRoot,.customerLedgerPrintRoot *{visibility:visible!important}
          .customerLedgerPrintRoot{position:absolute!important;left:0!important;top:0!important;width:100%!important;max-width:none!important;margin:0!important;padding:12mm!important}
          .clActions{display:none!important}
          .customerLedgerModal{position:static!important;background:#fff!important}
        }
      `</style>
      <div className="modalbox" style={{ maxWidth: 1080, width: '96vw' }}>
        <div className="customerLedgerPrintRoot">
          <div className="clTop">
            <div className="clIdentity">
              {row.photo_url ? <img className="clPhoto" src={row.photo_url} alt="Customer" /> : <div className="clPhoto" style={{display:'grid',placeItems:'center',fontSize:30}}>👤</div>}
              <div>
                <h2 className="clTitle">Customer Complete Ledger</h2>
                <div className="clSub">{row.customer_name || '—'} · {row.dealer_name || '—'}</div>
                <div className="clSub">Generated from linked sale, vehicle, loan and expense records</div>
              </div>
            </div>
            <div><b>Record No.: {row.record_no || '—'}</b><div className="clSub">{row.date || ''}</div></div>
          </div>

          <div className="clMeta">
            <div className="clMetaBox"><span>Customer</span><b>{row.customer_name || '—'}</b></div>
            <div className="clMetaBox"><span>Dealer</span><b>{row.dealer_name || '—'}</b></div>
            <div className="clMetaBox"><span>Vehicle No.</span><b>{row.vehicle_no || '—'}</b></div>
            <div className="clMetaBox"><span>Chassis No.</span><b>{row.chassis_no || '—'}</b></div>
            <div className="clMetaBox"><span>DO No.</span><b>{row.do_no || '—'}</b></div>
            <div className="clMetaBox"><span>Ledger No.</span><b>{row.ledger_no || '—'}</b></div>
            <div className="clMetaBox"><span>Chassis Record</span><b>{row.chassis_record_no || '—'}</b></div>
            <div className="clMetaBox"><span>Bill No.</span><b>{row.bill_no || '—'}</b></div>
            <div className="clMetaBox"><span>Delivery Challan</span><b>{row.challan_no || '—'}</b></div>
          </div>

          <div className="clGrid">
            <div className="clCard">
              <h4>Customer / Vehicle Details</h4>
              <table className="clTable">
                <tbody>
                  <tr><td>Name</td><td>{row.customer_name || '—'}</td></tr>
                  <tr><td>Mobile</td><td>{row.customer_mobile || '—'}</td></tr>
                  <tr><td>Address</td><td>{row.customer_address || '—'}</td></tr>
                  <tr><td>Model</td><td>{row.model || '—'}</td></tr>
                  <tr><td>Colour</td><td>{row.colour || '—'}</td></tr>
                  <tr><td>Motor No.</td><td>{row.motor_no || '—'}</td></tr>
                  <tr><td>Salesman</td><td>{row.salesman || '—'}</td></tr>
                  <tr><td>Financer</td><td>{row.financer || '—'}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="clCard">
              <h4>Financial / Expense Details</h4>
              {expenses.map(([label, value]) => <ExpenseLine key={label} label={label} value={value} />)}
              {extras.length > 0 && (
                <div style={{marginTop:10}}>
                  <div className="clSub" style={{marginBottom:4}}>Other linked expenses</div>
                  {extras.map((e, i) => <ExpenseLine key={i} label={e.type || e.label || 'Other'} value={e.amount} />)}
                </div>
              )}
            </div>
          </div>

          <div className="clCard" style={{marginTop:14}}>
            <h4>Document / Record References</h4>
            <table className="clTable">
              <tbody>
                <tr><td>Application No.</td><td>{row.application_no || '—'}</td><td>Voucher No.</td><td>{row.voucher_no || '—'}</td></tr>
                <tr><td>Record No.</td><td>{row.record_no || '—'}</td><td>Page No.</td><td>{row.page_no || '—'}</td></tr>
                <tr><td>DO No.</td><td>{row.do_no || '—'}</td><td>Ledger No.</td><td>{row.ledger_no || '—'}</td></tr>
                <tr><td>Chassis Record No.</td><td>{row.chassis_record_no || '—'}</td><td>Challan No.</td><td>{row.challan_no || '—'}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="clActions">
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn primary" onClick={() => window.print()}>Print Full Ledger</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CustomerExpenseLedgerReportPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  const load = () => {
    setError('');
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (search) q.set('search', search);
    q.set('page', '1'); q.set('per_page', '100');
    get('/reports/customer-expense-ledger?' + q.toString()).then(setData).catch((e) => setError(e.message || 'Could not load customer ledger report'));
  };

  useEffect(load, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="card">Loading customer ledger report…</div>;

  return (
    <>
      <div className="toolbar">
        <Field label="From" type="date" value={from} onChange={setFrom} />
        <Field label="To" type="date" value={to} onChange={setTo} />
        <Field label="Search customer / chassis / dealer / vehicle" value={search} onChange={setSearch} />
        <button className="btn primary" style={{alignSelf:'flex-end'}} onClick={load}>Search</button>
        <button className="btn" style={{alignSelf:'flex-end'}} onClick={() => downloadExcel('/reports/customer-expense-ledger?' + new URLSearchParams({ from, to, search }).toString(), 'Customer_Expense_Ledger.xlsx')}>Export Excel</button>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <b>Customer Expense / Complete Ledger</b>
        <div className="muted" style={{marginTop:4}}>Linked sale, loan, dealer, vehicle, documents and expense heads. New expense heads can be added later without changing this report.</div>
      </div>

      {data.rows.length === 0 ? <EmptyState text="No linked customer records found." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th><th>Chassis No.</th><th>Dealer</th><th>Vehicle No.</th><th>Sale Value</th><th>Loan Value</th><th>Expenses</th><th>Record No.</th><th>Print</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}>{r.photo_url ? <img src={r.photo_url} alt="" style={{width:34,height:34,borderRadius:6,objectFit:'cover'}}/> : <span>👤</span>}<div><b>{r.customer_name || '—'}</b><div className="muted">{r.customer_mobile || ''}</div></div></div></td>
                  <td>{r.chassis_no || '—'}</td>
                  <td>{r.dealer_name || '—'}</td>
                  <td>{r.vehicle_no || '—'}</td>
                  <td><Money value={r.sale_value} /></td>
                  <td><Money value={r.loan_value} /></td>
                  <td><Money value={r.expense_total} /></td>
                  <td>{r.record_no || '—'}</td>
                  <td><button className="btn" onClick={() => setDetail(r)}>Print</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <Detail row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

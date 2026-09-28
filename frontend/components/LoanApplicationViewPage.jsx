'use client';

import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { formatDate } from '../lib/date';

const STATUS_LABELS = {
  DO_PENDING: 'Pending for FE',
  FE_ASSIGNED: 'AT FE',
  FE_APPROVED: 'FE Approved',
  FE_SUBMITTED: 'FE Approved',
  DO_APPROVED: 'DO Approved',
  TVR_PENDING: 'AT TVR',
  DISBURSEMENT_PENDING: 'Pending for Disbursement',
  DISBURSED: 'Disbursed',
  DO_HOLD: 'On Hold',
  DO_REJECTED: 'Rejected',
  DO_EXPIRED: 'DO Expired',
};

const statusLabel = (status) => STATUS_LABELS[status] || status || '—';

function isPendingBill(row) {
  const s = String(row.status || '').toLowerCase();
  const tvr = String(row.tvr_status || '').toLowerCase();
  return s === 'approved' && !['submitted','hold','failed','verified'].includes(tvr);
}

function currentStatusLabel(row) {
  const s = String(row.status || '').toLowerCase();
  const tvr = String(row.tvr_status || '').toLowerCase();
  if (s === 'disbursed') return 'Disbursed';
  if (s === 'fi_pending' || s === 'submitted') return 'Pending at FE';
  if (s === 'fi_done') return 'Pending at DO';
  if (s === 'approved' && tvr === 'submitted') return 'Pending at DO — TVR';
  if (s === 'approved' && tvr === 'hold') return 'TVR On Hold';
  if (s === 'approved' && tvr === 'failed') return 'TVR Failed';
  if (s === 'approved' && tvr === 'verified') return 'TVR Verified — Ready for Disbursement';
  if (s === 'approved') return 'Pending for Bill';
  return String(row.status || row.lifecycle_status || 'Pending').replaceAll('_',' ');
}

function stageOf(row) {
  const s = String(row.status || '').toLowerCase();
  const tvr = String(row.tvr_status || '').toLowerCase();
  if (s === 'fi_pending' || s === 'submitted') return 'FE';
  if (s === 'fi_done' || (s === 'approved' && tvr === 'submitted')) return 'DO';
  if (s === 'approved' && ['hold','failed','verified'].includes(tvr)) return 'TVR';
  return '';
}

export function LoanApplicationViewPage({ user }) {
  const isAdmin = !!user?.is_super_user || String(user?.department || '').trim().toLowerCase() === 'admin';
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setError('');
      const data = await get('/dealer/loan-status', { noClientCache: true });
      setRows(data.applications || []);
    } catch (e) {
      setError(e.message || 'Could not load loan applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]);

  const counts = useMemo(() => ({
    all: rows.length,
    bill: rows.filter(isPendingBill).length,
    fe: rows.filter(r => stageOf(r) === 'FE').length,
    do: rows.filter(r => stageOf(r) === 'DO').length,
    tvr: rows.filter(r => r.status === 'TVR_PENDING').length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const matchTab =
        tab === 'all' ? true :
        tab === 'bill' ? isPendingBill(r) :
        tab === 'fe' ? stageOf(r) === 'FE' :
        tab === 'do' ? stageOf(r) === 'DO' :
        stageOf(r) === 'TVR';
      if (!matchTab) return false;
      if (!q) return true;
      return [
        r.application_no, r.customer_name, r.customer_phone, r.dealer_name, r.vehicle_model_name,
        r.loan_vehicle_type, r.status, r.lifecycle_status, r.tvr_status, r.fe_user_id, r.do_user_id,
        r.loan_account_no, r.tenure_months
      ].join(' ').toLowerCase().includes(q);
    });
  }, [rows, tab, search]);

  const open = (row) => setSelected(row);

  const tabs = [
    ['all', 'ALL APPLICATION', counts.all],
    ['bill', 'PENDING FOR BILL', counts.bill],
    ['fe', 'AT FE', counts.fe],
    ['do', 'AT DO', counts.do],
    ['tvr', 'AT TVR', counts.tvr],
  ];

  if (!isAdmin) return <div className="error">Admin access required.</div>;

  return (
    <div className="loanApplicationViewPage">
      <style>{`
        .loanApplicationViewPage{padding:2px 0 40px}
        .loanApplicationViewHead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
        .loanApplicationViewKicker{font-size:10px;font-weight:900;letter-spacing:1px;color:#8b1638;text-transform:uppercase}
        .loanApplicationViewHead h2{margin:2px 0 4px;color:#5d0925;font-size:25px}
        .loanApplicationViewHead p{margin:0;color:#748297;font-size:12px}
        .loanApplicationViewActions{display:flex;gap:8px;align-items:center}
        .loanApplicationViewTabs{display:flex;gap:0;border:1px solid #ead8d4;border-radius:12px;background:#fff7f5;overflow:hidden;margin-bottom:14px}
        .loanApplicationViewTab{border:0;background:transparent;padding:12px 18px;color:#531126;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap}
        .loanApplicationViewTab.active{background:#86183a;color:#fff;border-radius:9px;margin:3px}
        .loanApplicationViewCard{background:#fff;border-radius:14px;box-shadow:0 5px 18px rgba(31,55,79,.07);overflow:hidden}
        .loanApplicationViewToolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #edf1f5}
        .loanApplicationViewToolbar h3{margin:0;color:#5d0925;font-size:15px}
        .loanApplicationViewToolbar p{margin:3px 0 0;color:#7b8898;font-size:11px}
        .loanApplicationViewSearch{width:min(290px,100%);min-height:38px;border:1px solid #e7d7d3;border-radius:8px;padding:8px 11px;box-sizing:border-box}
        .loanApplicationViewTableWrap{overflow-x:auto}
        .loanApplicationViewTable{min-width:980px}
        .loanApplicationViewTable th{background:#fde9df;color:#6c102b;font-size:9px;text-transform:uppercase}
        .loanApplicationViewTable td{font-size:11px}
        .loanApplicationViewStatus{display:inline-flex;padding:5px 8px;border-radius:999px;background:#e8f7ef;color:#19733a;font-size:10px;font-weight:800;white-space:nowrap}
        .loanApplicationViewOpen{white-space:nowrap}
        .loanApplicationViewEmpty{padding:30px;text-align:center;color:#7b8898;font-size:12px}
        .loanApplicationViewModal{z-index:99999}
        .loanApplicationViewModalBox{width:min(820px,100%);max-height:calc(100vh - 32px);overflow:auto}
        .loanApplicationViewSummary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:12px}
        .loanApplicationViewSummary>div{border:1px solid #e5ebf2;border-radius:9px;padding:10px;background:#fbfdff}
        .loanApplicationViewSummary span{display:block;font-size:9px;color:#7b8898;text-transform:uppercase}
        .loanApplicationViewSummary b{display:block;margin-top:3px;font-size:12px;color:#26394f;word-break:break-word}
        @media(max-width:800px){.loanApplicationViewHead{display:block}.loanApplicationViewActions{margin-top:10px}.loanApplicationViewTabs{overflow-x:auto}.loanApplicationViewTab{padding:10px 13px}.loanApplicationViewToolbar{display:block}.loanApplicationViewSearch{margin-top:10px;width:100%}.loanApplicationViewSummary{grid-template-columns:1fr 1fr}}
      `}</style>

      <div className="loanApplicationViewHead">
        <div>
          <div className="loanApplicationViewKicker">LOAN APPLICATION</div>
          <h2>Loan Application</h2>
          <p>Complete application pipeline with live current status. View only.</p>
        </div>
        <div className="loanApplicationViewActions">
          <button className="btn" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div className="loanApplicationViewTabs">
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" className={'loanApplicationViewTab' + (tab === key ? ' active' : '')} onClick={() => setTab(key)}>
            {label} <b>{count}</b>
          </button>
        ))}
      </div>

      {error && <div className="error" style={{marginBottom:12}}>{error}</div>}

      <div className="loanApplicationViewCard">
        <div className="loanApplicationViewToolbar">
          <div>
            <h3>{tabs.find(x => x[0] === tab)?.[1] || 'Applications'}</h3>
            <p>Current workflow status is shown for every application.</p>
          </div>
          <input className="loanApplicationViewSearch" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Search application / customer / dealer / mobile" />
        </div>

        {loading ? <div className="loanApplicationViewEmpty">Loading applications…</div> :
          <div className="loanApplicationViewTableWrap">
            <table className="table loanApplicationViewTable">
              <thead><tr>
                <th>Application</th><th>Customer</th><th>Dealer</th><th>Vehicle</th>
                <th>Current Status</th><th>Loan Account</th><th>Submitted</th><th>Action</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => <tr key={r.id}>
                  <td><b>{r.application_no || '—'}</b></td>
                  <td>{r.customer_name || '—'}</td>
                  <td>{r.dealer_name || '—'}</td>
                  <td>{r.vehicle_model_name || '—'}{r.loan_amount_requested ? <><br/><span className="muted">₹{Number(r.loan_amount_requested).toLocaleString('en-IN')}</span></> : null}</td>
                  <td><span className="loanApplicationViewStatus">{currentStatusLabel(r)}</span><br/><span className="muted">{r.tvr_status ? ('TVR: ' + r.tvr_status.replaceAll('_',' ')) : 'CHFPL current status'}</span></td>
                  <td>{r.loan_account_no || '—'}</td>
                  <td>{r.submitted_at ? formatDate(r.submitted_at) : '—'}</td>
                  <td><button type="button" className="btn loanApplicationViewOpen" onClick={() => open(r)}>Open</button></td>
                </tr>)}
                {!filtered.length && <tr><td colSpan="8"><div className="loanApplicationViewEmpty">No applications found.</div></td></tr>}
              </tbody>
            </table>
          </div>}
      </div>

      {selected && <div className="modal loanApplicationViewModal" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
        <div className="modalbox loanApplicationViewModalBox">
          <div className="actions" style={{justifyContent:'space-between'}}>
            <div><div className="loanApplicationViewKicker">APPLICATION VIEW</div><h2 style={{margin:'2px 0 4px'}}>{selected.application_no}</h2><div className="muted">{selected.customer_name || '—'} · {selected.dealer_name || '—'}</div></div>
            <button className="btn" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="loanApplicationViewSummary">
            <div><span>Status</span><b>{currentStatusLabel(selected)}</b></div>
            <div><span>Vehicle</span><b>{selected.vehicle_model_name || '—'}</b></div>
            <div><span>Loan Amount</span><b>₹ {Number(selected.loan_amount_requested || 0).toLocaleString('en-IN')}</b></div>
            <div><span>FE</span><b>{selected.lifecycle_status || '—'}</b></div>
            <div><span>DO</span><b>{selected.tvr_status || '—'}</b></div>
            <div><span>Chassis</span><b>{selected.loan_account_no || '—'}</b></div>
            <div><span>Billing</span><b>{selected.status || '—'}</b></div>
            <div><span>Submitted</span><b>{selected.created_at ? formatDate(selected.created_at) : '—'}</b></div>
          </div>
          <div style={{marginTop:18,padding:12,border:'1px solid #e5ebf2',borderRadius:9,background:'#fbfdff'}}><b>Current Status Only</b><div className="muted" style={{marginTop:5}}>Status is read directly from CHFPL. GRD does not display the CHFPL status history here.</div></div>
        </div>
      </div>}
    </div>
  );
}

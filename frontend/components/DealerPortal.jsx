'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { formatDate } from '../lib/date';

export function DealerPortal({ dealer, onLogout }) {
  const [stock, setStock] = useState(null);
  const [challans, setChallans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('stock');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get('/dealer/stock'), get('/dealer/delivery-challans'), get('/dealer/tax-invoices')])
      .then(([s, c, i]) => { setStock(s); setChallans(c.challans || []); setInvoices(i.invoices || []); })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="dealerPortal">
      <header className="dealerPortalHeader">
        <div><h1>G.R.D. Motors — Dealer Portal</h1><div className="muted">{dealer.name} · {dealer.code || dealer.login_id}</div></div>
        <button className="btn" onClick={onLogout}>Log Out</button>
      </header>
      {error && <div className="error">{error}</div>}
      <div className="grid dealerMetrics">
        <div className="card"><div className="muted">Current Stock</div><div className="metric">{stock?.count ?? '—'}</div></div>
        <div className="card"><div className="muted">Delivery Challans</div><div className="metric">{challans.length}</div></div>
        <div className="card"><div className="muted">Tax Invoices</div><div className="metric">{invoices.length}</div></div>
      </div>
      <div className="actions dealerTabs">
        <button className={'btn' + (tab === 'stock' ? ' primary' : '')} onClick={() => setTab('stock')}>My Stock</button>
        <button className={'btn' + (tab === 'challans' ? ' primary' : '')} onClick={() => setTab('challans')}>Delivery Challans</button>
        <button className={'btn' + (tab === 'invoices' ? ' primary' : '')} onClick={() => setTab('invoices')}>Tax Invoices</button>
      </div>
      {tab === 'stock' && <DealerTable headers={['Date','Chassis No.','Model','Motor No.','Colour']}>{(stock?.vehicles || []).map(v => <tr key={v.id}><td>{formatDate(v.date)}</td><td><b>{v.chassis_no}</b></td><td>{v.model_name}</td><td>{v.motor_no}</td><td>{v.colour}</td></tr>)}</DealerTable>}
      {tab === 'challans' && <DealerTable headers={['Date','Challan No.','Chassis No.','Model','Destination']}>{challans.map(c => <tr key={c.id}><td>{formatDate(c.date)}</td><td>{c.challan_no}</td><td>{c.chassis_no}</td><td>{c.product_name}</td><td>{c.destination}</td></tr>)}</DealerTable>}
      {tab === 'invoices' && <DealerTable headers={['Date','Bill No.','Chassis No.','Model','Buyer','Total']}>{invoices.map(i => <tr key={i.id}><td>{formatDate(i.date)}</td><td>{i.bill_no}</td><td>{i.chassis_no}</td><td>{i.product_name}</td><td>{i.buyer_name}</td><td>{i.bill_total}</td></tr>)}</DealerTable>}
    </div>
  );
}

function DealerTable({ headers, children }) {
  return <div className="tablewrap dealerTable"><table className="table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

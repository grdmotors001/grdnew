'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { formatDate } from '../lib/date';
import { ErrorBanner, EmptyState } from './ui';

const sourceLabel = (row) => {
  if (row.source_type === 'PURCHASE') return 'Purchase';
  if (row.source_type === 'DELIVERY_CHALLAN_CANCEL') return 'Delivery Challan Cancel';
  return 'Delivery Challan';
};

export function BatteryRegisterPage() {
  const [data, setData] = useState({ summary: [], details: [], makers: [] });
  const [search, setSearch] = useState('');
  const [selectedMaker, setSelectedMaker] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (q = search) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('search', q.trim());
      const r = await get('/battery-register' + (params.toString() ? '?' + params : ''));
      setData(r || { summary: [], details: [], makers: [] });
    } catch (e) {
      setError(e.message || 'Could not load Battery Register.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(''); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const details = useMemo(() => {
    if (!selectedMaker) return data.details || [];
    return (data.details || []).filter(
      x => String(x.battery_maker || '').trim().toLowerCase() === selectedMaker.trim().toLowerCase()
    );
  }, [data.details, selectedMaker]);

  const openPreview = async (row) => {
    try {
      setError('');
      const type = row.source_type === 'PURCHASE' ? 'purchase' : 'delivery_challan';
      const r = await get('/battery-register/preview?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(row.source_id));
      setPreview(r);
    } catch (e) {
      setError(e.message || 'Could not load preview.');
    }
  };

  const clearFilters = () => {
    setSelectedMaker('');
    setSearch('');
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Battery Register</h2>
            <div className="muted" style={{ marginTop: 4 }}>
              Company-wise Battery In / Out / Balance. Purchase par quantity, Delivery Challan par Battery No.
            </div>
          </div>
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Battery Company / Battery No. / Purchase / Challan…"
            style={{ minWidth: 280, maxWidth: 460, flex: 1 }}
          />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div>
            <b>Battery Company Summary</b>
            <div className="muted" style={{ fontSize: 12 }}>Battery name par click karke us company ki date-wise entries dekhein.</div>
          </div>
          {selectedMaker && <button className="btn" onClick={clearFilters}>Show All Companies</button>}
        </div>
        {loading && !data.summary?.length ? <div className="muted">Loading…</div> : (data.summary || []).length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Battery Company</th><th>In</th><th>Out</th><th>Balance</th></tr></thead>
              <tbody>
                {data.summary.map(row => (
                  <tr key={row.battery_maker} onClick={() => setSelectedMaker(row.battery_maker)} style={{ cursor: 'pointer' }} title="Click to open this battery company's entries">
                    <td><b>{row.battery_maker}</b></td>
                    <td>{Number(row.in_qty || 0)}</td>
                    <td>{Number(row.out_qty || 0)}</td>
                    <td><b>{Number(row.balance || 0)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div>
            <b>{selectedMaker ? selectedMaker + ' — Battery Details' : 'Date-wise Battery Details'}</b>
            <div className="muted" style={{ fontSize: 12 }}>Purchase aur Delivery Challan dono yahan linked hain.</div>
          </div>
          <span className="muted">{details.length} entries</span>
        </div>
        {details.length === 0 ? <EmptyState /> : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Battery Company</th><th>Type</th><th>Party / Dealer</th>
                  <th>Battery No. 1</th><th>Battery No. 2</th><th>Battery No. 3</th><th>Battery No. 4</th>
                  <th>Qty</th><th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {details.map(row => (
                  <tr key={row.source_type + '-' + row.source_id + '-' + row.entry_type + '-' + row.date + '-' + row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td><b>{row.battery_maker || '—'}</b></td>
                    <td>
                      <span className={'pill ' + (row.entry_type === 'IN' ? 't' : 'd')}>
                        {row.entry_type === 'IN' ? 'IN' : 'OUT'}
                      </span>
                      <div style={{ fontSize: 11, marginTop: 4 }}>{sourceLabel(row)}</div>
                    </td>
                    <td>{row.party_name || '—'}</td>
                    <td>{row.battery_no1 || '—'}</td>
                    <td>{row.battery_no2 || '—'}</td>
                    <td>{row.battery_no3 || '—'}</td>
                    <td>{row.battery_no4 || '—'}</td>
                    <td><b>{Number(row.qty || 0)}</b></td>
                    <td>
                      <button className="btn" onClick={() => openPreview(row)}>
                        {row.source_type === 'PURCHASE' ? 'Purchase Preview' : 'Delivery Challan Preview'}
                      </button>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{row.source_no || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="modalbox" style={{ maxWidth: 980 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>{preview.type === 'purchase' ? 'Purchase Preview' : 'Delivery Challan Preview'}</h2>
                <div className="muted" style={{ marginTop: 4 }}>
                  {preview.type === 'purchase' ? preview.purchase?.bill_no || 'Purchase Bill' : preview.challan?.challan_no || 'Delivery Challan'}
                </div>
              </div>
              <button className="btn" onClick={() => setPreview(null)}>Close</button>
            </div>

            {preview.type === 'purchase' ? (
              <div style={{ marginTop: 18 }}>
                <div className="formgrid">
                  <div><b>Supplier / Party</b><div>{preview.purchase?.party_name || '—'}</div></div>
                  <div><b>Bill No.</b><div>{preview.purchase?.bill_no || '—'}</div></div>
                  <div><b>Date</b><div>{formatDate(preview.purchase?.date)}</div></div>
                  <div><b>GSTIN</b><div>{preview.purchase?.party_gst_no || '—'}</div></div>
                </div>
                <div className="tablewrap" style={{ marginTop: 16 }}>
                  <table className="table">
                    <thead><tr><th>Item</th><th>Battery Company</th><th>Qty</th><th>Rate</th><th>GST %</th></tr></thead>
                    <tbody>
                      {(preview.purchase?.items || []).map((it, i) => (
                        <tr key={i}><td>{it.item_name || '—'}</td><td>{it.battery_maker || '—'}</td><td>{it.qty || 0}</td><td>{it.rate || 0}</td><td>{it.gst_rate || 0}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 18 }}>
                <div className="formgrid">
                  <div><b>Date</b><div>{formatDate(preview.challan?.date)}</div></div>
                  <div><b>Challan No.</b><div>{preview.challan?.challan_no || '—'}</div></div>
                  <div><b>Dealer</b><div>{preview.challan?.dealer_name || '—'}</div></div>
                  <div><b>Chassis No.</b><div>{preview.challan?.chassis_no || '—'}</div></div>
                  <div><b>Model</b><div>{preview.challan?.model_name || preview.challan?.product_name || '—'}</div></div>
                  <div><b>Status</b><div>{preview.challan?.cancelled ? 'Cancelled' : 'Active'}</div></div>
                </div>
                <div className="card" style={{ marginTop: 16, background: '#f8fafc' }}>
                  <b>Battery Make & Numbers</b>
                  <div className="formgrid" style={{ marginTop: 10 }}>
                    <div><b>Battery Company</b><div>{preview.challan?.battery_maker || '—'}</div></div>
                    <div><b>Battery No. 1</b><div>{preview.challan?.battery_no1 || '—'}</div></div>
                    <div><b>Battery No. 2</b><div>{preview.challan?.battery_no2 || '—'}</div></div>
                    <div><b>Battery No. 3</b><div>{preview.challan?.battery_no3 || '—'}</div></div>
                    <div><b>Battery No. 4</b><div>{preview.challan?.battery_no4 || '—'}</div></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

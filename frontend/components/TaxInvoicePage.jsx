'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { TaxInvoicePrintView } from './PrintDocs';

const today = () => new Date().toISOString().slice(0, 10);

export function TaxInvoicePage() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ date: today(), state_type: 'I', gst_rate: 5 });
  const [printId, setPrintId] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [challanSearch, setChallanSearch] = useState('');
  const [financers, setFinancers] = useState([]);
  const filteredChallans = (data?.uninvoiced_challans || []).filter((c) => {
    const q = challanSearch.trim().toLowerCase();
    if (!q) return true;
    return [c.challan_no, c.chassis_no, c.dealer_name, c.product_name, c.colour]
      .some(v => String(v || '').toLowerCase().includes(q));
  });
  const { busy, error, setError, run } = useAsyncAction();

  useEffect(() => { get('/masters/financer').then((d) => setFinancers(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const tiBalance = (Number(form.sale_amount) || 0) - (Number(form.hypothecation_amount) || 0) - (Number(form.amount_received) || 0);

  // 16,000+ tax invoices exist in production -- fetch one page at a time
  // (backend paginates) instead of the whole table at once, which used to
  // time out / 500 the request.
  const load = (p = page, s = search) => {
    const params = new URLSearchParams({ page: p, per_page: 50 });
    if (s) params.set('search', s);
    get(`/tax-invoices?${params}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(1, search); }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const openNew = () => {
    setEditingId(null);
    setChallanSearch('');
    setForm({ date: today(), state_type: 'I', gst_rate: 5 });
    setStep(0);
    setOpen(true);
  };

  // Opens the same form in edit mode, pre-filled from the full invoice
  // record (GET /tax-invoices/:id — same endpoint the Ledger's inline
  // editor already uses), with a Delete button available in the footer.
  const openEdit = (i) => {
    setError('');
    get(`/tax-invoices/${i.id}`).then((full) => {
      setEditingId(i.id);
      setForm(full);
      setStep(0);
      setOpen(true);
    }).catch((e) => setError(e.message));
  };

  const pickChallan = (id) => {
    const c = data.uninvoiced_challans.find((x) => x.id === Number(id));
    setForm((f) => ({
      ...f, challan_id: Number(id),
      // Dealer comes from the Delivery Challan and is kept separate from the
      // actual retail Customer — it's no longer auto-filled into buyer_name,
      // since Buyer/Customer and Dealer are different people/entities.
      _dealer_name: c?.dealer_name || '',
      sale_amount: c?.sale_value || '',
      gst_sale_amount: c?.sale_value || '',
      _chassis_no: c?.chassis_no || '',
      _battery_maker: c?.battery_maker || '',
      _battery_no: c?.battery_no1 || '',
      _model_name: c?.product_name || '',
      _colour: c?.colour || '',
    }));
  };

  const markStockRemoval = () => {
    // Some chassis leave stock without a real bill ever being cut against
    // them — historically these all shared the placeholder Bill No.
    // "GRD/1000" (see models.py's note on TaxInvoice.bill_no not being
    // unique). This button fills in that same placeholder pattern and
    // zeroes every money/tax field, while leaving the buyer/customer and
    // internal (chassis, dealer, etc.) details exactly as entered.
    setForm((f) => ({
      ...f,
      bill_no: 'GRD/1000X',
      sale_amount: 0,
      gst_sale_amount: 0,
      gst_rate: 0,
      discount: 0,
      insurance_amount: 0,
      registration_amount: 0,
      hypothecation_amount: 0,
      amount_received: 0,
      subsidy_amount: 0,
    }));
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (editingId) await put(`/tax-invoices/${editingId}`, form);
      else await post('/tax-invoices', form);
      setOpen(false);
      setEditingId(null);
      load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this Tax Invoice permanently?')) return;
    run(async () => { await del(`/tax-invoices/${id}`); setOpen(false); setEditingId(null); load(); });
  };

  const generateEInvoice = (id) => run(async () => {
    await post(`/tax-invoices/${id}/e-invoice`, {});
    load();
  });

  const generateEWayBill = (id) => run(async () => {
    await post(`/tax-invoices/${id}/e-way-bill`, {});
    load();
  });


  if (!data) return <div className="card">Loading…</div>;

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={openNew} disabled={data.uninvoiced_challans.length === 0}>
          + New Tax Invoice
        </button>
        {data.uninvoiced_challans.length === 0 && (
          <span className="muted" style={{ alignSelf: 'center' }}>No un-invoiced Delivery Challans available.</span>
        )}
      </div>
      <ErrorBanner message={!open ? error : ''} />

      <form onSubmit={runSearch} className="actions" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="Search bill no., chassis no. or buyer name"
               value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn" type="submit">Search</button>
        {search && (
          <button type="button" className="btn" onClick={() => { setSearch(''); setPage(1); load(1, ''); }}>
            Clear
          </button>
        )}
      </form>

      {data.invoices.length === 0 ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Bill No.</th><th>Customer Name</th><th>Dealer</th><th>Model</th><th>Chassis No.</th><th>Taxable</th>
                <th>GST</th><th>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{formatDate(i.date)}</td><td>{i.bill_no}</td>
                  <td>
                    <a onClick={() => openEdit(i)} style={{ color: 'var(--accent)', cursor: 'pointer' }} title="Click to edit">
                      {i.buyer_name}
                    </a>
                  </td>
                  <td>{i.dealer_name || '—'}</td>
                  <td>{i.product_name}</td>
                  <td><b>{i.chassis_no}</b></td>
                  <td><Money value={i.taxable_value} /></td>
                  <td><Money value={(Number(i.cgst_amount) || 0) + (Number(i.sgst_amount) || 0) + (Number(i.igst_amount) || 0)} /></td>
                  <td><Money value={i.bill_total} /></td>
                  <td>
                    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                      <button className="btn" onClick={() => setPrintId(i.id)}>Print</button>
                      {!i.irn && <button className="btn" onClick={() => generateEInvoice(i.id)} disabled={busy}>E-Invoice</button>}
                      {i.irn && <span className="muted" style={{fontSize:11,alignSelf:'center'}}>IRN ✓</span>}
                      {!i.eway_bill_no && <button className="btn" onClick={() => generateEWayBill(i.id)} disabled={busy}>E-Way</button>}
                      {i.eway_bill_no && <span className="muted" style={{fontSize:11,alignSelf:'center'}}>EWB ✓</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total_pages > 1 && (
        <div className="actions" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="btn" disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            Page {data.page} of {data.total_pages} ({data.total.toLocaleString()} total)
          </span>
          <button className="btn" disabled={page >= data.total_pages} onClick={() => goToPage(page + 1)}>Next →</button>
        </div>
      )}

      {open && (
        <div className="modal">
          <form className="modalbox tiModal" onSubmit={save}>
            <div className="tiHeader">
              <h2 style={{ margin: 0 }}>{editingId ? `Edit Tax Invoice — Bill No. ${form.bill_no || ''}` : 'New Tax Invoice'}</h2>
              {editingId ? (
                <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                  {form.buyer_name} — {form.product_name} — Chassis {form.chassis_no}
                </p>
              ) : (
                <>
                  <div className="formgrid" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label>Find Chassis / Dealer Name</label>
                      <input
                        className="input"
                        value={challanSearch}
                        onChange={(e) => setChallanSearch(e.target.value)}
                        placeholder="Type chassis no. or dealer name…"
                      />
                    </div>
                    <Field label={`Delivery Challan to Invoice (${filteredChallans.length})`} type="select" value={form.challan_id}
                           options={filteredChallans.map((c) => ({ value: c.id, label: `${c.challan_no} — ${c.dealer_name} — ${c.chassis_no}` }))}
                           onChange={pickChallan} required />
                    <Field label="Bill No." value={form.bill_no} onChange={(v) => setForm({ ...form, bill_no: v })} />
                    <button type="button" className="btn" style={{ alignSelf: 'flex-end', height: 38 }}
                            title="Fills Bill No. with the GRD/1000X stock-removal placeholder and zeroes Sale Amount/Tax/Insurance/Registration/Subsidy — buyer and internal details are left as-is."
                            onClick={markStockRemoval}>
                      Stock Removal (No Bill)
                    </button>
                    <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                  </div>
                  {form.challan_id && (
                    <div className="tiHeaderStrip">
                      <span><b>Dealer:</b> {form._dealer_name || '—'}</span>
                      <span><b>Chassis No.:</b> {form._chassis_no || '—'}</span>
                      <span><b>Model:</b> {form._model_name || '—'}</span>
                      <span><b>Colour:</b> {form._colour || '—'}</span>
                      <span><b>Battery Maker:</b> {form._battery_maker || '—'}</span>
                      <span><b>Battery No.:</b> {form._battery_no || '—'}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <ErrorBanner message={error} />

            <div className="tiTabs">
              {['Applicant Details', 'Internal', 'Amount / Tax'].map((label, idx) => (
                <button type="button" key={label}
                        className={'tiTab' + (step === idx ? ' active' : '')}
                        onClick={() => setStep(idx)}>
                  {idx + 1}. {label}
                </button>
              ))}
            </div>

            <div className="tiStepBody">
              {step === 0 && (
                <div className="formgrid">
                  <Field label="Customer Name" value={form.buyer_name} onChange={(v) => setForm({ ...form, buyer_name: v })} required />
                  <Field label="Buyer Relation" value={form.buyer_relation} onChange={(v) => setForm({ ...form, buyer_relation: v })} />
                  <Field label="Buyer Father/Husband Name" value={form.buyer_father_name} onChange={(v) => setForm({ ...form, buyer_father_name: v })} />
                  <Field label="Buyer Address" value={form.buyer_address} onChange={(v) => setForm({ ...form, buyer_address: v })} />
                  <Field label="Buyer Mobile" value={form.buyer_mobile} onChange={(v) => setForm({ ...form, buyer_mobile: v })} />
                  <Field label="Buyer GSTIN (if any)" value={form.buyer_gst_no} onChange={(v) => setForm({ ...form, buyer_gst_no: v })} />
                  <Field label="Buyer PAN" value={form.buyer_pan} onChange={(v) => setForm({ ...form, buyer_pan: v })} />
                  <Field label="Buyer Aadhar" value={form.buyer_aadhar} onChange={(v) => setForm({ ...form, buyer_aadhar: v })} />
                  <Field label="Buyer Date of Birth" type="date" value={form.buyer_dob} onChange={(v) => setForm({ ...form, buyer_dob: v })} />
                  <Field label="Buyer State" value={form.buyer_state} onChange={(v) => setForm({ ...form, buyer_state: v })} />
                  <Field label="Buyer State Code" value={form.buyer_state_code} onChange={(v) => setForm({ ...form, buyer_state_code: v })} />
                  <Field label="Intra/Inter State" type="select" value={form.state_type}
                         options={[{ value: 'I', label: 'Intra-state (CGST+SGST)' }, { value: 'O', label: 'Inter-state (IGST)' }]}
                         onChange={(v) => setForm({ ...form, state_type: v })} />
                  <Field label="Mode / Term" value={form.mode_term} onChange={(v) => setForm({ ...form, mode_term: v })} />
                  <Field label="Bank Name" value={form.bank_name} onChange={(v) => setForm({ ...form, bank_name: v })} />
                  <Field label="Bank Account No." value={form.bank_account_no} onChange={(v) => setForm({ ...form, bank_account_no: v })} />
                  <Field label="Bank IFSC" value={form.bank_ifsc} onChange={(v) => setForm({ ...form, bank_ifsc: v })} />
                  <Field label="RTO Name" value={form.rto_name} onChange={(v) => setForm({ ...form, rto_name: v })} />
                  <Field label="Despatch Through" value={form.despatch_through} onChange={(v) => setForm({ ...form, despatch_through: v })} />
                  <Field label="E-Way Bill No." value={form.eway_bill_no} onChange={(v) => setForm({ ...form, eway_bill_no: v })} />
                  <Field label="License No." value={form.license_no} onChange={(v) => setForm({ ...form, license_no: v })} />
                  <Field label="CVR No." value={form.cvr_no} onChange={(v) => setForm({ ...form, cvr_no: v })} />
                  <Field label="Cancelled Cheque No." value={form.cancelled_cheque_no} onChange={(v) => setForm({ ...form, cancelled_cheque_no: v })} />
                  <Field label="Remarks" value={form.remarks} onChange={(v) => setForm({ ...form, remarks: v })} />
                </div>
              )}

              {step === 1 && (
                <div className="formgrid">
                  <Field label="Sale Amount (Internal / Balance)" type="number" value={form.sale_amount} onChange={(v) => setForm({ ...form, sale_amount: v })} required />
                  <Field label="Amount Received" type="number" value={form.amount_received} onChange={(v) => setForm({ ...form, amount_received: v })} />
                  <Field label="Financer Name (Hypothecation)" type="combo" value={form.financer_name}
                         options={financers.map((f) => ({ value: f.name, label: f.name }))}
                         onChange={(v) => setForm({ ...form, financer_name: v })} />
                  <Field label="Hypothecation Amount" type="number" value={form.hypothecation_amount} onChange={(v) => setForm({ ...form, hypothecation_amount: v })} />
                  <div className="field">
                    <label>Balance (Sale − Hypothecation − Received)</label>
                    <input value={tiBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} readOnly disabled />
                  </div>
                  <Field label="Vehicle Reg. No." value={form.vehicle_reg_no} onChange={(v) => setForm({ ...form, vehicle_reg_no: v })} />
                  <Field label="Ledger No." value={form.ledger_no} onChange={(v) => setForm({ ...form, ledger_no: v })} />
                  <Field label="Chassis Record No." value={form.chassis_record_no} onChange={(v) => setForm({ ...form, chassis_record_no: v })} />
                  <Field label="Voucher No." value={form.voucher_no} onChange={(v) => setForm({ ...form, voucher_no: v })} />
                  <Field label="Subsidy Amount" type="number" value={form.subsidy_amount} onChange={(v) => setForm({ ...form, subsidy_amount: v })} />
                </div>
              )}

              {step === 2 && (
                <div className="formgrid">
                  <Field label="GST Sale Amount" type="number" value={form.gst_sale_amount} onChange={(v) => setForm({ ...form, gst_sale_amount: v })} required />
                  <Field label="GST Rate %" type="number" value={form.gst_rate} onChange={(v) => setForm({ ...form, gst_rate: v })} />
                  <Field label="Insurance Amount" type="number" value={form.insurance_amount} onChange={(v) => setForm({ ...form, insurance_amount: v })} />
                  <Field label="Registration Amount" type="number" value={form.registration_amount} onChange={(v) => setForm({ ...form, registration_amount: v })} />
                  <Field label="Discount" type="number" value={form.discount} onChange={(v) => setForm({ ...form, discount: v })} />
                  <p className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>
                    <b>GST Sale Amount</b> is the taxable value the invoice's GST, taxable amount and bill
                    total are computed from — it's separate from the "Sale Amount (ex-GST)" on the Internal
                    tab (which only drives the Balance/Hypothecation calc and what shows against this sale
                    in the Ledger). GST split (CGST+SGST for same state, IGST for different state) and the
                    bill total are computed automatically on save — shown everywhere as a single combined
                    GST amount.
                  </p>
                </div>
              )}
            </div>

            <div className="tiFooter">
              <div className="actions" style={{ marginRight: 'auto' }}>
                <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Back</button>
                <button type="button" className="btn" disabled={step === 2} onClick={() => setStep((s) => Math.min(2, s + 1))}>Next →</button>
                {editingId && (
                  <button type="button" className="btn danger" disabled={busy} onClick={() => remove(editingId)}>Delete</button>
                )}
              </div>
              <div className="actions">
                <button type="button" className="btn" onClick={() => { setOpen(false); setEditingId(null); }}>Cancel</button>
                <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
      {printId && <TaxInvoicePrintView invoiceId={printId} onClose={() => setPrintId(null)} />}
    </>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, ErrorBanner, EmptyState, Money, useAsyncAction } from './ui';
import { formatDate } from '../lib/date';
import { TaxInvoicePrintView } from './PrintDocs';
import { relationOptionsFor, b2cIdError, isB2C, useInvoiceMasters } from './invoiceHelpers';

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
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loanSearch, setLoanSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const loadCustomers = (dealerId) => {
    if (!dealerId) { setCustomers([]); return; }
    get('/billing-customers?dealer_id=' + dealerId)
      .then((d) => setCustomers(Array.isArray(d) ? d : (d.rows || [])))
      .catch(() => setCustomers([]));
  };
  const pickCustomer = (id) => {
    const c = customers.find((x) => String(x.id) === String(id));
    if (!c) { setForm((f) => ({ ...f, customer_id: '' })); return; }
    setForm((f) => ({
      ...f, customer_id: c.id, buyer_name: c.name || '', buyer_relation: c.relation || f.buyer_relation,
      buyer_father_name: c.father_name || '', buyer_address: c.address || '', buyer_mobile: c.mobile || '',
      buyer_gst_no: c.gst_no || '', buyer_pan: c.pan || '', buyer_aadhar: c.aadhar || '',
      buyer_dob: c.dob ? String(c.dob).slice(0, 10) : '', buyer_state: c.state || '',
      buyer_state_code: c.state_code || '', license_no: c.license_no || '',
    }));
  };
  const searchPendingLoans = async (value='') => {
    setLoanSearch(value);
    try {
      const q = value.trim();
      const d = await get('/billing/pending-chfpl' + (q ? '?do_no=' + encodeURIComponent(q) : ''));
      setPendingLoans(d.loans || []);
    } catch (e) { setPendingLoans([]); }
  };
  const filteredChallans = (data?.uninvoiced_challans || []).filter((c) => {
    const q = challanSearch.trim().toLowerCase();
    if (!q) return true;
    return [c.challan_no, c.chassis_no, c.dealer_name, c.product_name, c.colour]
      .some(v => String(v || '').toLowerCase().includes(q));
  });
  const { busy, error, setError, run } = useAsyncAction();
  const { rtos, defaultBank } = useInvoiceMasters();
  const rtoNames = rtos.map((r) => r.name).filter(Boolean);
  const rtoOptions = (cur) => (cur && !rtoNames.includes(cur) ? [cur, ...rtoNames] : rtoNames).map((n) => ({ value: n, label: n }));
  const b2c = isB2C(form);

  // New invoice: pre-fill the bank that is ticked "Default" in Bank Details.
  useEffect(() => {
    if (!open || editingId || !defaultBank) return;
    setForm((f) => (f.bank_name ? f : { ...f, bank_name: defaultBank.name || '', bank_account_no: defaultBank.account_no || '', bank_ifsc: defaultBank.ifsc || '' }));
  }, [open, editingId, defaultBank]);

  useEffect(() => { get('/masters/financer').then((d) => setFinancers(Array.isArray(d) ? d : (d.masters || d.rows || d.data || []))).catch(() => {}); }, []);

  const tiBalance = (Number(form.sale_amount) || 0) - (Number(form.hypothecation_amount) || 0) - (Number(form.amount_received) || 0);

  // 16,000+ tax invoices exist in production -- fetch one page at a time
  // (backend paginates) instead of the whole table at once, which used to
  // time out / 500 the request.
  const load = (p = page, s = search, refreshChallans = false) => {
    const params = new URLSearchParams({ page: p, per_page: 50 });
    if (s) params.set('search', s);
    // Un-invoiced challans are fetched only on the first load (and after saves via load(1,'',true)); paging/search reuse them.
    if (data && !refreshChallans) params.set('challans', '0');
    get(`/tax-invoices?${params}`).then((d) => setData((prev) => ({ ...d, uninvoiced_challans: d.uninvoiced_challans ?? prev?.uninvoiced_challans ?? [] }))).catch((e) => setError(e.message));
  };
  useEffect(() => { load(1, search); }, []);

  const goToPage = (p) => { setPage(p); load(p, search); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };

  const openNew = () => {
    setEditingId(null);
    setChallanSearch('');
    setLoanSearch('');
    searchPendingLoans('');
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

  const pickPendingLoan = (id) => {
    const loan = pendingLoans.find((x) => String(x.id) === String(id));
    if (!loan) return;
    setForm((f) => ({
      ...f,
      billing_queue_id: Number(id),
      challan_id: '',
      buyer_name: loan.customer_name || '',
      buyer_mobile: loan.customer_phone || '',
      sale_amount: loan.loan_amount || '',
      gst_sale_amount: loan.loan_amount || '',
      _dealer_name: loan.dealer_name || '',
      _model_name: loan.vehicle_model_name || '',
      _loan_application_no: loan.application_no || '',
      _do_no: loan.do_no || loan.application_no || '',
    }));
  };

  const pickChallan = (id) => {
    const c = data.uninvoiced_challans.find((x) => x.id === Number(id));
    loadCustomers(c?.dealer_id);
    setForm((f) => ({
      ...f, challan_id: Number(id), dealer_id: c?.dealer_id || f.dealer_id, vehicle_id: c?.vehicle_id || f.vehicle_id, customer_id: '',
      // Dealer comes from the Delivery Challan and is kept separate from the
      // actual retail Customer — it's no longer auto-filled into buyer_name,
      // since Buyer/Customer and Dealer are different people/entities.
      _dealer_name: c?.dealer_name || '',
      dealer_page_no: c?.dealer_page_no || '',
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
      // Checks apply to new invoices only, so the 16,000+ old invoices stay editable.
      if (!editingId && form.bill_no !== 'GRD/1000X') {
        if (!String(form.rto_name || '').trim()) { setStep(0); throw new Error('Select the RTO Name before creating the invoice.'); }
        const idErr = b2cIdError(form);
        if (idErr) { setStep(0); throw new Error(idErr); }
      }
      if (editingId) await put(`/tax-invoices/${editingId}`, form);
      else await post('/tax-invoices', form);
      setOpen(false);
      setEditingId(null);
      load(page, search, true);
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this Tax Invoice permanently?')) return;
    run(async () => { await del(`/tax-invoices/${id}`); setOpen(false); setEditingId(null); load(page, search, true); });
  };

  const generateEInvoice = (id) => run(async () => {
    await post(`/tax-invoices/${id}/e-invoice`, {});
    load();
  });

  const generateEWayBill = (id) => run(async () => {
    await post(`/tax-invoices/${id}/e-way-bill`, {});
    load();
  });


  if (!data) return (
    <div className="card">
      {error ? (
        <>
          <b>Tax Invoice load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(1, search); }}>
            Retry
          </button>
        </>
      ) : 'Loading…'}
    </div>
  );

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
        <input className="input" placeholder="Search bill no., chassis no., buyer name or dealer"
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
                      <label>Search DO No. / Loan</label>
                      <input className="input" value={loanSearch} onChange={(e) => setLoanSearch(e.target.value)}
                             placeholder="Type DO No. / Application No." />
                    </div>
                    <Field label={`Approved / Pending Bill Loans (${pendingLoans.filter(x => {
                      const q = loanSearch.trim().toLowerCase();
                      return !q || [x.do_no, x.application_no, x.customer_name, x.dealer_name].some(v => String(v || '').toLowerCase().includes(q));
                    }).length})`} type="select" value={form.billing_queue_id || ''}
                           options={pendingLoans.filter(x => {
                             const q = loanSearch.trim().toLowerCase();
                             return !q || [x.do_no, x.application_no, x.customer_name, x.dealer_name].some(v => String(v || '').toLowerCase().includes(q));
                           }).map((x) => ({ value: x.id, label: `${x.do_no || x.application_no} — ${x.application_no} — ${x.customer_name || ''}` }))}
                           onChange={pickPendingLoan} />
                    <div className="field">
                      <label>Find Delivery Challan</label>
                      <input className="input" value={challanSearch} onChange={(e) => setChallanSearch(e.target.value)}
                             placeholder="Type chassis no. or dealer name…" />
                    </div>
                    <Field label={`Delivery Challan to Invoice (${filteredChallans.length})`} type="select" value={form.billing_queue_id ? '' : (form.challan_id || '')}
                           options={filteredChallans.map((c) => ({ value: c.id, label: `${c.challan_no} — ${c.dealer_name} — ${c.chassis_no}` }))}
                           onChange={(id) => { setForm(f => ({...f, billing_queue_id: ''})); pickChallan(id); }} />
                    <Field label="RTO Name (select first)" type="select" value={form.rto_name}
                           options={rtoOptions(form.rto_name)} onChange={(v) => setForm({ ...form, rto_name: v })} />
                    <Field label="Bill No." value={form.bill_no} onChange={(v) => setForm({ ...form, bill_no: v })} />
                    <button type="button" className="btn" style={{ alignSelf: 'flex-end', height: 38 }}
                            title="Fills Bill No. with the GRD/1000X stock-removal placeholder and zeroes Sale Amount/Tax/Insurance/Registration/Subsidy — buyer and internal details are left as-is."
                            onClick={markStockRemoval}>
                      Stock Removal (No Bill)
                    </button>
                    <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                  </div>
                  {(form.challan_id || form.billing_queue_id) && (
                    <div className="tiHeaderStrip">
                      {form.billing_queue_id && <span><b>DO No.:</b> {form._do_no || '—'}</span>}
                      {form.billing_queue_id && <span><b>Application:</b> {form._loan_application_no || '—'}</span>}
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
                <>
                  <div className="actions" style={{margin:'10px 0'}}>
                    <input className="input" placeholder="Search DO No." value={loanSearch} onChange={e=>searchPendingLoans(e.target.value)} style={{maxWidth:320}} />
                    <span className="muted">Approved / Pending for Bill loans</span>
                  </div>
                  <div className="formgrid">
                  <Field label="Dealer Page No." value={form.dealer_page_no} onChange={(v) => setForm({ ...form, dealer_page_no: v })} />
                  {customers.length > 0 && (
                    <div className="field">
                      <label>Select Customer (this dealer)</label>
                      <select value={form.customer_id || ''} onChange={(e) => pickCustomer(e.target.value)}>
                        <option value="">— New customer / type below —</option>
                        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.mobile ? ' — ' + c.mobile : ''}</option>)}
                      </select>
                    </div>
                  )}
                  <Field label="Customer Name" value={form.buyer_name} onChange={(v) => setForm({ ...form, buyer_name: v })} required />
                  <Field label="Relation (S/O, D/O, C/O)" type="select" value={form.buyer_relation}
                         options={relationOptionsFor(form.buyer_relation).filter((o) => o.value !== '')}
                         onChange={(v) => setForm({ ...form, buyer_relation: v })} />
                  <Field label="Buyer Father/Husband Name" value={form.buyer_father_name} onChange={(v) => setForm({ ...form, buyer_father_name: v })} />
                  <Field label="Buyer Address" value={form.buyer_address} onChange={(v) => setForm({ ...form, buyer_address: v })} />
                  <Field label="Buyer Mobile" value={form.buyer_mobile} onChange={(v) => setForm({ ...form, buyer_mobile: v })} />
                  <Field label="Buyer GSTIN (if any)" value={form.buyer_gst_no} onChange={(v) => setForm({ ...form, buyer_gst_no: v })} />
                  <Field label={'Buyer PAN' + (b2c ? ' * (required, no GSTIN)' : '')} value={form.buyer_pan} onChange={(v) => setForm({ ...form, buyer_pan: v.toUpperCase() })} />
                  <Field label={'Buyer Aadhar' + (b2c ? ' * (required, no GSTIN)' : '')} value={form.buyer_aadhar} onChange={(v) => setForm({ ...form, buyer_aadhar: v })} />
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
                  <Field label="RTO Name" type="select" value={form.rto_name} options={rtoOptions(form.rto_name)} onChange={(v) => setForm({ ...form, rto_name: v })} />
                  <Field label="Despatch Through" value={form.despatch_through} onChange={(v) => setForm({ ...form, despatch_through: v })} />
                  <Field label="E-Way Bill No." value={form.eway_bill_no} onChange={(v) => setForm({ ...form, eway_bill_no: v })} />
                  <Field label="License No." value={form.license_no} onChange={(v) => setForm({ ...form, license_no: v })} />
                  <Field label="CVR No." value={form.cvr_no} onChange={(v) => setForm({ ...form, cvr_no: v })} />
                  <Field label="Cancelled Cheque No." value={form.cancelled_cheque_no} onChange={(v) => setForm({ ...form, cancelled_cheque_no: v })} />
                  <Field label="Remarks" value={form.remarks} onChange={(v) => setForm({ ...form, remarks: v })} />
                  </div>
                </>
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

'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, Card, ErrorBanner, useAsyncAction } from './ui';

// Single-record "master" (not a list) for the company details that print on
// every voucher: Delivery Challan header, Tax Invoice header/footer,
// Affidavit, Undertaking and Form-22 (see components/PrintDocs.jsx, which
// reads these as `data.company`). Editing here is what should fill in the
// blank Email / Mobile / address lines currently seen on those prints.
export function CompanyMasterPage() {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/company').then((d) => setForm(d || {})).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const save = (e) => {
    e.preventDefault();
    setSaved(false);
    run(async () => { await post('/company', form); setSaved(true); });
  };

  return (
    <Card title="Company Details" style={{ maxWidth: 760 }}>
      <p className="muted" style={{ marginTop: -4, marginBottom: 16 }}>
        This is used as the "{'{company}'}" info on every printed Delivery Challan,
        Tax Invoice, Affidavit, Undertaking and Form-22 — company name, address, GSTIN,
        email, mobile and website.
      </p>
      <ErrorBanner message={error} />
      {saved && !busy && !error && <div className="muted" style={{ color: '#12b76a', marginBottom: 10 }}>Saved ✓</div>}
      <form onSubmit={save}>
        <div className="formgrid">
          <Field label="Company Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="GSTIN" value={form.gst_no} onChange={(v) => setForm({ ...form, gst_no: v })} />
          <Field label="Address Line 1" value={form.address1} onChange={(v) => setForm({ ...form, address1: v })} />
          <Field label="Address Line 2" value={form.address2} onChange={(v) => setForm({ ...form, address2: v })} />
          <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
          <Field label="State Code" value={form.state_code} onChange={(v) => setForm({ ...form, state_code: v })} />
          <Field label="PAN" value={form.pan} onChange={(v) => setForm({ ...form, pan: v })} />
          <Field label="Mobile No." value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
        </div>
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Card>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { STATES, stateCodeFor } from '../lib/states';

// Relation to the buyer's father/husband. The blank option is for a firm /
// company buyer, where no father name applies.
export const RELATION_OPTIONS = [
  { value: '', label: '— (Firm / none)' },
  { value: 'Firm', label: 'Firm' },
  { value: 'S/O', label: 'S/O' },
  { value: 'D/O', label: 'D/O' },
  { value: 'C/O', label: 'C/O' },
];

// Older records may hold some other text (e.g. "W/O", "Son of"). Keep that
// value selectable so editing an old invoice does not blank it out.
export function relationOptionsFor(current) {
  const v = String(current ?? '').trim();
  if (!v || RELATION_OPTIONS.some((o) => o.value === v)) return RELATION_OPTIONS;
  return [...RELATION_OPTIONS, { value: v, label: v }];
}

const clean = (v) => String(v ?? '').trim();

// B2C = buyer has no GSTIN. Then Aadhar and PAN are both mandatory.
export const isB2C = (f) => !clean(f?.buyer_gst_no);

// Returns an error message, or '' when OK.
export function b2cIdError(f) {
  if (!isB2C(f)) return '';
  const aadhar = clean(f.buyer_aadhar).replace(/\s+/g, '');
  const pan = clean(f.buyer_pan).toUpperCase();
  if (!aadhar) return 'Buyer has no GSTIN (B2C): Aadhar No. is required.';
  if (!/^\d{12}$/.test(aadhar)) return 'Aadhar No. must be 12 digits.';
  if (!pan) return 'Buyer has no GSTIN (B2C): PAN No. is required.';
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return 'PAN No. looks invalid (format: ABCDE1234F).';
  return '';
}

// Loads RTO Master + Bank Details master once. The default bank (the one
// ticked "Default" in Bank Details) is returned separately.
export function useInvoiceMasters() {
  const [rtos, setRtos] = useState([]);
  const [banks, setBanks] = useState([]);
  useEffect(() => {
    const rows = (d) => (Array.isArray(d) ? d : (d.masters || d.rows || d.data || []));
    get('/masters/rto').then((d) => setRtos(rows(d))).catch(() => {});
    get('/masters/bank').then((d) => setBanks(rows(d))).catch(() => {});
  }, []);
  const defaultBank = banks.find((b) => b.is_default === true || b.is_default === 't' || b.is_default === 1 || String(b.is_default).toLowerCase() === 'true') || null;
  return { rtos, banks, defaultBank };
}

// RTO Name dropdown fed by the RTO Master. Stores the RTO name on the sale; the
// invoice print then looks up that RTO's Address Line 1 + 2 for the footer.
export function RtoSelect({ label = 'RTO Name', value, onChange }) {
  const { rtos } = useInvoiceMasters();
  const names = rtos.map((r) => r.name).filter(Boolean);
  const opts = value && !names.includes(value) ? [value, ...names] : names;
  const sel = rtos.find((r) => r.name === value);
  const lines = sel ? [sel.address, sel.address2].filter((l) => String(l || '').trim()) : [];
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select RTO —</option>
        {opts.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {lines.length > 0 && <small className="muted">{lines.join(' / ')}</small>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Buyer State -> GST state code -> Intra / Inter state.
// Intra-state (CGST + SGST) when the buyer's state == our (company) state,
// otherwise Inter-state (IGST).
// ---------------------------------------------------------------------------
const normStateCode = (v) => { const s = clean(v); return /^\d{1,2}$/.test(s) ? s.padStart(2, '0') : ''; };

// Buyer's GST state code: saved code if present, else looked up from the state name.
export const buyerStateCode = (f) => normStateCode(f?.buyer_state_code) || stateCodeFor(f?.buyer_state);

// 'I' / 'O', or '' when either side is unknown (then nothing is auto-set).
export const gstStateType = (buyerCode, companyCode) => (buyerCode && companyCode ? (buyerCode === companyCode ? 'I' : 'O') : '');

// Dropdown values. A legacy free-text state stays selectable so old records are not blanked.
export const stateValueFor = (current) => { const v = clean(current); return STATES.some(([n]) => n === v.toUpperCase()) ? v.toUpperCase() : v; };
export const stateOptionsFor = (current) => {
  const names = STATES.map(([n]) => n), v = stateValueFor(current);
  return !v || names.includes(v) ? names : [v, ...names];
};
// Fields to set when a state is picked.
export const stateFields = (name) => ({ buyer_state: name, buyer_state_code: stateCodeFor(name) });

// Our (seller) GST state code, from Company Master: state_code, else first 2 digits of GSTIN.
export function useCompanyStateCode() {
  const [code, setCode] = useState('');
  useEffect(() => {
    get('/company').then((c) => {
      const g = clean(c?.gst_no).slice(0, 2);
      setCode(normStateCode(c?.state_code) || (/^\d{2}$/.test(g) ? g : ''));
    }).catch(() => {});
  }, []);
  return code;
}

// Keeps form.state_type in sync with the buyer's state. `locked` = the user can no
// longer pick it by hand (only when the company state is known).
export function useAutoStateType(form, setField, enabled = true) {
  const companyCode = useCompanyStateCode();
  const auto = enabled ? gstStateType(buyerStateCode(form), companyCode) : '';
  useEffect(() => { if (auto && auto !== form.state_type) setField('state_type', auto); }, [auto, form.state_type]);
  return { companyCode, locked: Boolean(companyCode) };
}

export const STATE_TYPE_OPTIONS = [
  { value: 'I', label: 'Intra-state (CGST + SGST)' },
  { value: 'O', label: 'Inter-state (IGST)' },
];

// Pin code: 6 digits, first digit 1-9. Returns an error message, or '' when OK.
export const normPincode = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 6);
export const pincodeError = (f) => (/^[1-9]\d{5}$/.test(clean(f?.buyer_pincode)) ? '' : 'Buyer Pin Code required hai (6 digit).');
export const STATE_REQUIRED_MSG = 'Buyer State select karo — Intra / Inter state (CGST+SGST / IGST) isi se tay hota hai.';

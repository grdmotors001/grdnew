'use client';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';

// Relation to the buyer's father/husband. The blank option is for a firm /
// company buyer, where no father name applies.
export const RELATION_OPTIONS = [
  { value: '', label: '— (Firm / none)' },
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

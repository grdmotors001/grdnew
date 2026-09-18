'use client';
import { useEffect, useState } from 'react';
import { get, getToken } from '../lib/api';
import { Money } from './ui';

// NOTE: the original app's actual print templates (templates/vouchers/*.html)
// weren't included in the files handed over for this conversion — only
// app.py/models.py/menu_config.py were. These layouts are a best-effort
// reconstruction from the fields the original routes gathered (RTO address
// substitution, bank fallback, doc-type titles), not a pixel-match to the
// original desktop software's printed forms. Compare against a real
// original printout before relying on these for RTO/GST submission.

const COPY_TYPES = [
  ['original', 'Original'],
  ['duplicate', 'Duplicate'],
  ['transport', 'Transport'],
  ['office', 'Office'],
];

// Slide-in side panel used by every print/view flow in the app (Tax Invoice,
// Delivery Challan, Affidavit/Undertaking/Form-22, and any future doc type).
// Matches the "Print / View Document" side-viewer pattern: dimmed backdrop
// on the left, document panel sliding in from the right, header with quick
// actions, footer with copy-type selector + share/print actions.
function Overlay({ onClose, children, extraActions, title = 'Print / View Document' }) {
  const [copyType, setCopyType] = useState('original');
  const [copied, setCopied] = useState(false);

  const openInNewTab = () => window.open(window.location.href, '_blank');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access blocked (e.g. insecure context) — silently ignore.
    }
  };

  // Whatsapp/Email here just share the current page link, since generating
  // a standalone shareable PDF would need a backend endpoint. Download and
  // Print both fall back to the browser's print dialog for the same reason
  // — "Save as PDF" from that dialog is the practical download path without
  // a server-side PDF generator.
  const shareWhatsapp = () => window.open(
    `https://wa.me/?text=${encodeURIComponent(`${title}: ${window.location.href}`)}`, '_blank'
  );
  const shareEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(window.location.href)}`;
  };

  const copyLabel = COPY_TYPES.find(([k]) => k === copyType)?.[1] || 'Original';

  const printDocument = async () => {
    // Let the document/images finish rendering before opening the browser
    // print dialog. This is more reliable than calling print() directly from
    // a React overlay render.
    try { await document.fonts?.ready; } catch {}
    setTimeout(() => window.print(), 80);
  };

  return (
    <div className="printOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="printPanel">
        <div className="printHeader noprint">
          <h3>{title}</h3>
          <div className="printHeaderActions">
            {extraActions}
            <button className="btn" onClick={openInNewTab}>↗ New Tab</button>
            <button className="btn" onClick={copyLink}>{copied ? '✓ Copied' : '🔗 Copy Link'}</button>
            <button className="btn iconbtn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="printBody">
          <div className="printSheet">
            <div className="copyBadge">{copyLabel}</div>
            {children}
          </div>
        </div>

        <div className="printFooter noprint">
          <div className="printFooterChecks">
            {COPY_TYPES.map(([key, label]) => (
              <label className="copyCheck" key={key}>
                <input type="radio" name="copyType" checked={copyType === key} onChange={() => setCopyType(key)} />
                {label}
              </label>
            ))}
          </div>
          <div className="printFooterActions">
            <button className="btn wa" onClick={shareWhatsapp}>Whatsapp</button>
            <button className="btn mail" onClick={shareEmail}>Email</button>
            <button className="btn dl" onClick={printDocument}>Download / PDF</button>
            <button className="btn pr" onClick={printDocument}>Print</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Converts a rupee amount to words (Indian numbering: lakh/crore), for the
// "Amount Chargeable (in words)" line on the Tax Invoice print.
function amountInWords(amount) {
  const num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigits = (n) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  const threeDigits = (n) => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '') : twoDigits(n));
  let n = num, parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(' ') + ' Rupees Only';
}

const TI_STYLES = `
.tiw{ --navy:#16305c; --gold:#f0b429; font-family:'Segoe UI', Arial, sans-serif; color:#111; font-size:13px; }
.tiw .top-line{ text-align:center; font-size:11px; letter-spacing:1px; color:#888; margin-bottom:2px; }
.tiw .header{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid var(--navy); padding-bottom:8px; margin-bottom:14px; }
.tiw .logo-title{ font-size:32px; font-weight:900; font-style:italic; letter-spacing:1px; line-height:1; }
.tiw .logo-sub{ font-size:11px; font-weight:700; letter-spacing:1px; margin-top:2px; border-bottom:2px solid #c81e2c; display:inline-block; padding-bottom:2px; }
.tiw .header-right{ text-align:right; }
.tiw .gstin-top{ font-size:12px; font-weight:700; margin-bottom:6px; }
.tiw .ti-banner{ background:var(--navy); color:#fff; font-weight:800; letter-spacing:2px; padding:8px 22px; font-size:16px;
  clip-path:polygon(10px 0,100% 0,100% 100%,0 100%); border-bottom:3px solid var(--gold); }
.tiw .row-top{ display:flex; gap:14px; margin-bottom:14px; align-items:stretch; }
.tiw .box{ border:1px solid #c7c2ac; border-radius:6px; overflow:hidden; }
.tiw .box-title{ background:var(--navy); color:#fff; font-weight:700; font-size:12px; letter-spacing:0.5px; padding:6px 10px; display:flex; align-items:center; gap:6px; }
.tiw .box-title .dot{ width:16px; height:16px; border-radius:50%; background:#fff; color:var(--navy); display:inline-flex; align-items:center; justify-content:center; font-size:10px; flex-shrink:0; }
.tiw .buyer-box{ flex:1.3; }
.tiw .buyer-body{ padding:10px 14px; }
.tiw .buyer-name{ font-weight:800; font-size:14px; margin-bottom:4px; }
.tiw .buyer-addr{ font-size:12px; line-height:1.5; color:#333; margin-bottom:8px; }
.tiw .buyer-kv{ display:flex; font-size:12px; padding:3px 0; border-top:1px dashed #ddd; }
.tiw .buyer-kv:first-of-type{ border-top:1px solid #ccc; margin-top:4px; padding-top:6px; }
.tiw .buyer-kv .k{ width:120px; color:#555; }
.tiw .buyer-kv .v{ font-weight:700; }
.tiw .right-col{ flex:1; display:flex; flex-direction:column; gap:10px; }
.tiw .meta-table{ width:100%; border-collapse:collapse; font-size:12px; }
.tiw .meta-table td{ padding:5px 10px; }
.tiw .meta-table td:first-child{ color:#555; width:110px; }
.tiw .meta-table td:last-child{ font-weight:700; text-align:right; }
.tiw .bank-body{ padding:4px 0; }
.tiw .bank-body table{ width:100%; border-collapse:collapse; font-size:12px; }
.tiw .bank-body td{ padding:5px 10px; }
.tiw .bank-body td:first-child{ color:#555; width:110px; }
.tiw .bank-body td:last-child{ font-weight:700; }
.tiw .info-strip{ display:flex; gap:12px; margin-bottom:14px; }
.tiw .info-cell{ flex:1; border:1px solid #c7c2ac; border-radius:6px; padding:8px 10px; }
.tiw .info-cell .lbl{ display:flex; align-items:center; gap:6px; font-size:10.5px; font-weight:700; color:var(--navy); margin-bottom:5px; letter-spacing:0.3px; }
.tiw .info-cell .lbl .dot{ width:14px; height:14px; border-radius:50%; background:var(--navy); flex-shrink:0; }
.tiw .info-cell .val{ font-size:12px; padding-left:20px; }
.tiw table.items{ width:100%; border-collapse:collapse; font-size:12px; margin-bottom:14px; }
.tiw table.items th{ background:var(--navy); color:#fff; padding:8px 6px; font-size:11px; letter-spacing:0.3px; border:1px solid var(--navy); }
.tiw table.items td{ border:1px solid #ccc; padding:8px 6px; vertical-align:top; }
.tiw table.items td.num{ text-align:right; }
.tiw table.items td.center{ text-align:center; }
.tiw .item-name{ font-weight:800; }
.tiw .item-sub{ font-size:11px; color:#444; margin-top:2px; }
.tiw .totals-row{ display:flex; gap:14px; margin-bottom:14px; align-items:stretch; }
.tiw .words-box{ flex:1.3; padding:10px 14px; }
.tiw .amt-box{ flex:1; display:flex; flex-direction:column; }
.tiw .amt-table{ width:100%; border-collapse:collapse; font-size:12.5px; }
.tiw .amt-table td{ padding:6px 12px; }
.tiw .amt-table td:last-child{ text-align:right; font-weight:700; }
.tiw .amt-total{ background:var(--navy); color:#fff; display:flex; justify-content:space-between; padding:9px 12px; font-weight:800; font-size:15px; margin-top:auto; }
.tiw .decl-row{ display:flex; gap:14px; margin-bottom:14px; }
.tiw .decl-box{ flex:1.3; padding:10px 14px; font-size:11.5px; line-height:1.6; }
.tiw .decl-box ol{ margin:0; padding-left:18px; }
.tiw .sign-box{ flex:1; padding:14px; display:flex; flex-direction:column; justify-content:flex-end; text-align:right; }
.tiw .sign-box .for{ font-weight:700; margin-bottom:36px; }
.tiw .sign-box .line{ border-top:1px dashed #999; font-size:11px; color:#666; padding-top:4px; }
.tiw .footer-row{ display:flex; gap:14px; align-items:flex-start; margin-bottom:0; }
.tiw .footer-addr{ flex:1; font-size:11.5px; line-height:1.9; color:#333; }
.tiw .footer-addr div{ display:flex; align-items:flex-start; gap:6px; }
.tiw .footer-side{ display:flex; gap:14px; align-items:center; flex-shrink:0; }
.tiw .qr-placeholder{ width:64px; height:64px; border:1px solid #999; display:flex; align-items:center; justify-content:center; font-size:9px; color:#999; text-align:center; }
.tiw .flag-logo{ width:70px; }
.tiw .flag-logo img{ width:100%; display:block; }
.tiw .bottom-strip{ background:var(--navy); color:#fff; text-align:center; font-weight:700; letter-spacing:1px; padding:8px; font-size:13px; margin-top:14px; }
@media (max-width:700px){
  .tiw .row-top, .tiw .info-strip, .tiw .totals-row, .tiw .decl-row, .tiw .footer-row{ flex-direction:column; }
}
`;

const DC_STYLES = `
.dcw{ --navy:#16305c; --green:#0e6b4f; --teal:#0f6b6b; --warn-bg:#fdf3d9; --warn-border:#e8b93a;
  font-family:'Segoe UI', Arial, sans-serif; color:#111; }
.dcw .top-line{ text-align:center; font-size:12px; letter-spacing:1px; color:#333; margin-bottom:4px; }
.dcw .header{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #222; padding-bottom:8px; margin-bottom:10px; }
.dcw .logo-block{ display:flex; flex-direction:column; }
.dcw .logo-title{ font-size:40px; font-weight:900; font-style:italic; letter-spacing:1px;
  background:linear-gradient(180deg,#444,#000); -webkit-background-clip:text; background-clip:text; color:transparent; line-height:1; }
.dcw .logo-sub{ font-size:12px; font-weight:700; letter-spacing:1px; margin-top:2px; }
.dcw .addr{ text-align:right; font-size:12px; line-height:1.5; color:#222; }
.dcw .header-image-wrap img{ width:100%; max-width:100%; height:auto; display:block; }
.dcw .title-banner{ background:var(--navy); color:#fff; text-align:center; font-weight:800; letter-spacing:2px; padding:10px; font-size:17px; border-radius:4px; margin-bottom:16px; }
.dcw .info-row{ display:flex; gap:14px; margin-bottom:14px; }
.dcw .info-box{ flex:1; border:1.5px solid var(--navy); border-radius:6px; padding:8px 14px; display:flex; align-items:center; justify-content:center; gap:10px; }
.dcw .info-icon-col{ display:flex; flex-direction:column; align-items:center; gap:3px; flex-shrink:0; }
.dcw .info-icon{ width:32px; height:32px; border-radius:50%; background:var(--navy); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; }
.dcw .info-label{ font-size:9px; font-weight:700; letter-spacing:0.5px; color:#333; white-space:nowrap; }
.dcw .info-value{ font-size:17px; font-weight:800; }
.dcw .section-banner{ background:var(--navy); color:#fff; text-align:center; font-weight:700; letter-spacing:1px; padding:8px;
  clip-path:polygon(2% 0,98% 0,100% 50%,98% 100%,2% 100%,0 50%); font-size:14px; }
.dcw .dealer-wrap{ display:flex; border:1.5px solid var(--green); border-top:none; margin-bottom:14px; }
.dcw .dealer-side{ background:var(--green); color:#fff; width:110px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:800; text-align:center; font-size:15px; padding:10px; flex-shrink:0; }
.dcw .dealer-icon-circle{ width:44px; height:44px; border-radius:50%; background:#fff; color:var(--green); display:flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:8px; }
.dcw .dealer-content{ flex:1; padding:12px 18px; }
.dcw .dealer-item{ display:flex; gap:10px; margin-bottom:10px; font-size:14px; align-items:flex-start; }
.dcw .dealer-item:last-child{ margin-bottom:0; }
.dcw .dealer-label{ width:110px; display:flex; align-items:center; gap:8px; font-weight:600; color:#222; flex-shrink:0; }
.dcw .dealer-icon{ width:20px; text-align:center; color:var(--green); }
.dcw .dealer-colon{ width:10px; }
.dcw .dealer-val{ font-weight:700; }
.dcw .salesperson-row{ display:flex; gap:14px; margin-bottom:16px; }
.dcw .sp-box{ flex:3; border:1.5px solid var(--navy); border-radius:6px; padding:10px 14px; display:flex; align-items:center; gap:10px; font-size:14px; }
.dcw .sp-box2{ flex:1; border:1.5px solid var(--navy); border-radius:6px; display:flex; align-items:center; justify-content:center; font-weight:800; }
.dcw .sp-icon{ color:var(--green); }
.dcw .two-col{ display:flex; gap:14px; margin-bottom:16px; align-items:flex-start; }
.dcw .col-left, .dcw .col-right{ flex:1; }
.dcw .tbl-banner{ background:var(--navy); color:#fff; display:flex; align-items:center; gap:8px; padding:8px 12px; font-weight:700; font-size:13px; letter-spacing:0.5px; }
.dcw .tbl-banner.green{ background:var(--green); }
.dcw .tbl-banner.teal{ background:var(--teal); }
.dcw table{ width:100%; border-collapse:collapse; font-size:13px; }
.dcw table th, .dcw table td{ border:1px solid #999; padding:7px 10px; text-align:left; }
.dcw table th{ background:#f2f2f2; text-align:center; font-weight:700; }
.dcw td.center{ text-align:center; }
.dcw .highlight{ background:#fdf3a0; font-weight:700; }
.dcw .acc-row{ display:flex; align-items:center; padding:7px 10px; font-size:13px; border-bottom:1px solid #ddd; gap:8px; }
.dcw .acc-row.last{ border-bottom:none; }
.dcw .acc-num{ width:20px; font-weight:700; color:#555; }
.dcw .acc-name{ flex:1; }
.dcw .acc-colon{ width:10px; text-align:center; }
.dcw .acc-status{ width:60px; display:flex; align-items:center; gap:4px; font-weight:700; }
.dcw .acc-status.yes{ color:#1a9c4a; }
.dcw .acc-status.no{ color:#d02020; }
.dcw .check-circle{ width:16px; height:16px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; color:#fff; }
.dcw .check-circle.yes{ background:#1a9c4a; }
.dcw .check-circle.no{ background:#d02020; }
.dcw .acc-flex{ display:flex; gap:0; border:1px solid #999; }
.dcw .acc-flex .acc-col:first-child{ border-right:1px solid #999; }
.dcw .acc-col{ flex:1; }
.dcw .accessories-row{ display:flex; gap:14px; margin-bottom:16px; align-items:flex-start; }
.dcw .acc-table-wrap{ flex:1; }
.dcw .vehicle-image-box{ width:280px; flex-shrink:0; display:flex; align-items:flex-start; justify-content:center; overflow:hidden; }
.dcw .vehicle-image-box img{ max-width:100%; max-height:100%; object-fit:contain; }
.dcw .warning-box{ display:flex; align-items:center; gap:14px; background:var(--warn-bg); border:1.5px solid var(--warn-border); border-radius:6px; padding:12px 16px; margin-bottom:16px; }
.dcw .warning-icon{ font-size:26px; flex-shrink:0; color:#b8860b; }
.dcw .warning-text b{ display:block; margin-bottom:4px; font-size:14px; }
.dcw .warning-text{ font-size:12.5px; line-height:1.5; color:#333; flex:1; }
.dcw .qr-box{ display:flex; align-items:center; gap:10px; flex-shrink:0; }
.dcw .qr-placeholder{ width:64px; height:64px; background:#fff; border:1px solid #999; }
.dcw .qr-text{ font-size:11px; font-weight:700; color:#333; line-height:1.3; }
.dcw .decl-row{ display:flex; gap:16px; margin-bottom:22px; align-items:flex-start; }
.dcw .decl-icon-box{ width:44px; height:44px; background:var(--green); border-radius:6px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; flex-shrink:0; }
.dcw .decl-text{ font-size:12px; line-height:1.5; flex:1; }
.dcw .decl-note{ flex:1.6; font-size:12px; line-height:1.6; }
.dcw .sig-row{ display:flex; gap:14px; }
.dcw .sig-box{ flex:1; border:1.5px solid var(--navy); border-radius:6px; padding:10px 12px; }
.dcw .sig-title{ display:flex; align-items:center; gap:8px; font-weight:700; font-size:12.5px; margin-bottom:10px; }
.dcw .sig-icon{ width:26px; height:26px; border-radius:50%; background:var(--navy); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; }
.dcw .sig-line{ border-bottom:1px dashed #999; text-align:center; color:#999; font-size:11px; padding-bottom:2px; }
@media (max-width:700px){
  .dcw .accessories-row{ flex-direction:column; }
  .dcw .vehicle-image-box{ width:100%; height:220px; }
  .dcw .two-col{ flex-direction:column; }
  .dcw .sig-row{ flex-direction:column; }
  .dcw .decl-row{ flex-direction:column; }
}
`;

const ACC_LEFT = [['7', 'Toolkit', 'toolkit'], ['8', 'Jack', 'jack'], ['9', 'Charger', 'charger'], ['10', 'Center Lock', 'center_lock']];
const ACC_RIGHT = [['11', 'Mat', 'mat'], ['12', 'Stapney', 'stapney'], ['13', 'Front Glass', 'front_glass'], ['14', 'H Lock', 'h_lock']];

function AccCol({ items, c }) {
  return (
    <div className="acc-col">
      {items.map(([num, label, key], i) => {
        const val = c[key];
        return (
          <div className={`acc-row${i === items.length - 1 ? ' last' : ''}`} key={key}>
            <span className="acc-num">{num}</span>
            <span className="acc-name">{label}</span>
            <span className="acc-colon">:</span>
            <span className={`acc-status ${val ? 'yes' : 'no'}`}>
              <span className={`check-circle ${val ? 'yes' : 'no'}`}>{val ? '✓' : '✕'}</span>
              {val ? 'YES' : 'NO'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DeliveryChallanPrintView({ challanId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setData(null); setError('');
    get(`/delivery-challans/${challanId}/print`)
      .then(setData)
      .catch((e) => setError(e.message || 'Unable to load Delivery Challan print.'));
  }, [challanId]);
  if (error) return <div className="modal"><div className="modalbox" style={{maxWidth:520}}><h3>Delivery Challan Print</h3><div className="error">{error}</div><button className="btn" onClick={onClose}>Close</button></div></div>;
  if (!data) return <div className="modal"><div className="modalbox" style={{maxWidth:420}}>Loading Delivery Challan…</div></div>;
  const { challan: c, company } = data;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '';
  const logoSrc = logoFailed || !c.umrn_code ? '/UMRN/_default.png' : `/UMRN/${c.umrn_code}.jpg`;

  return (
    <Overlay onClose={onClose}>
      <div className="dcw">
        <style>{DC_STYLES}</style>

        <div className="header-image-wrap" style={{ textAlign: 'center', marginBottom: 14 }}>
          <img src="/header/delivery_challan.jpg" alt={company?.name || 'G.R.D. MOTORS'}
               onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
          <div style={{ display: 'none' }}>
            <div className="top-line">DHAN-DHAN SAHIB SHRI GURU RAMDAS SAHIB JI</div>
            <div className="header">
              <div className="logo-block">
                <div className="logo-title">{company?.name || 'G.R.D. MOTORS'}</div>
                <div className="logo-sub">MANUFACTURER OF E-RICKSHAW AND E-CART</div>
              </div>
              <div className="addr">
                {company?.address1}<br />{company?.address2}<br />
                Email: {company?.email}<br />website: {company?.website}<br />
                GSTIN: {company?.gst_no}
              </div>
            </div>
          </div>
        </div>

        <div className="title-banner">&lt;&lt;&lt;&lt;&lt;&lt; DELIVERY CHALLAN / WARRANTY CARD &gt;&gt;&gt;&gt;&gt;&gt;</div>

        <div className="info-row">
          <div className="info-box">
            <div className="info-icon-col"><div className="info-icon">📋</div><div className="info-label">SERIAL NO.</div></div>
            <div className="info-value">{c.challan_no}</div>
          </div>
          <div className="info-box">
            <div className="info-icon-col"><div className="info-icon">🏪</div><div className="info-label">DEALER CODE</div></div>
            <div className="info-value">{c.dealer_code || '—'}</div>
          </div>
          <div className="info-box">
            <div className="info-icon-col"><div className="info-icon">📅</div><div className="info-label">DATED</div></div>
            <div className="info-value">{fmtDate(c.date)}</div>
          </div>
        </div>

        <div className="section-banner">{c.product_name || ''}</div>

        <div className="dealer-wrap">
          <div className="dealer-side">
            <div className="dealer-icon-circle">👤</div>
            DEALER<br />DETAILS
          </div>
          <div className="dealer-content">
            <div className="dealer-item">
              <div className="dealer-label"><span className="dealer-icon">🏢</span>Dealer</div>
              <div className="dealer-colon">:</div>
              <div className="dealer-val">{c.dealer_name}</div>
            </div>
            <div className="dealer-item">
              <div className="dealer-label"><span className="dealer-icon">📞</span>Mobile</div>
              <div className="dealer-colon">:</div>
              <div className="dealer-val">{c.dealer_mobile}</div>
            </div>
            <div className="dealer-item">
              <div className="dealer-label"><span className="dealer-icon">📍</span>Destination</div>
              <div className="dealer-colon">:</div>
              <div className="dealer-val">{c.destination}</div>
            </div>
            <div className="dealer-item">
              <div className="dealer-label"><span className="dealer-icon">📠</span>GSTIN</div>
              <div className="dealer-colon">:</div>
              <div className="dealer-val">{c.dealer_gst_no}</div>
            </div>
          </div>
        </div>

        <div className="salesperson-row">
          <div className="sp-box"><span className="sp-icon">👤</span>(Sales Person) Care of : <b>&nbsp;{c.salesman}</b></div>
          <div className="sp-box2">{c.other}</div>
        </div>

        <div className="two-col">
          <div className="col-left">
            <div className="tbl-banner">🚚 VEHICLE PARTICULARS</div>
            <table>
              <tbody>
                <tr><th>SRN</th><th>PARTICULARS</th><th>DETAILS</th></tr>
                <tr><td className="center">1</td><td>Chassis No.</td><td className="highlight">{c.chassis_no}</td></tr>
                <tr><td className="center">2</td><td>Motor No.</td><td>{c.motor_no}</td></tr>
                <tr><td className="center">3</td><td>Controller No.</td><td>{c.controller_no}</td></tr>
                <tr><td className="center">4</td><td>Colour</td><td>{c.colour}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="col-right">
            <div className="tbl-banner green">💲 BATTERY MAKE &amp; NOS.</div>
            <table>
              <tbody>
                <tr><th colSpan="2">{c.battery_maker || '—'}</th></tr>
                <tr><td className="center">1</td><td>{c.battery_no1 || '0'}</td></tr>
                <tr><td className="center">2</td><td>{c.battery_no2 || '0'}</td></tr>
                <tr><td className="center">3</td><td>{c.battery_no3 || '0'}</td></tr>
                <tr><td className="center">4</td><td>{c.battery_no4 || '0'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="accessories-row">
          <div className="acc-table-wrap">
            <div className="tbl-banner teal">ACCESSORIES / FITMENTS</div>
            <div className="acc-flex">
              <AccCol items={ACC_LEFT} c={c} />
              <AccCol items={ACC_RIGHT} c={c} />
            </div>
          </div>
          <div className="vehicle-image-box">
            <img src={logoSrc} alt={c.product_name || ''} onError={() => setLogoFailed(true)} />
          </div>
        </div>

        <div className="warning-box">
          <div className="warning-icon">⚠️</div>
          <div className="warning-text">
            <b>THIS RICKSHAW IS FOR DISPLAYING PURPOSE ONLY.</b>
            If it will be sold without prior permission will be had liable to give penalty / damage and case will be register under vehicle act.
          </div>
          <div className="qr-box">
            <div className="qr-placeholder" />
            <div className="qr-text">SCAN FOR<br />WARRANTY<br />VERIFICATION</div>
          </div>
        </div>

        <div className="decl-row">
          <div className="decl-icon-box">🛡️</div>
          <div className="decl-text">
            <b>DECLARATION</b><br />
            I agree with all the terms and conditions as per this delivery note and agreement with manufacture.
          </div>
          <div className="decl-note">
            <b>Note :</b> मोटर के जलने या पूरी तरह से जलने पर कोई भी रिससेसमेंट नहीं होगी।<br />
            मोटर अथवा कंट्रोलर / डिफेंसल को बाहर के मैकेनिक से खुलवाया जाता है तो उसकी कोई भी गॉस्टी नहीं होगी।
          </div>
        </div>

        <div className="sig-row">
          <div className="sig-box">
            <div className="sig-title"><span className="sig-icon">✓</span>CHECKED BY :</div>
            <div className="sig-line">.......................................</div>
          </div>
          <div className="sig-box">
            <div className="sig-title"><span className="sig-icon">🖊</span>APPROVED BY :</div>
            <div className="sig-line">.......................................</div>
          </div>
          <div className="sig-box">
            <div className="sig-title"><span className="sig-icon">📋</span>RECEIVED BY :</div>
            <div className="sig-line">.......................................</div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

export function TaxInvoicePrintView({ invoiceId, initialDoc = 'invoice', onClose }) {
  const [doc, setDoc] = useState(initialDoc);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    get(`/tax-invoices/${invoiceId}/print?doc=${doc}`)
      .then(setData)
      .catch((e) => setError(e.message || 'Unable to load Tax Invoice print.'));
  }, [invoiceId, doc]);

  const downloadUploadCode = async () => {
    const token = getToken();
    const r = await fetch(`/api/backend/tax-invoices/${invoiceId}/upload-code`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = await r.blob();
    const disposition = r.headers.get('content-disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? match[1] : 'upload.TXT';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  };

  if (error) return <div className="modal"><div className="modalbox" style={{maxWidth:520}}><h3>Tax Invoice Print</h3><div className="error">{error}</div><button className="btn" onClick={onClose}>Close</button></div></div>;
  if (!data) return <div className="modal"><div className="modalbox" style={{maxWidth:420}}>Loading Tax Invoice…</div></div>;
  const { invoice: i, company, doc_title, doc_no_label, rto_address,
    print_bank_name, print_bank_account_no, print_bank_ifsc } = data;

  const docSelect = (
    <select className="noprint" value={doc} onChange={(e) => setDoc(e.target.value)} style={{ marginRight: 8 }}>
      <option value="invoice">Tax Invoice</option>
      <option value="affidavit">Affidavit</option>
      <option value="undertaking">Undertaking</option>
      <option value="form22">Form 22</option>
    </select>
  );
  const extraActions = (
    <>
      {docSelect}
      <button className="btn noprint" onClick={downloadUploadCode}>Download UMRN Upload Code (.TXT)</button>
    </>
  );

  if (doc === 'invoice') {
    const p = data.product || {};
    const gstHalf = (i.gst_rate || 0) / 2;
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '';
    const umrn = p.umrn_code;
    const logoSrc = umrn ? `/UMRN/${umrn}.jpg` : '/UMRN/_default.png';

    return (
      <Overlay onClose={onClose} extraActions={extraActions}>
        <div className="tiw">
          <style>{TI_STYLES}</style>

          <div className="top-line">DHAN-DHAN SAHIB SHRI GURU RAMDAS SAHIB JI</div>
          <div className="header">
            <div>
              <div className="logo-title">{company?.name || 'G.R.D. MOTORS'}</div>
              <div className="logo-sub">MANUFACTURER OF E-RICKSHAW &amp; E-CART</div>
            </div>
            <div className="header-right">
              <div className="gstin-top">GSTIN : {company?.gst_no}</div>
              <div className="ti-banner">TAX INVOICE</div>
            </div>
          </div>

          <div className="row-top">
            <div className="box buyer-box">
              <div className="box-title"><span className="dot">👤</span>BUYER (BILLED TO)</div>
              <div className="buyer-body">
                <div className="buyer-name">{i.buyer_name}</div>
                <div className="buyer-addr">{i.buyer_address}</div>
                <div className="buyer-kv"><span className="k">GSTIN/UIN/PAN</span><span className="v">: {i.buyer_gst_no || i.buyer_pan || '—'}</span></div>
                <div className="buyer-kv"><span className="k">Mobile No.</span><span className="v">: {i.buyer_mobile}</span></div>
                <div className="buyer-kv"><span className="k">State</span><span className="v">: {i.buyer_state} ({i.buyer_state_code})</span></div>
              </div>
            </div>
            <div className="right-col">
              <div className="box">
                <table className="meta-table"><tbody>
                  <tr><td>📄 Invoice No.</td><td>: {i.bill_no}</td></tr>
                  <tr><td>📅 Dated</td><td>: {fmtDate(i.date)}</td></tr>
                  <tr><td>🧾 e-Way Bill No.</td><td>: {i.eway_bill_no || '—'}</td></tr>
                </tbody></table>
              </div>
              <div className="box">
                <div className="box-title"><span className="dot">🏦</span>COMPANY'S BANK DETAILS</div>
                <div className="bank-body">
                  <table><tbody>
                    <tr><td>Bank Name</td><td>: {print_bank_name || ''}</td></tr>
                    <tr><td>Account No.</td><td>: {print_bank_account_no || ''}</td></tr>
                    <tr><td>IFSC Code</td><td>: {print_bank_ifsc || ''}</td></tr>
                  </tbody></table>
                </div>
              </div>
            </div>
          </div>

          <div className="info-strip">
            <div className="info-cell">
              <div className="lbl"><span className="dot" />DEALER</div>
              <div className="val">{i.dealer_name || '—'}</div>
            </div>
            <div className="info-cell">
              <div className="lbl"><span className="dot" />CUSTOMER'S OTHERS INFO.</div>
              <div className="val">{i.financer_name || '—'}</div>
            </div>
            <div className="info-cell">
              <div className="lbl"><span className="dot" />MODE OF PAYMENT</div>
              <div className="val">{i.mode_term || '—'}</div>
            </div>
            <div className="info-cell">
              <div className="lbl"><span className="dot" />VEHICLE REG. NO.</div>
              <div className="val">{i.vehicle_reg_no || '\u00a0'}</div>
            </div>
            <div className="info-cell">
              <div className="lbl"><span className="dot" />DESPATCHED THROUGH</div>
              <div className="val">{i.despatch_through || '\u00a0'}</div>
            </div>
          </div>

          <table className="items">
            <thead>
              <tr>
                <th style={{ width: 36 }}>S. No.</th><th>DESCRIPTION OF GOODS</th><th>HSN/SAC</th>
                <th>QUANTITY</th><th>RATE</th><th>PER</th><th>DISC.</th><th>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="center">1</td>
                <td>
                  <div className="item-name">{i.product_name}</div>
                  <div className="item-sub">Chassis No. : {i.chassis_no}</div>
                  <div className="item-sub">Motor No. : {i.motor_no}</div>
                  <div className="item-sub">Color : {i.colour}</div>
                </td>
                <td className="center">{p.hsn_code || '—'}</td>
                <td className="center">1 {p.unit || 'PCS'}</td>
                <td className="num"><Money value={i.taxable_value} noSymbol /></td>
                <td className="center">{p.unit || 'PCS'}</td>
                <td className="center">{i.discount ? <Money value={i.discount} noSymbol /> : '-'}</td>
                <td className="num"><Money value={i.taxable_value} /></td>
              </tr>
              <tr><td colSpan={8}>&nbsp;</td></tr>
            </tbody>
          </table>

          <div className="totals-row">
            <div className="box words-box">
              <div className="box-title" style={{ marginLeft: -14, marginTop: -10, marginRight: -14, marginBottom: 10 }}>
                <span className="dot">🔤</span>AMOUNT CHARGEABLE (IN WORDS)
              </div>
              {amountInWords(i.bill_total)}
            </div>
            <div className="box amt-box">
              <table className="amt-table"><tbody>
                <tr><td>Taxable Amount</td><td><Money value={i.taxable_value} /></td></tr>
                <tr><td>GST @ {i.gst_rate}%</td><td><Money value={(Number(i.cgst_amount) || 0) + (Number(i.sgst_amount) || 0) + (Number(i.igst_amount) || 0)} /></td></tr>
              </tbody></table>
              <div className="amt-total"><span>TOTAL</span><span><Money value={i.bill_total} /></span></div>
            </div>
          </div>

          <div className="decl-row">
            <div className="box decl-box">
              <div className="box-title" style={{ marginLeft: -14, marginTop: -10, marginRight: -14, marginBottom: 10 }}>
                <span className="dot">ℹ️</span>DECLARATION
              </div>
              <ol>
                <li>Goods Once Sold Will Not Taken Back</li>
                <li>Warranty As Per T&amp;C of Principal Company Only</li>
                <li>Subject To Delhi Jurisdiction Only</li>
              </ol>
            </div>
            <div className="box sign-box">
              <div className="for">for {company?.name || 'G.R.D. MOTORS'}</div>
              <div className="line">Authorised Signatory</div>
            </div>
          </div>

          <div className="footer-row">
            <div className="footer-addr">
              <div>📍 {rto_address
                ? rto_address.split('\n').map((l, idx, arr) => (
                    <span key={idx}>{l}{idx < arr.length - 1 && <br />}</span>
                  ))
                : (<>{company?.address1}<br />{company?.address2}</>)}</div>
              <div>✉️ E-Mail : {company?.email}</div>
              <div>📞 Mob : {company?.mobile}</div>
              <div>🌐 Web site : {company?.website}</div>
            </div>
            <div className="footer-side">
              <div className="qr-placeholder">QR CODE</div>
              <div className="flag-logo"><img src={logoSrc} alt={i.product_name || ''} /></div>
            </div>
          </div>

          <div className="bottom-strip">DHAN DHAN SAHIB SHRI GURU RAM DAS SAHIB JI</div>
        </div>
      </Overlay>
    );
  }

  // Affidavit / Undertaking / Form 22 — shared simpler layout, since these
  // are short declaration/certificate documents rather than tabular ones.
  return (
    <Overlay onClose={onClose} extraActions={extraActions}>
      <div className="docHeader">
        <div>
          <h2>{company?.name || 'G.R.D. MOTORS'}</h2>
          <div>{company?.address1}</div>
        </div>
        <div className="docTitleBox">
          <b>{doc_title?.toUpperCase()}</b>
          <div>{doc_no_label} {i.bill_no}</div>
          <div>Date: {fmtDate(i.date)}</div>
        </div>
      </div>

      {doc === 'form22' && (
        <div className="docDeclaration">
          <p>This is to certify that Vehicle Chassis No. <b>{i.chassis_no}</b>, Motor No. <b>{i.motor_no}</b>,
          Model <b>{i.product_name}</b>, sold to <b>{i.buyer_name}</b>, conforms to the provisions of
          Rule 47(1)(g) of the Central Motor Vehicles Rules, 1989 and is road-worthy.</p>
          <p>Fuel Type: {data.product?.fuel_type} &nbsp; Type Approval No.: {data.product?.type_approval_no}</p>
        </div>
      )}
      {doc === 'affidavit' && (
        <div className="docDeclaration">
          <p>I, <b>{i.buyer_name}</b> {i.buyer_relation} <b>{i.buyer_father_name}</b>, residing at
          {' '}{i.buyer_address}, do hereby solemnly affirm and declare that I am the bona fide purchaser
          of the vehicle bearing Chassis No. <b>{i.chassis_no}</b> and Motor No. <b>{i.motor_no}</b>,
          Model <b>{i.product_name}</b>, purchased from {company?.name || 'G.R.D. MOTORS'} vide Invoice No.
          {' '}{i.bill_no} dated {fmtDate(i.date)}.</p>
        </div>
      )}
      {doc === 'undertaking' && (
        <div className="docDeclaration">
          <p>I, <b>{i.buyer_name}</b>, undertake that the vehicle bearing Chassis No. <b>{i.chassis_no}</b>
          and Motor No. <b>{i.motor_no}</b>, Model <b>{i.product_name}</b>, purchased from
          {' '}{company?.name || 'G.R.D. MOTORS'} shall be used in accordance with applicable motor vehicle
          rules and regulations, and I shall be solely responsible for any violation thereof.</p>
        </div>
      )}

      {rto_address && (
        <div className="docRtoAddress">
          <b>To,</b><br />{rto_address.split('\n').map((l, idx) => <div key={idx}>{l}</div>)}
        </div>
      )}
      <div className="docSignRow">
        <div>Signature of Deponent/Buyer</div>
        <div>For {company?.name || 'G.R.D. MOTORS'}</div>
      </div>
    </Overlay>
  );
}

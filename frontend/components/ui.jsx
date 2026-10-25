'use client';
import { useEffect, useRef, useState } from 'react';

const isoToDisplayDate = (value) => {
  if (!value) return '';
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(value);
};

const displayToIsoDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const m = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (!m) return null;
  const dd = String(m[1]).padStart(2, '0');
  const mm = String(m[2]).padStart(2, '0');
  const yyyy = m[3];
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
};

// Searchable dropdown used by Field type="combo". Native <datalist> ka popup chhota/cut jata tha
// (lamba chassis no. poora nahi dikhta tha); ye list input ki poori width me, scroll ke saath dikhati hai.
function ComboInput({ value, onChange, options, required, readOnly }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const text = String(value ?? '');
  const all = (options || []).map((o) => ({ value: String(o.value ?? o), label: String(o.label ?? o.value ?? o) }));
  const exact = all.some((o) => o.value.toLowerCase() === text.trim().toLowerCase());
  const q = text.trim().toLowerCase();
  const list = (!q || exact ? all : all.filter((o) => (o.label + ' ' + o.value).toLowerCase().includes(q))).slice(0, 300);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (o) => { onChange(o.value); setOpen(false); setActive(-1); };
  const onKeyDown = (e) => {
    if (readOnly) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && active >= 0 && list[active]) { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input value={text} required={required} readOnly={readOnly} autoComplete="off"
             onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
             onFocus={() => { if (!readOnly) setOpen(true); }}
             onKeyDown={onKeyDown}
             style={{ width: '100%', ...(readOnly ? { background: '#f2f4f7', color: '#475467' } : {}) }} />
      {open && !readOnly && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 60, marginTop: 2, maxHeight: 240, overflowY: 'auto',
                      background: 'var(--card, #fff)', color: 'var(--ink, #111)', border: '1px solid var(--line, #d0d5dd)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {list.length === 0 && <div className="muted" style={{ padding: '8px 10px', fontSize: 13 }}>Koi match nahi mila.</div>}
          {list.map((o, i) => (
            <div key={o.value + i} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
                 style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', wordBreak: 'break-all',
                          background: i === active ? 'color-mix(in srgb, var(--accent, #2563eb) 14%, transparent)' : 'transparent' }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, type = 'text', value, onChange, required, options, readOnly, autoComplete, name }) {
  const [dateText, setDateText] = useState(() => type === 'date' ? isoToDisplayDate(value) : '');
  useEffect(() => {
    if (type === 'date') setDateText(isoToDisplayDate(value));
  }, [type, value]);

  // Dates are displayed to users as dd-mm-yyyy while the app/API keeps ISO yyyy-mm-dd.
  const dateField = type === 'date' ? (
    <input
      type="text"
      value={dateText}
      onChange={(e) => {
        const text = e.target.value;
        setDateText(text);
        if (!text.trim()) onChange('');
        else {
          const iso = displayToIsoDate(text);
          if (iso) onChange(iso);
        }
      }}
      onBlur={() => {
        const iso = displayToIsoDate(dateText);
        if (dateText.trim() && !iso) setDateText(isoToDisplayDate(value));
        else if (!dateText.trim()) onChange('');
      }}
      placeholder="dd-mm-yyyy"
      inputMode="numeric"
      maxLength={10}
      required={required}
      readOnly={readOnly}
      style={readOnly ? { background: '#f2f4f7', color: '#475467' } : undefined}
      aria-label={`${label} (dd-mm-yyyy)`}
    />
  ) : null;

  // 'combo' = free-text input with a dropdown of suggestions (via
  // <datalist>) — used for fields backed by a Master list (e.g. Financer
  // Name) where old records may hold a name that's no longer in the master,
  // so a strict <select> would blank those out. Typing still works; the
  // dropdown just offers the master's names to pick from.
  return (
    <div className="field">
      <label>{label}</label>
      {type === 'checkbox' ? (
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} disabled={readOnly}>
          <option value="">Select…</option>
          {(options || []).map((o) => (
            <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
          ))}
        </select>
      ) : type === 'combo' ? (
        <ComboInput value={value} onChange={onChange} options={options} required={required} readOnly={readOnly} />
      ) : type === 'date' ? (
        dateField
      ) : type === 'textarea' ? (
        <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} readOnly={readOnly} />
      ) : (
        <input type={type} name={name} autoComplete={autoComplete} step={type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} readOnly={readOnly}
               style={readOnly ? { background: '#f2f4f7', color: '#475467' } : undefined} />
      )}
    </div>
  );
}

export function Card({ title, actions, children, style }) {
  return (
    <div className="card" style={style}>
      {(title || actions) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {title && <b>{title}</b>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="error">{message}</div>;
}

export function Money({ value, noSymbol }) {
  const n = Number(value || 0);
  const formatted = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <span>{noSymbol ? '' : '\u20b9'}{formatted}</span>;
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function Pill({ text, kind }) {
  const cls = kind === 'm' ? 'm' : kind === 'd' ? 'd' : kind === 't' ? 't' : '';
  return <span className={'pill ' + cls}>{text}</span>;
}

export function EmptyState({ text = 'No records found.' }) {
  return <div className="muted" style={{ padding: 24, textAlign: 'center' }}>{text}</div>;
}

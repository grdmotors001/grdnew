'use client';
import { useEffect, useState } from 'react';

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

export function Field({ label, type = 'text', value, onChange, required, options, readOnly }) {
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
  const comboId = type === 'combo' ? 'combo-' + label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() : null;
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
        <>
          <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required}
                 readOnly={readOnly} list={comboId}
                 style={readOnly ? { background: '#f2f4f7', color: '#475467' } : undefined} />
          <datalist id={comboId}>
            {(options || []).map((o) => (
              <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
            ))}
          </datalist>
        </>
      ) : type === 'date' ? (
        dateField
      ) : type === 'textarea' ? (
        <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} readOnly={readOnly} />
      ) : (
        <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} readOnly={readOnly}
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

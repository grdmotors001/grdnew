'use client';
import { useEffect, useState } from 'react';

// Header me "?" button: keyboard shortcuts aur tips ek jagah. Pehli baar ek chhota "new" dot dikhta hai.
// sections: [{ title, rows: [[keys, description], ...] }]
export function HelpButton({ sections, storageKey = 'grd_help_seen_v1' }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    try { setSeen(window.localStorage.getItem(storageKey) === '1'); } catch { setSeen(true); }
  }, [storageKey]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const show = () => {
    setOpen(true);
    if (!seen) { setSeen(true); try { window.localStorage.setItem(storageKey, '1'); } catch {} }
  };
  return (
    <>
      <button type="button" className="grdHeaderIcon" title="Help & Shortcuts" aria-label="Help and shortcuts" onClick={show} style={{ position: 'relative' }}>
        <span aria-hidden="true" style={{ fontWeight: 800 }}>?</span>
        {!seen && <span aria-hidden="true" style={{ position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #fff' }} />}
      </button>
      {open && (
        <div className="modal" onClick={() => setOpen(false)}>
          <div className="modalbox" style={{ maxWidth: 560, maxHeight: '86vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Help and shortcuts">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>Help & Shortcuts</h2>
              <button type="button" className="btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            {sections.filter((s) => s.rows?.length).map((s) => (
              <div key={s.title} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>{s.title}</div>
                <div style={{ display: 'grid', gap: 2 }}>
                  {s.rows.map(([keys, text], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 2px', borderBottom: '1px solid #eef2f6', fontSize: 13 }}>
                      <span>{text}</span>
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                        {String(keys).split('|').map((k) => (
                          <kbd key={k} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderBottomWidth: 2, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, color: '#1e293b', fontFamily: 'inherit' }}>{k}</kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

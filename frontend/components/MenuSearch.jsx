'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

// Menu search: option dhoondne ke liye. Admin (Shell) aur Dealer panel dono me use hota hai.
// items: [{ key, label, group }]  |  onPick(key) menu/page kholta hai.
// Shortcut: Ctrl+K ya "/" (jab koi input khula na ho) se search box active ho jata hai.
const readRecent = (k) => { try { return JSON.parse(window.localStorage.getItem(k) || '[]'); } catch { return []; } };

export function MenuSearch({ items, onPick, variant = 'dark', placeholder = 'Search menu…  (Ctrl+K)', autoFocus = false, recentKey = '', alwaysRecent = false }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState([]);
  useEffect(() => { if (recentKey) setRecent(readRecent(recentKey)); }, [recentKey]);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const seen = new Set();
    return (items || [])
      .map((it) => {
        const label = String(it.label || '').toLowerCase();
        const group = String(it.group || '').toLowerCase();
        const hay = `${label} ${group} ${String(it.key || '').toLowerCase().replace(/-/g, ' ')}`;
        if (!tokens.every((t) => hay.includes(t))) return null;
        const score = label.startsWith(tokens[0]) ? 0 : label.includes(tokens[0]) ? 1 : 2;
        return { ...it, score };
      })
      .filter(Boolean)
      .filter((it) => (seen.has(it.key) ? false : (seen.add(it.key), true)))
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);
  }, [q, items]);

  useEffect(() => { setHi(0); }, [q]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); return; }
      if (e.key === '/' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recentItems = useMemo(() => {
    const byKey = new Map((items || []).map((it) => [it.key, it]));
    return recent.map((k) => byKey.get(k)).filter(Boolean).slice(0, 6);
  }, [recent, items]);

  const pick = (it) => {
    if (!it) return;
    if (recentKey) {
      const next = [it.key, ...readRecent(recentKey).filter((k) => k !== it.key)].slice(0, 8);
      try { window.localStorage.setItem(recentKey, JSON.stringify(next)); } catch {}
      setRecent(next);
    }
    onPick(it.key); setQ(''); inputRef.current?.blur();
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[hi] || results[0]); }
    else if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); }
  };

  return (
    <div className={'menuSearch ' + variant}>
      <style>{`
        .menuSearch{position:relative;margin:10px 4px 8px}
        .menuSearch input{width:100%;box-sizing:border-box;border-radius:999px;padding:9px 32px 9px 34px;font-size:13px;outline:none;border:1px solid transparent}
        .menuSearch.dark input{background:#ffffff1f;color:#fff}
        .menuSearch.dark input::placeholder{color:#ffffff99}
        .menuSearch.dark input:focus{background:#ffffff2e;border-color:#ffffff66}
        .menuSearch.light input{background:#f1f5f9;color:#1e293b;border-color:#dbe2ea}
        .menuSearch.light input:focus{border-color:var(--accent)}
        .menuSearchIcon{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:13px;opacity:.75;pointer-events:none}
        .menuSearch.dark .menuSearchIcon{color:#fff}
        .menuSearchClear{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px}
        .menuSearch.dark .menuSearchClear{color:#fff}
        .menuSearchList{margin-top:6px;max-height:55vh;overflow-y:auto;border-radius:12px;padding:4px}
        .menuSearch.dark .menuSearchList{background:#0000002e}
        .menuSearch.light .menuSearchList{background:#fff;border:1px solid #e4e9ef;box-shadow:0 6px 18px rgba(31,55,79,.1)}
        .menuSearchItem{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;border:0;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;gap:1px}
        .menuSearchItem b{font-size:13px;font-weight:700}
        .menuSearchItem small{font-size:10px;opacity:.7}
        .menuSearch.dark .menuSearchItem{color:#fff}
        .menuSearch.dark .menuSearchItem.on,.menuSearch.dark .menuSearchItem:hover{background:#ffffff26}
        .menuSearch.light .menuSearchItem{color:#1e293b}
        .menuSearch.light .menuSearchItem.on,.menuSearch.light .menuSearchItem:hover{background:#eef3fb}
        .menuSearchEmpty{padding:10px;font-size:12px;opacity:.75}
        .menuSearch.dark .menuSearchEmpty{color:#fff}
      `}</style>
      <span className="menuSearchIcon" aria-hidden="true">🔍</span>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onInputKey}
        placeholder={placeholder}
        aria-label="Search menu"
        autoComplete="off"
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {q && <button type="button" className="menuSearchClear" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Clear search">×</button>}
      {!q.trim() && recentItems.length > 0 && (focused || alwaysRecent) && (
        <div className="menuSearchList" role="listbox" aria-label="Recent">
          <div className="menuSearchEmpty" style={{ paddingBottom: 2, fontWeight: 800, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.06em' }}>Abhi khole hue</div>
          {recentItems.map((it) => (
            <button type="button" key={it.key} className="menuSearchItem" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}>
              <b>{it.label}</b>{it.group ? <small>{it.group}</small> : null}
            </button>
          ))}
        </div>
      )}
      {q.trim() && (
        <div className="menuSearchList" role="listbox">
          {results.length ? results.map((it, i) => (
            <button type="button" key={it.key} role="option" aria-selected={i === hi}
              className={'menuSearchItem' + (i === hi ? ' on' : '')}
              onMouseEnter={() => setHi(i)} onClick={() => pick(it)}>
              <b>{it.label}</b>{it.group ? <small>{it.group}</small> : null}
            </button>
          )) : <div className="menuSearchEmpty">Kuch nahi mila: “{q}”</div>}
        </div>
      )}
    </div>
  );
}

// Mobile: poori screen ka search sheet (bottom bar ke 🔍 se khulta hai).
export function MobileSearchSheet({ open, onClose, items, onPick, recentKey }) {
  if (!open) return null;
  return (
    <div className="modal" style={{ alignItems: 'flex-start', paddingTop: 'max(14px, env(safe-area-inset-top))' }} onClick={onClose}>
      <div className="modalbox" style={{ width: 'min(560px, 96vw)', maxHeight: '88vh', overflow: 'auto', padding: 14 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search menu">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <MenuSearch items={items} variant="light" autoFocus alwaysRecent recentKey={recentKey} placeholder="Kya dhoondh rahe ho?" onPick={(k) => { onPick(k); onClose(); }} />
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close search">✕</button>
        </div>
      </div>
    </div>
  );
}

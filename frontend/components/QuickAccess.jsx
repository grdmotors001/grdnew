'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Plus, Settings2, Star, X } from 'lucide-react';

// Mobile "Quick Access" page: user ke favourite options ek jagah, ⚙ se add / remove / sequence change.
// Favourites is device ke localStorage me user-wise save hote hain.
const clean = (label) => String(label || '').replace(/^F\d+\s*·\s*/, '');

export function QuickAccess({ open, onClose, items, onPick, storageKey, iconFor }) {
  const [favs, setFavs] = useState([]);
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
      setFavs(Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []);
    } catch { setFavs([]); }
  }, [storageKey]);

  const byKey = useMemo(() => Object.fromEntries((items || []).map((it) => [it.key, it])), [items]);
  // Jo option ab user ko allowed nahi (ya menu se hat gaya) wo dikhana nahi.
  const list = favs.filter((k) => byKey[k]);

  const save = (next) => {
    setFavs(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  const remove = (k) => save(list.filter((x) => x !== k));
  const add = (k) => { if (!list.includes(k)) save([...list, k]); };
  const move = (k, dir) => {
    const i = list.indexOf(k), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };

  const available = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items || []).filter((it) => !favs.includes(it.key) && (!s || (clean(it.label) + ' ' + (it.group || '')).toLowerCase().includes(s)));
  }, [items, favs, q]);

  if (!open) return null;
  const Icon = (k) => { const C = (iconFor && iconFor(k)) || FileText; return <C size={20} />; };
  const close = () => { setEdit(false); setQ(''); onClose(); };

  return (
    <div className="qaPage" role="dialog" aria-label="Quick Access">
      <style>{`
        .qaPage{display:none}
        @media(max-width:700px){
          .qaPage{display:block;position:fixed;inset:0;z-index:70;background:var(--bg);overflow-y:auto;padding:max(12px,env(safe-area-inset-top)) 14px 100px}
          .qaHead{display:flex;align-items:center;gap:10px;margin-bottom:14px}
          .qaHead h2{flex:1;margin:0;font-size:20px}
          .qaIconBtn{display:inline-flex;align-items:center;gap:6px;height:40px;min-width:40px;justify-content:center;padding:0 10px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:12px;font-size:13px;font-weight:700}
          .qaIconBtn.on{background:var(--accent);border-color:var(--accent);color:#fff}
          .qaGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
          .qaTile{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;min-width:0;padding:14px 12px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:14px;box-shadow:0 2px 8px #0000000a}
          .qaTile svg{color:var(--accent)}
          .qaTile b{font-size:13px;line-height:1.25;overflow-wrap:anywhere}
          .qaTile small{color:var(--muted);font-size:10px}
          .qaEmpty{text-align:center;color:var(--muted);padding:40px 10px;font-size:13px}
          .qaSec{margin:16px 2px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
          .qaRow{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;border:1px solid var(--line);background:var(--card);border-radius:12px}
          .qaRow .qaLbl{flex:1;min-width:0;font-size:13px;font-weight:650}
          .qaRow .qaLbl small{display:block;color:var(--muted);font-size:10px;font-weight:500}
          .qaMini{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:9px;flex:none}
          .qaMini:disabled{opacity:.35}
          .qaMini.del{color:#dc2626}
          .qaSearch{width:100%;margin-bottom:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--input-bg,var(--card));color:var(--ink);font:inherit}
        }
      `}</style>

      <div className="qaHead">
        <button type="button" className="qaIconBtn" onClick={close} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2>{edit ? 'Quick Access — Edit' : 'Quick Access'}</h2>
        <button type="button" className={'qaIconBtn' + (edit ? ' on' : '')} onClick={() => setEdit((v) => !v)} aria-label="Favourites settings" title="Add / remove / sequence">
          <Settings2 size={18} />{edit && <span>Done</span>}
        </button>
      </div>

      {!edit && (list.length ? (
        <div className="qaGrid">
          {list.map((k) => (
            <button key={k} type="button" className="qaTile" onClick={() => { onPick(k); close(); }}>
              {Icon(k)}<b>{clean(byKey[k].label)}</b>{byKey[k].group ? <small>{byKey[k].group}</small> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="qaEmpty"><Star size={30} /><div style={{ marginTop: 8 }}>Abhi koi favourite option nahi hai.</div><div>Upar ⚙ dabakar apne pasandida options add karein.</div></div>
      ))}

      {edit && <>
        <div className="qaSec">Favourites ({list.length}) — upar/neeche se sequence badlein</div>
        {list.length === 0 && <div className="qaEmpty" style={{ padding: '10px' }}>Koi favourite nahi. Neeche se add karein.</div>}
        {list.map((k, i) => (
          <div className="qaRow" key={k}>
            <div className="qaLbl">{clean(byKey[k].label)}{byKey[k].group ? <small>{byKey[k].group}</small> : null}</div>
            <button type="button" className="qaMini" disabled={i === 0} onClick={() => move(k, -1)} aria-label="Upar"><ChevronUp size={16} /></button>
            <button type="button" className="qaMini" disabled={i === list.length - 1} onClick={() => move(k, 1)} aria-label="Neeche"><ChevronDown size={16} /></button>
            <button type="button" className="qaMini del" onClick={() => remove(k)} aria-label="Hatao"><X size={16} /></button>
          </div>
        ))}

        <div className="qaSec">Option add karein</div>
        <input className="qaSearch" placeholder="Option dhoondhein…" value={q} onChange={(e) => setQ(e.target.value)} />
        {available.map((it) => (
          <div className="qaRow" key={it.key}>
            <div className="qaLbl">{clean(it.label)}{it.group ? <small>{it.group}</small> : null}</div>
            <button type="button" className="qaMini" onClick={() => add(it.key)} aria-label="Add"><Plus size={16} /></button>
          </div>
        ))}
        {!available.length && <div className="qaEmpty" style={{ padding: '10px' }}>Koi option nahi mila.</div>}
      </>}
    </div>
  );
}

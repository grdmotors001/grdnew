'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { NAV_CATALOG, NAV_ICON_NAMES } from '../lib/menu';
import { ErrorBanner, EmptyState, useAsyncAction } from './ui';

// Setup > Menu / Tabs Settings — lets a super user add a new sidebar tab,
// rename or hide an existing one, reorder tabs, and pick exactly which
// modules (from every module in the app) each tab shows. As soon as one
// tab is created here, the sidebar switches from the built-in layout to
// this admin-configured one (see /api/nav-config).
export function NavTabsSettings() {
  const [tabs, setTabs] = useState(null);
  const [openItemsFor, setOpenItemsFor] = useState(null);
  const [draftItems, setDraftItems] = useState([]);
  const [optionsSearch, setOptionsSearch] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState(NAV_ICON_NAMES[0]);
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/admin/nav-tabs').then(setTabs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const createTab = (e) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    run(async () => {
      await post('/admin/nav-tabs', { label, icon: newIcon, items: [] });
      setNewLabel('');
      const fresh = await get('/admin/nav-tabs');
      setTabs(fresh);
      // A tab with 0 modules stays hidden in the sidebar (see Shell.jsx),
      // which otherwise looks like "the new tab isn't showing up" right
      // after creating it — so send the admin straight to picking items.
      const created = fresh.find((t) => t.label === label);
      if (created) openItems(created);
    });
  };

  const renameTab = (t, label) => run(async () => { await put(`/admin/nav-tabs/${t.id}`, { label }); load(); });
  const setIcon = (t, icon) => run(async () => { await put(`/admin/nav-tabs/${t.id}`, { icon }); load(); });
  const toggleHidden = (t) => run(async () => { await put(`/admin/nav-tabs/${t.id}`, { hidden: !t.hidden }); load(); });
  const removeTab = (t) => {
    if (!confirm(`Delete the "${t.label}" tab? Modules inside it are not deleted — just this tab.`)) return;
    run(async () => { await del(`/admin/nav-tabs/${t.id}`); load(); });
  };

  const move = (idx, dir) => {
    const next = [...tabs];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setTabs(next);
    run(async () => { await put('/admin/nav-tabs/reorder', { order: next.map((t) => t.id) }); });
  };

  const openItems = (t) => { setOpenItemsFor(t.id); setDraftItems(t.items || []); setOptionsSearch(''); };
  const closeItems = () => { setOpenItemsFor(null); setOptionsSearch(''); };
  const toggleItem = (key) => setDraftItems((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  const saveItems = (t) => run(async () => { await put(`/admin/nav-tabs/${t.id}`, { items: draftItems }); setOpenItemsFor(null); load(); });

  if (!tabs) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      <b>Menu / Tabs Settings</b>
      <p className="muted" style={{ marginTop: 4 }}>
        Right side ke sidebar tabs yahan se control karein — naya tab banayein, kisi tab ka naam badlein ya usse
        hide karein, aur har tab mein kaunse options dikhne hain wo select karein. Koi tab na ho to sidebar apne
        default layout mein rehta hai.
      </p>
      <ErrorBanner message={error} />

      {tabs.length === 0 ? (
        <EmptyState text="Abhi koi custom tab nahi hai — sidebar default layout use kar raha hai." />
      ) : (
        <div className="tablewrap" style={{ marginTop: 14 }}>
          <table className="table">
            <thead><tr><th>Order</th><th>Tab Name</th><th>Icon</th><th>Modules</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tabs.map((t, idx) => (
                <tr key={t.id}>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                    <button className="btn" disabled={idx === tabs.length - 1} onClick={() => move(idx, 1)}>↓</button>
                  </td>
                  <td>
                    <input className="input" defaultValue={t.label} style={{ maxWidth: 220 }}
                      onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== t.label) renameTab(t, e.target.value.trim()); }} />
                  </td>
                  <td>
                    <select value={t.icon || ''} onChange={(e) => setIcon(t, e.target.value)}>
                      {NAV_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </td>
                  <td>
                    {(t.items || []).length} selected
                    {!(t.items || []).length && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        ⚠ 0 modules — ye tab sidebar me nahi dikhega jab tak options add na karein
                      </div>
                    )}
                  </td>
                  <td>{t.hidden ? 'Hidden' : 'Visible'}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => openItems(t)}>Options</button>
                    <button className="btn" onClick={() => toggleHidden(t)}>{t.hidden ? 'Show' : 'Hide'}</button>
                    <button className="btn danger" onClick={() => removeTab(t)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openItemsFor != null && (() => {
        const activeTab = tabs.find((t) => t.id === openItemsFor);
        const search = optionsSearch.trim().toLowerCase();
        const filteredGroups = NAV_CATALOG
          .map(({ group, items }) => ({ group, items: search ? items.filter(({ label }) => label.toLowerCase().includes(search)) : items }))
          .filter((g) => g.items.length > 0);
        const totalCount = NAV_CATALOG.reduce((n, g) => n + g.items.length, 0);
        const selectGroup = (groupKeys, allSelected) => setDraftItems((d) => allSelected ? d.filter((k) => !groupKeys.includes(k)) : [...new Set([...d, ...groupKeys])]);
        return (
          <div className="modal">
            <div className="modalbox navOptionsModal">
              <style>{`
                .modalbox.navOptionsModal{width:min(760px,100%);padding:0;position:relative;display:flex;flex-direction:column;max-height:88vh}
                .navOptionsClose{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--muted);font-size:17px;line-height:1;display:grid;place-items:center;cursor:pointer}
                .navOptionsClose:hover{color:var(--ink);border-color:var(--accent)}
                .navOptionsHead{padding:22px 56px 16px 24px;border-bottom:1px solid var(--line)}
                .navOptionsHead h2{margin:0;font-size:19px}
                .navOptionsHead p{margin:5px 0 0}
                .navOptionsToolbar{display:flex;align-items:center;gap:10px;padding:13px 24px;border-bottom:1px solid var(--line);flex-wrap:wrap}
                .navOptionsSearch{flex:1;min-width:170px;min-height:38px}
                .navOptionsCount{font-size:11px;font-weight:800;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;padding:7px 13px;white-space:nowrap}
                .navOptionsBulk{display:flex;gap:8px}
                .navOptionsBulk button{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;white-space:nowrap}
                .navOptionsBulk button:hover{border-color:var(--accent);color:var(--accent)}
                .navOptionsBody{overflow-y:auto;padding:4px 24px 6px;flex:1}
                .navOptionsGroup{border:1px solid var(--line);border-radius:14px;margin:14px 0;overflow:hidden;background:var(--strip-bg)}
                .navOptionsGroupHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:var(--card);border-bottom:1px solid var(--line)}
                .navOptionsGroupHead strong{font-size:12.5px;color:var(--ink)}
                .navOptionsGroupHead .navOptionsGroupMeta{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--muted);font-weight:700}
                .navOptionsGroupMeta button{border:0;background:none;color:var(--accent);font-size:11px;font-weight:800;cursor:pointer;padding:0}
                .navOptionsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:8px;padding:12px 14px}
                .navOptionsChip{display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:9px 11px;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;transition:.12s ease}
                .navOptionsChip:hover{border-color:var(--accent)}
                .navOptionsChip.checked{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--card));color:var(--accent)}
                .navOptionsChip input{accent-color:var(--accent);width:15px;height:15px;flex:none}
                .navOptionsEmpty{padding:36px 10px;text-align:center;color:var(--muted);font-size:13px}
                .navOptionsFoot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;border-top:1px solid var(--line);background:var(--card)}
                .navOptionsFootCount{font-size:12px;color:var(--muted);font-weight:700}
                @media(max-width:640px){.navOptionsHead,.navOptionsToolbar,.navOptionsBody,.navOptionsFoot{padding-left:16px;padding-right:16px}.navOptionsHead{padding-right:52px}.navOptionsFoot{flex-direction:column;align-items:stretch}.navOptionsFoot .actions{justify-content:flex-end}}
              `}</style>
              <button type="button" className="navOptionsClose" onClick={closeItems} aria-label="Close">×</button>
              <div className="navOptionsHead">
                <h2>Choose Options for "{activeTab?.label}"</h2>
                <p className="muted">Select karein ki is tab mein kaunse submenu options dikhne hain.</p>
              </div>
              <div className="navOptionsToolbar">
                <input className="input navOptionsSearch" placeholder="Search options…" value={optionsSearch} onChange={(e) => setOptionsSearch(e.target.value)} />
                <div className="navOptionsBulk">
                  <button type="button" onClick={() => setDraftItems(NAV_CATALOG.flatMap((g) => g.items.map((i) => i.key)))}>Select All</button>
                  <button type="button" onClick={() => setDraftItems([])}>Clear All</button>
                </div>
                <span className="navOptionsCount">{draftItems.length} / {totalCount} selected</span>
              </div>
              <div className="navOptionsBody">
                {filteredGroups.length === 0 ? (
                  <div className="navOptionsEmpty">Koi option nahi mila "{optionsSearch}" ke liye.</div>
                ) : filteredGroups.map(({ group, items }) => {
                  const groupKeys = items.map((i) => i.key);
                  const selectedInGroup = groupKeys.filter((k) => draftItems.includes(k)).length;
                  const allSelected = selectedInGroup === groupKeys.length;
                  return (
                    <div className="navOptionsGroup" key={group}>
                      <div className="navOptionsGroupHead">
                        <strong>{group}</strong>
                        <div className="navOptionsGroupMeta">
                          <span>{selectedInGroup}/{groupKeys.length}</span>
                          <button type="button" onClick={() => selectGroup(groupKeys, allSelected)}>{allSelected ? 'Clear' : 'Select all'}</button>
                        </div>
                      </div>
                      <div className="navOptionsGrid">
                        {items.map(({ key, label }) => {
                          const checked = draftItems.includes(key);
                          return (
                            <label key={key} className={'navOptionsChip' + (checked ? ' checked' : '')}>
                              <input type="checkbox" checked={checked} onChange={() => toggleItem(key)} />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="navOptionsFoot">
                <span className="navOptionsFootCount">{draftItems.length} option{draftItems.length === 1 ? '' : 's'} selected</span>
                <div className="actions">
                  <button type="button" className="btn" onClick={closeItems}>Cancel</button>
                  <button className="btn primary" disabled={busy} onClick={() => saveItems(activeTab)}>
                    {busy ? 'Saving…' : 'Save Options'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <form onSubmit={createTab} className="toolbar" style={{ marginTop: 18, alignItems: 'flex-end' }}>
        <div className="field">
          <label>New Tab Name</label>
          <input className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Loan Desk" required />
        </div>
        <div className="field">
          <label>Icon</label>
          <select value={newIcon} onChange={(e) => setNewIcon(e.target.value)}>
            {NAV_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : '+ New Tab'}</button>
      </form>
    </div>
  );
}

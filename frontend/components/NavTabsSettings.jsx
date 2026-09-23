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
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState(NAV_ICON_NAMES[0]);
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/admin/nav-tabs').then(setTabs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const createTab = (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    run(async () => {
      await post('/admin/nav-tabs', { label: newLabel.trim(), icon: newIcon, items: [] });
      setNewLabel(''); load();
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

  const openItems = (t) => { setOpenItemsFor(t.id); setDraftItems(t.items || []); };
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
                  <td>{(t.items || []).length} selected</td>
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

      {openItemsFor != null && (
        <div className="modal">
          <div className="modalbox" style={{ maxWidth: 640 }}>
            <h2>Choose Options for "{tabs.find((t) => t.id === openItemsFor)?.label}"</h2>
            <p className="muted">Select karein ki is tab mein kaunse submenu options dikhne hain.</p>
            <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 10 }}>
              {NAV_CATALOG.map(({ group, items }) => (
                <div key={group} style={{ marginTop: 14 }}>
                  <h4 style={{ marginBottom: 6 }}>{group}</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {items.map(({ key, label }) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={draftItems.includes(key)} onChange={() => toggleItem(key)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpenItemsFor(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => saveItems(tabs.find((t) => t.id === openItemsFor))}>
                {busy ? 'Saving…' : 'Save Options'}
              </button>
            </div>
          </div>
        </div>
      )}

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

'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { MENU, buildNavGroups, buildPermissionGroups } from '../lib/menu';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';

const DEPARTMENT_DEFAULT_MODULES = {
  Admin: MENU.Setup.flatMap(([k]) => [k]),
  Factory: ['production-voucher', 'production-register', 'closing-stock-premises', 'closing-stock-raw', 'stock-ledger-premises'],
  Billing: ['delivery-challan', 'billing-pending-sales', 'tax-invoice', 'sale-register', 'gst-register', 'hypothecation-register', 'payment-receivable-report', 'cash-at-dealer', 'ledger', 'ledger-v'],
  Cashier: ['expense-payment-voucher', 'day-book', 'ledger', 'ledger-v', 'payment-receivable-report'],
  Salesman: ['delivery-challan', 'tax-invoice', 'closing-stock-dealers', 'stock-ledger-dealers', 'sale-register', 'payment-receivable-report'],
  HR: ['hr-attendance'],
  FE: ['loan-workflow'],
  DO: ['loan-workflow'],
};

export function UserPage({ setActive, setOptionUserId }) {
  const [rows, setRows] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [assignedDealerIds, setAssignedDealerIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () =>
    get('/users')
      .then((d) => setRows(Array.isArray(d) ? d : (d.rows || d.users || d.data || [])))
      .catch((e) => setError(e.message));
  // /dealers returns { dealers: [...] }; keep User Master resilient to either response shape.
  useEffect(() => {
    load();
    get('/dealers').then((d) => setDealers(Array.isArray(d) ? d : (d.dealers || []))).catch(() => setDealers([]));
    get('/masters/salesman').then((d) => {
      // API { masters: [...] } / { rows: [...] } / plain array — teeno chalenge. Same naam (SHOWROOM/Showroom) ek hi baar.
      const list = Array.isArray(d) ? d : (d?.masters || d?.rows || d?.data || d?.salesmen || d?.items || []);
      const seen = new Set();
      setSalesmen((Array.isArray(list) ? list : []).filter((x) => {
        const k = String(x?.name || '').trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      }));
    }).catch(() => setSalesmen([]));
  }, []);

  const filteredRows = rows.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.username, u.is_super_user ? 'super user' : ''].join(' ').toLowerCase().includes(q);
  });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const payload = { ...form, id: editingId || undefined, assigned_dealer_ids: form.department === 'Salesman' ? assignedDealerIds : [] };
      if ((payload.department || '').toLowerCase() === 'salesman') {
        if (!payload.username) throw new Error('Salesman select karke Login ID set karein.');
      }
      await post('/users', payload);
      setOpen(false); setEditingId(null); setForm({}); load();
    });
  };

  const remove = (id) => {
    if (!confirm('Delete this user?')) return;
    run(async () => { await del(`/users/${id}`); load(); });
  };

  const createAllSalesmanLogins = () => {
    if (!salesmen.length) {
      setError('Salesman Master me koi salesman nahi mila.');
      return;
    }
    if (!confirm(`Existing Salesman Master ke ${salesmen.length} naam ke liye missing User logins create karein? Initial password: user@887`)) return;
    run(async () => {
      const existing = new Set(
        rows.map((u) => String(u.username || '').trim().toLowerCase()).filter(Boolean)
      );
      let created = 0;
      let skipped = 0;
      for (const s of salesmen) {
        const name = String(s.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        await post('/users', {
          username: name,
          password: 'user@887',
          department: 'Salesman',
          salesman_name: name,
          allowed_modules: DEPARTMENT_DEFAULT_MODULES.Salesman,
          is_super_user: false,
        });
        existing.add(key);
        created++;
      }
      await load();
      setError(`Salesman logins: ${created} created, ${skipped} already existed. Initial password: user@887`);
    });
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => { setEditingId(null); setForm({ department: 'Admin', allowed_modules: DEPARTMENT_DEFAULT_MODULES.Admin }); setAssignedDealerIds([]); setOpen(true); }}>+ Add User</button>
        <button className="btn" onClick={createAllSalesmanLogins}>Create All Salesman Logins</button>
        {rows.length > 0 && <><input className="input" placeholder="Search username…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />{search && <button className="btn" onClick={() => setSearch('')}>Clear</button>}</>}
      </div>
      <ErrorBanner message={!open ? error : ''} />
      {rows.length === 0 ? <EmptyState /> : filteredRows.length === 0 ? <EmptyState text="No users match your search." /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Username</th><th>Department</th><th>Dealers</th><th>Super User</th><th>Allowed Modules</th><th></th></tr></thead>
            <tbody>
              {filteredRows.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td><td>{u.department || 'Admin'}</td><td>{u.is_super_user ? 'All' : (u.assigned_dealer_ids?.length || 0)}</td><td>{u.is_super_user ? 'Yes' : 'No'}</td>
                  <td>{(u.is_super_user ? 'All' : ((Array.isArray(u.allowed_modules) ? u.allowed_modules : (u.allowed_modules ? String(u.allowed_modules).split(',').map((x) => x.trim()).filter(Boolean) : [])).length ? ((Array.isArray(u.allowed_modules) ? u.allowed_modules : String(u.allowed_modules).split(',').map((x) => x.trim()).filter(Boolean)).length + ' modules') : 'None set'))}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => { setEditingId(u.id); setForm({ ...u, password: '' }); setAssignedDealerIds(Array.isArray(u.assigned_dealer_ids) ? u.assigned_dealer_ids.map(Number) : []); setOpen(true); }}>Edit</button>
                    <button className="btn" onClick={() => { setOptionUserId(u.id); setActive('option-setting'); }}>Permissions</button>
                    <button className="btn danger" onClick={() => remove(u.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="modal">
          <form className="modalbox" onSubmit={save}>
            <h2>{editingId ? 'Edit User' : 'Add User'}</h2>
            <ErrorBanner message={error} />
            <div className="formgrid">
              {form.department === 'Salesman' && (
                <Field
                  label="Salesman Master"
                  type="select"
                  value={form.salesman_name || form.username || ''}
                  onChange={(v) => setForm({ ...form, salesman_name: v, username: v })}
                  options={salesmen.map((s) => ({ value: s.name, label: s.name }))}
                  required
                />
              )}
              <Field label="Login ID / Username" value={form.username} readOnly={form.department === 'Salesman' && !!form.salesman_name}
                     onChange={(v) => setForm({ ...form, username: v })} required />
              <Field label={editingId ? 'Password (blank = keep current)' : 'Password'} type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} required={!editingId} />
              <Field label="Department" type="select" value={form.department || 'Admin'} onChange={(v) => {
                const next = { ...form, department: v, allowed_modules: DEPARTMENT_DEFAULT_MODULES[v] || [] };
                if (v !== 'Salesman') { delete next.salesman_name; }
                setForm(next);
              }} options={['Admin','Factory','Billing','Cashier','Salesman','HR','FE','DO']} />
              <Field label="Super User (unrestricted access)" type="checkbox" value={form.is_super_user}
                     onChange={(v) => setForm({ ...form, is_super_user: v })} />
              <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
                Department selection gives default module access. Super User always has full access. For Salesman users, dealer access comes automatically from Dealer Master → Salesman.
              </div>
              {form.department === 'Salesman' ? (
                <div className="card" style={{ gridColumn: '1 / -1', padding: 12 }}>
                  <b>Salesman Dealer Assignment</b>
                  <div className="muted" style={{ marginTop: 6 }}>
                    Select the dealers this Salesman is allowed to access. Backend/API also enforces this restriction.
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8,marginTop:12,maxHeight:220,overflow:'auto'}}>
                    {dealers.map(d => { const on=assignedDealerIds.includes(Number(d.id)); return <label key={d.id} className="card" style={{padding:9,display:'flex',gap:8,alignItems:'center',cursor:'pointer'}}><input type="checkbox" checked={on} onChange={()=>setAssignedDealerIds(v=>on?v.filter(x=>x!==Number(d.id)):[...v,Number(d.id)])}/><span>{d.name} {d.code ? `(${d.code})` : ''}</span></label>; })}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function OptionSettingPage({ userId }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [actionPerms, setActionPerms] = useState({});
  // Permission groups = sidebar groups (same names, same sub-options) - admin ke saved tabs ke saath.
  const [customTabs, setCustomTabs] = useState(null);
  useEffect(() => { get('/nav-config').then((d) => setCustomTabs(d?.custom ? d.tabs : null)).catch(() => setCustomTabs(null)); }, []);
  const permGroups = buildPermissionGroups(buildNavGroups(customTabs).groups);
  const permKeys = [...new Set(Object.values(permGroups).flatMap(items => items.map(([k]) => k)))];
  const labelByKey = {}; Object.values(permGroups).flat().forEach(([k, l]) => { if (!labelByKey[k]) labelByKey[k] = l; });
  const ACTION_KEYS = ['view','create','edit','delete','approve','download'];
  const rightsFor = (key) => key === 'backup-restore' ? [...ACTION_KEYS, 'backup'] : ACTION_KEYS;
  const rowOn = (key) => rightsFor(key).every(a => !!(actionPerms[key] || {})[a]);
  const setRow = (key, val) => setActionPerms(m => ({ ...m, [key]: { ...(m[key] || {}), ...Object.fromEntries(rightsFor(key).map(a => [a, val])) } }));
  const allMenuKeys = permKeys.filter(k => selected.includes(k));
  const allRowsOn = allMenuKeys.length > 0 && allMenuKeys.every(rowOn);
  const setAllRows = (val) => setActionPerms(m => { const n = { ...m }; allMenuKeys.forEach(k => { n[k] = { ...(n[k] || {}), ...Object.fromEntries(rightsFor(k).map(a => [a, val])) }; }); return n; });
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => {
    if (!userId) return;
    get(`/users/${userId}/option-setting`).then((d) => {
      // Purana/naya dono response chalega: user object na aaye to bhi page crash nahi hoga.
      const user = d?.user || { id: userId, username: '', is_super_user: false };
      const keys = Array.isArray(d?.selected_keys) ? d.selected_keys : (Array.isArray(d?.modules) ? d.modules : []);
      setData({ ...d, user });
      get(`/users/${userId}/action-permissions`).then(x => { const map={}; (x.permissions||x.rows||[]).forEach(r=>{map[r.module_key]={view:!!r.can_view,create:!!r.can_create,edit:!!r.can_edit,delete:!!r.can_delete,approve:!!r.can_approve,download:!!r.can_download,backup:!!r.can_backup};}); setActionPerms(map); }).catch(()=>{});
      // Kuch set na ho to us department ke default modules dikhao (Save karne par hi lagu honge).
      const defaults = DEPARTMENT_DEFAULT_MODULES[user.department] || [];
      setSelected(keys.length ? keys : defaults);
    }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [userId]);

  if (!userId) return <div className="card">Open this from User Master → "Permissions" for a specific user.</div>;
  if (!data) return (
    <div className="card">
      {error ? (
        <>
          <b>User load failed</b>
          <div style={{ marginTop: 8, color: '#c0392b' }}>{error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </>
      ) : 'Loading…'}
    </div>
  );

  const toggle = (key) => {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  };

  const toggleGroup = (items, allOn) => {
    const keys = items.map(([k]) => k);
    setSelected((s) => allOn ? s.filter((k) => !keys.includes(k)) : Array.from(new Set([...s, ...keys])));
  };

  const save = () => run(async () => { await post(`/users/${userId}/option-setting`, { modules: selected }); await post(`/users/${userId}/action-permissions`, { permissions: Object.entries(actionPerms).filter(([module_key]) => selected.includes(module_key)).map(([module_key,v]) => ({module_key,can_view:!!v.view,can_create:!!v.create,can_edit:!!v.edit,can_delete:!!v.delete,can_approve:!!v.approve,can_download:!!v.download,can_backup:!!v.backup})) }); });

  const totalModules = permKeys.length;

  return (
    <div className="permCard">
      <style jsx>{`
        .permCard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 2px 10px #00000008}
        .permHead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--line)}
        .permHead h2{margin:0;font-size:19px}
        .permHead p{margin:4px 0 0;color:var(--muted);font-size:12px}
        .permProgress{font-size:12px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--card));border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:999px;padding:6px 14px;white-space:nowrap}
        .permGroup{border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:14px;background:var(--strip-bg)}
        .permGroupHead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
        .permGroupHead h4{margin:0;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink)}
        .permGroupMeta{display:flex;align-items:center;gap:10px}
        .permGroupMeta span{font-size:11px;color:var(--muted)}
        .permGroupToggle{border:1px solid var(--line);background:var(--card);color:var(--accent);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700}
        .permGroupToggle:hover{border-color:var(--accent)}
        .permGrid{display:flex;flex-wrap:wrap;gap:8px}
        .permChip{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.12s}
        .permChip:hover{border-color:var(--accent)}
        .permChip.on{background:color-mix(in srgb,var(--accent) 12%,var(--card));border-color:var(--accent);color:var(--accent)}
        .permCheckbox{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;flex:none;font-size:10px;font-weight:900;color:#fff}
        .permChip.on .permCheckbox{background:var(--accent);border-color:var(--accent)}
        .permFooter{position:sticky;bottom:0;background:var(--card);padding-top:16px;margin-top:6px;display:flex;justify-content:flex-end;gap:10px}
        @media(max-width:700px){.permCard{padding:16px}.permHead{flex-direction:column;align-items:flex-start}}
      `}</style>
      <div className="permHead">
        <div>
          <h2>Module Access — {data.user?.username || '—'}{data.user?.department ? ` (${data.user.department})` : ''}</h2>
          <p>Choose exactly what this user can open. Changes apply after you save.</p>
        </div>
        <div className="permProgress">{selected.length} / {totalModules} enabled</div>
      </div>
      <ErrorBanner message={error} />
      {data.user?.is_super_user ? (
        <p className="muted">This is a Super User — they always have access to every module regardless of this setting.</p>
      ) : (
        <>
          {Object.entries(permGroups).map(([group, items]) => {
            const groupKeys = items.map(([k]) => k);
            const onCount = groupKeys.filter((k) => selected.includes(k)).length;
            const allOn = onCount === groupKeys.length;
            return (
              <div key={group} className="permGroup">
                <div className="permGroupHead">
                  <h4>{group}</h4>
                  <div className="permGroupMeta">
                    <span>{onCount}/{groupKeys.length}</span>
                    <button type="button" className="permGroupToggle" onClick={() => toggleGroup(items, allOn)}>{allOn ? 'Clear all' : 'Select all'}</button>
                  </div>
                </div>
                <div className="permGrid">
                  {items.map(([key, label]) => {
                    const on = selected.includes(key);
                    return (
                      <button type="button" key={key} className={'permChip' + (on ? ' on' : '')} onClick={() => toggle(key)}>
                        <span className="permCheckbox">{on ? '✓' : ''}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="permGroup">
            <div className="permGroupHead"><h4>Action Rights</h4><div className="permGroupMeta"><span>View / Create / Edit / Delete / Approve / Download / Backup</span></div></div>
            <div className="tablewrap">
              <table className="table"><thead><tr><th>Module</th><th>View</th><th>Create</th><th>Edit</th><th>Delete</th><th>Approve</th><th>Download</th><th>Backup</th><th style={{textAlign:'center'}}><label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}><input type="checkbox" checked={allRowsOn} onChange={e=>setAllRows(e.target.checked)}/> Select All</label></th></tr></thead><tbody>
                {allMenuKeys.map((key)=>{ const label=labelByKey[key]; const v=actionPerms[key]||{}; const set=(a,val)=>setActionPerms(m=>({...m,[key]:{...(m[key]||{}),[a]:val}})); return <tr key={key}><td>{label}</td>{['view','create','edit','delete','approve','download'].map(a=><td key={a}><input type="checkbox" checked={!!v[a]} onChange={e=>set(a,e.target.checked)}/></td>)}<td>{key==='backup-restore'?<input type="checkbox" checked={!!v.backup} onChange={e=>set('backup',e.target.checked)}/>:<span className="muted">—</span>}</td><td style={{textAlign:'center'}}><input type="checkbox" title="Select all rights for this module" checked={rowOn(key)} onChange={e=>setRow(key,e.target.checked)}/></td></tr>; })}
              </tbody></table>
              {allMenuKeys.length === 0 && <p className="muted" style={{ padding: 12 }}>Upar se module select karein — unke action rights yahan dikhenge.</p>}
            </div>
          </div>
          <div className="permFooter">
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save Permissions'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function PasswordPage() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { busy, error, run } = useAsyncAction();
  const [done, setDone] = useState(false);

  useEffect(() => {
    get('/users')
      .then((d) => setUsers(Array.isArray(d) ? d : (d.rows || d.users || d.data || [])))
      .catch(() => {});
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setDone(false);
    run(async () => {
      await post(`/users/${userId}/password`, { new_password: newPassword, confirm_password: confirmPassword });
      setNewPassword(''); setConfirmPassword(''); setDone(true);
    });
  };

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <b>Reset Password</b>
      <ErrorBanner message={error} />
      {done && <div className="muted" style={{ margin: '10px 0' }}>Password updated.</div>}
      <form onSubmit={submit}>
        <div className="field" style={{ marginTop: 12 }}>
          <label>User</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Select user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>New Password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </div>
        <button className="btn primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? 'Saving…' : 'Update Password'}</button>
      </form>
    </div>
  );
}

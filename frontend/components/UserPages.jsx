'use client';
import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api';
import { MENU } from '../lib/menu';
import { Field, ErrorBanner, EmptyState, useAsyncAction } from './ui';

const DEPARTMENT_DEFAULT_MODULES = {
  Admin: MENU.Setup.flatMap(([k]) => [k]),
  Factory: ['production-voucher', 'production-register', 'closing-stock-premises', 'closing-stock-raw', 'stock-ledger-premises'],
  Billing: ['delivery-challan', 'billing-pending-sales', 'tax-invoice', 'sale-register', 'gst-register', 'hypothecation-register', 'payment-receivable-report', 'cash-at-dealer', 'ledger', 'ledger-v'],
  Cashier: ['expense-payment-voucher', 'day-book', 'ledger', 'ledger-v', 'payment-receivable-report'],
  Salesman: ['delivery-challan', 'tax-invoice', 'closing-stock-dealers', 'stock-ledger-dealers', 'sale-register', 'payment-receivable-report'],
  HR: ['hr-attendance'],
};

export function UserPage({ setActive, setOptionUserId }) {
  const [rows, setRows] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/users').then(setRows).catch((e) => setError(e.message));
  // /dealers returns { dealers: [...] }; keep User Master resilient to either response shape.
  useEffect(() => {
    load();
    get('/dealers').then((d) => setDealers(Array.isArray(d) ? d : (d.dealers || []))).catch(() => setDealers([]));
    get('/masters/salesman').then((d) => setSalesmen(Array.isArray(d) ? d : [])).catch(() => setSalesmen([]));
  }, []);

  const filteredRows = rows.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.username, u.is_super_user ? 'super user' : ''].join(' ').toLowerCase().includes(q);
  });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const payload = { ...form, id: editingId || undefined };
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

  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => { setEditingId(null); setForm({ department: 'Admin', allowed_modules: DEPARTMENT_DEFAULT_MODULES.Admin }); setOpen(true); }}>+ Add User</button>
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
                  <td>{u.is_super_user ? 'All' : (u.allowed_modules.length ? u.allowed_modules.length + ' modules' : 'None set')}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => { setEditingId(u.id); setForm({ ...u, password: '' }); setOpen(true); }}>Edit</button>
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
              }} options={['Admin','Factory','Billing','Cashier','Salesman','HR']} />
              <Field label="Super User (unrestricted access)" type="checkbox" value={form.is_super_user}
                     onChange={(v) => setForm({ ...form, is_super_user: v })} />
              <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
                Department selection gives default module access. Super User always has full access. For Salesman users, dealer access comes automatically from Dealer Master → Salesman.
              </div>
              {form.department === 'Salesman' ? (
                <div className="card" style={{ gridColumn: '1 / -1', padding: 12 }}>
                  <b>Salesman Dealer Assignment</b>
                  <div className="muted" style={{ marginTop: 6 }}>
                    Dealers are assigned automatically from Dealer Master → Salesman. You do not need to select dealers here.
                    When a new dealer is created with this salesman, it is automatically included in this login.
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
  const { busy, error, setError, run } = useAsyncAction();

  useEffect(() => {
    if (!userId) return;
    get(`/users/${userId}/option-setting`).then((d) => { setData(d); setSelected(d.selected_keys); })
      .catch((e) => setError(e.message));
  }, [userId]);

  if (!userId) return <div className="card">Open this from User Master → "Permissions" for a specific user.</div>;
  if (!data) return <div className="card">Loading…</div>;

  const toggle = (key) => {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  };

  const save = () => run(async () => { await post(`/users/${userId}/option-setting`, { modules: selected }); });

  return (
    <div className="card">
      <b>Module Access for {data.user.username}</b>
      <ErrorBanner message={error} />
      {data.user.is_super_user ? (
        <p className="muted">This is a Super User — they always have access to every module regardless of this setting.</p>
      ) : (
        <>
          {Object.entries(MENU).map(([group, items]) => (
            <div key={group} style={{ marginTop: 14 }}>
              <h4 style={{ marginBottom: 6 }}>{group}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {items.map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 18 }} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save Permissions'}
          </button>
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

  useEffect(() => { get('/users').then(setUsers).catch(() => {}); }, []);

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

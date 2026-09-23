'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { Field, ErrorBanner, useAsyncAction } from './ui';

export function ProfilePage({ user }) {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwdSaved, setPwdSaved] = useState(false);
  const pwdAction = useAsyncAction();
  useEffect(() => { get('/auth/me').then((d) => setForm({ ...d, ...user })).catch(() => setForm(user || {})); }, []);
  const save = (e) => { e.preventDefault(); setSaved(false); run(async () => { await post('/auth/profile', { full_name: form.full_name || '', mobile: form.mobile || '', email: form.email || '', address: form.address || '', date_of_birth: form.date_of_birth || '' }); setSaved(true); }); };
  const changePassword = (e) => { e.preventDefault(); setPwdSaved(false); if (pwd.new_password && pwd.new_password !== pwd.confirm_password) { pwdAction.setError('New password and confirm password do not match.'); return; } pwdAction.run(async () => { await post('/auth/change-password', pwd); setPwd({ current_password: '', new_password: '', confirm_password: '' }); setPwdSaved(true); }); };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
    <div className="card"><b>My Profile</b><p className="muted" style={{ marginTop: 4 }}>Apni details yahan fill / update karein.</p><ErrorBanner message={error} />{saved && <div className="muted" style={{ margin: '10px 0' }}>Profile updated.</div>}<form onSubmit={save}><div className="formgrid" style={{ marginTop: 12 }}><Field label="Username" value={form.username} onChange={() => {}} readOnly /><Field label="Full Name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} /><Field label="Mobile No." value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} /><Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} /><Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => setForm({ ...form, date_of_birth: v })} /><Field label="Address" type="textarea" value={form.address} onChange={(v) => setForm({ ...form, address: v })} /></div><div className="actions" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Profile'}</button></div></form></div>
    <div className="card"><b>Change Password</b><ErrorBanner message={pwdAction.error} />{pwdSaved && <div className="muted" style={{ margin: '10px 0' }}>Password updated.</div>}<form onSubmit={changePassword}><div className="formgrid" style={{ marginTop: 12 }}><Field label="Current Password" type="password" value={pwd.current_password} onChange={(v) => setPwd({ ...pwd, current_password: v })} required /><Field label="New Password" type="password" value={pwd.new_password} onChange={(v) => setPwd({ ...pwd, new_password: v })} required /><Field label="Confirm New Password" type="password" value={pwd.confirm_password} onChange={(v) => setPwd({ ...pwd, confirm_password: v })} required /></div><div className="actions" style={{ marginTop: 16 }}><button className="btn primary" disabled={pwdAction.busy}>{pwdAction.busy ? 'Saving…' : 'Update Password'}</button></div></form></div>
  </div>;
}

'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const emptyProfile = {
  username: '',
  full_name: '',
  mobile: '',
  email: '',
  date_of_birth: '',
  address: '',
};

export function ProfilePage({ user }) {
  const [form, setForm] = useState({ ...emptyProfile, ...(user || {}) });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [pinForm, setPinForm] = useState({ current_password: '', pin: '', confirm_pin: '' });
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMessage, setPinMessage] = useState('');
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    let mounted = true;
    get('/auth/me')
      .then((data) => {
        if (!mounted) return;
        setForm({ ...emptyProfile, ...(data || {}), ...(user || {}) });
        setHasPin(Boolean((data?.user || data)?.has_pin));
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      await post('/auth/profile', {
        full_name: form.full_name || '',
        mobile: form.mobile || '',
        email: form.email || '',
        address: form.address || '',
        date_of_birth: form.date_of_birth || '',
      });
      setMessage('Profile updated successfully.');
    } catch (err) {
      setError(err?.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPasswordMessage(''); setPasswordError('');
    if (password.new_password !== password.confirm_password) {
      setPasswordError('New password and confirm password do not match.');
      return;
    }
    setPasswordSaving(true);
    try {
      await post('/auth/change-password', password);
      setPassword({ current_password: '', new_password: '', confirm_password: '' });
      setPasswordMessage('Password updated successfully.');
    } catch (err) {
      setPasswordError(err?.message || 'Could not change password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const savePin = async (e) => {
    e.preventDefault();
    setPinMessage(''); setPinError('');
    if (pinForm.pin !== pinForm.confirm_pin) { setPinError('PIN aur Confirm PIN match nahi kar rahe.'); return; }
    setPinSaving(true);
    try {
      await post('/auth/set-pin', pinForm);
      setPinForm({ current_password: '', pin: '', confirm_pin: '' });
      setHasPin(true);
      setPinMessage('PIN saved. Agle login par yahi PIN poocha jayega.');
    } catch (err) {
      setPinError(err?.message || 'Could not save PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  const input = (label, key, type = 'text', extra = {}) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        {...extra}
        type={type}
        value={form[key] ?? ''}
        onChange={(e) => setField(key, e.target.value)}
      />
    </label>
  );

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>My Profile</h2>
        <p className="muted">Apni personal details fill / update karein.</p>
        {error && <div className="error">{error}</div>}
        {message && <div className="card" style={{ marginBottom: 12 }}>{message}</div>}
        <form onSubmit={saveProfile}>
          <div className="formgrid">
            <label className="field"><span>Username</span><input value={form.username ?? ''} readOnly /></label>
            {input('Full Name', 'full_name')}
            {input('Mobile No.', 'mobile')}
            {input('Email', 'email', 'email')}
            {input('Date of Birth', 'date_of_birth', 'date')}
            <label className="field"><span>Address</span><textarea value={form.address ?? ''} onChange={(e) => setField('address', e.target.value)} rows={3} /></label>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Change Password</h2>
        {passwordError && <div className="error">{passwordError}</div>}
        {passwordMessage && <div className="card" style={{ marginBottom: 12 }}>{passwordMessage}</div>}
        <form onSubmit={changePassword}>
          <div className="formgrid">
            <label className="field"><span>Current Password</span><input type="password" required value={password.current_password} onChange={(e) => setPassword({ ...password, current_password: e.target.value })} /></label>
            <label className="field"><span>New Password</span><input type="password" required value={password.new_password} onChange={(e) => setPassword({ ...password, new_password: e.target.value })} /></label>
            <label className="field"><span>Confirm New Password</span><input type="password" required value={password.confirm_password} onChange={(e) => setPassword({ ...password, confirm_password: e.target.value })} /></label>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={passwordSaving}>{passwordSaving ? 'Updating…' : 'Update Password'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Login PIN</h2>
        <p className="muted">{hasPin ? 'PIN set hai. Naya PIN daal kar change kar sakte hain.' : 'PIN set nahi hai. PIN set karne par login ke baad yahi PIN poocha jayega.'}</p>
        {pinError && <div className="error">{pinError}</div>}
        {pinMessage && <div className="card" style={{ marginBottom: 12 }}>{pinMessage}</div>}
        <form onSubmit={savePin}>
          <div className="formgrid">
            <label className="field"><span>Current Password</span><input type="password" required value={pinForm.current_password} onChange={(e) => setPinForm({ ...pinForm, current_password: e.target.value })} /></label>
            <label className="field"><span>{hasPin ? 'New PIN (4 digit)' : 'PIN (4 digit)'}</span><input type="password" inputMode="numeric" maxLength={4} required value={pinForm.pin} onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
            <label className="field"><span>Confirm PIN</span><input type="password" inputMode="numeric" maxLength={4} required value={pinForm.confirm_pin} onChange={(e) => setPinForm({ ...pinForm, confirm_pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={pinSaving || pinForm.pin.length !== 4}>{pinSaving ? 'Saving…' : hasPin ? 'Change PIN' : 'Set PIN'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

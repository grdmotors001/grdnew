'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

// Theme-aware inline styles (use the CSS variables set by lib/theme.js so the
// pages stay readable in every theme, including "Midnight dark").
const S = {
  wrap: { maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 },
  card: { background: 'var(--card, #fff)', color: 'var(--ink, #172b45)', border: '1px solid var(--line, #e4e9ef)', borderRadius: 14, padding: 18 },
  h: { margin: '0 0 4px', fontSize: 18, color: 'var(--ink, #172b45)' },
  sub: { margin: '0 0 14px', fontSize: 12, color: 'var(--muted, #748297)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--muted, #748297)' },
  input: { padding: '9px 10px', borderRadius: 8, border: '1px solid var(--line, #cfd8e3)', background: 'var(--input-bg, #fff)', color: 'var(--ink, #172b45)', fontSize: 14, fontWeight: 400, width: '100%', boxSizing: 'border-box' },
  ro: { opacity: 0.75, cursor: 'not-allowed' },
  ok: { padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: 'rgba(34,160,90,.15)', color: 'var(--ink, #172b45)', border: '1px solid rgba(34,160,90,.45)' },
  err: { padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: 'rgba(220,53,69,.15)', color: 'var(--ink, #172b45)', border: '1px solid rgba(220,53,69,.45)' },
  btn: { marginTop: 16 },
};

const EMPTY = { username: '', full_name: '', mobile: '', email: '', date_of_birth: '', address: '' };

function Row({ label, children }) {
  return <label style={S.label}><span>{label}</span>{children}</label>;
}

export function DealerProfilePage({ dealer }) {
  return (
    <div style={S.wrap}>
      <DealerProfileForm dealer={dealer} />
      <DealerPasswordCard />
      <DealerPinCard />
    </div>
  );
}

function DealerProfileForm({ dealer }) {
  const [form, setForm] = useState({ ...EMPTY });
  const [kind, setKind] = useState(dealer?.is_salesman ? 'salesman' : 'dealer');
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    get('/dealer/profile')
      .then((r) => {
        if (!alive) return;
        const p = r?.profile || r || {};
        setForm({ ...EMPTY, ...p, date_of_birth: String(p.date_of_birth || '').slice(0, 10) });
        setKind(p.kind || kind);
        setEditable(Boolean(p.editable));
      })
      .catch((e) => alive && setError(e?.message || 'Could not load profile.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      await post('/dealer/profile', editable ? {
        full_name: form.full_name || '', mobile: form.mobile || '', email: form.email || '',
        address: form.address || '', date_of_birth: form.date_of_birth || '',
      } : { address: form.address || '', date_of_birth: form.date_of_birth || '' });
      setMessage('Profile updated successfully.');
    } catch (err) {
      setError(err?.message || 'Could not update profile.');
    } finally { setSaving(false); }
  };

  const ro = (v) => ({ style: { ...S.input, ...S.ro }, value: v ?? '', readOnly: true });
  const inp = (k, type = 'text', force = false) => { const can = editable || force; return { style: { ...S.input, ...(can ? null : S.ro) }, type, value: form[k] ?? '', onChange: set(k), readOnly: !can }; };

  return (
    <>
      <div style={S.card}>
        <h2 style={S.h}>My Profile</h2>
        <p style={S.sub}>{kind === 'salesman' ? 'Update your personal details.' : 'Dealer details are managed by the office. Contact admin to change them.'}</p>
        {error && <div style={S.err}>{error}</div>}
        {message && <div style={S.ok}>{message}</div>}
        <form onSubmit={save}>
          <div style={S.grid}>
            <Row label="Login ID"><input {...ro(form.username || form.login_id)} style={{ ...S.input, ...S.ro }} /></Row>
            {kind === 'salesman' ? (
              <>
                <Row label="Full Name"><input {...inp('full_name')} /></Row>
                <Row label="Mobile No."><input {...inp('mobile')} /></Row>
                <Row label="Email"><input {...inp('email', 'email')} /></Row>
                <Row label="Date of Birth"><input {...inp('date_of_birth', 'date')} /></Row>
                <Row label="Address"><textarea rows={3} {...inp('address')} /></Row>
              </>
            ) : (
              <>
                <Row label="Dealer Code"><input {...ro(form.code)} style={{ ...S.input, ...S.ro }} /></Row>
                <Row label="Dealer Name"><input {...ro(form.name)} style={{ ...S.input, ...S.ro }} /></Row>
                <Row label="Category"><input {...ro(form.dealer_category)} style={{ ...S.input, ...S.ro }} /></Row>
                {form.mobile ? <Row label="Mobile No."><input {...ro(form.mobile)} style={{ ...S.input, ...S.ro }} /></Row> : null}
                {form.email ? <Row label="Email"><input {...ro(form.email)} style={{ ...S.input, ...S.ro }} /></Row> : null}
                <Row label="Date of Birth"><input {...inp('date_of_birth', 'date', true)} /></Row>
                <Row label="Address"><textarea rows={3} {...inp('address', 'text', true)} /></Row>
              </>
            )}
          </div>
          <button className="btn primary" style={S.btn} disabled={loading || saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
        </form>
      </div>
    </>
  );
}

export function DealerPasswordPage() {
  return <div style={S.wrap}><DealerPasswordCard /></div>;
}

function DealerPasswordCard() {
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    if (pw.new_password !== pw.confirm_password) { setError('New password and confirm password do not match.'); return; }
    if (pw.new_password.length < 4) { setError('New password must be at least 4 characters.'); return; }
    setSaving(true);
    try {
      await post('/dealer/change-password', pw);
      setPw({ current_password: '', new_password: '', confirm_password: '' });
      setMessage('Password updated successfully.');
    } catch (err) {
      setError(err?.message || 'Could not change password.');
    } finally { setSaving(false); }
  };

  const f = (k) => ({ type: 'password', required: true, style: S.input, autoComplete: k === 'current_password' ? 'current-password' : 'new-password', value: pw[k], onChange: (e) => setPw({ ...pw, [k]: e.target.value }) });

  return (
    <>
      <div style={S.card}>
        <h2 style={S.h}>Change Password</h2>
        <p style={S.sub}>Enter your current password, then choose a new one.</p>
        {error && <div style={S.err}>{error}</div>}
        {message && <div style={S.ok}>{message}</div>}
        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Row label="Current Password"><input {...f('current_password')} /></Row>
            <Row label="New Password"><input {...f('new_password')} /></Row>
            <Row label="Confirm New Password"><input {...f('confirm_password')} /></Row>
          </div>
          <button className="btn primary" style={S.btn} disabled={saving}>{saving ? 'Updating…' : 'Update Password'}</button>
        </form>
      </div>
    </>
  );
}


// Dealer ka Login PIN: login ke baad password ke saath ye 4 digit PIN poocha jata hai (staff jaisa).
function DealerPinCard() {
  const [hasPin, setHasPin] = useState(false);
  const [form, setForm] = useState({ current_password: '', pin: '', confirm_pin: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    get('/dealer/profile').then((r) => { if (alive) setHasPin(Boolean((r?.profile || r || {}).has_pin)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const digits = (v) => v.replace(/\D/g, '').slice(0, 4);
  const save = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    if (form.pin !== form.confirm_pin) { setError('PIN aur Confirm PIN match nahi kar rahe.'); return; }
    setSaving(true);
    try {
      await post('/auth/set-pin', form);
      setForm({ current_password: '', pin: '', confirm_pin: '' });
      setHasPin(true);
      setMessage('PIN saved. Agle login par yahi PIN poocha jayega.');
    } catch (err) {
      setError(err?.message || 'Could not save PIN.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.card}>
      <h3 style={S.h}>Login PIN</h3>
      <p style={S.sub}>{hasPin ? 'PIN set hai. Naya PIN daal kar change kar sakte hain.' : 'PIN set nahi hai. PIN set karne par login ke baad yahi PIN poocha jayega.'}</p>
      {error && <div style={S.err}>{error}</div>}
      {message && <div style={S.ok}>{message}</div>}
      <form onSubmit={save}>
        <div style={S.grid}>
          <Row label="Current Password"><input type="password" required autoComplete="current-password" style={S.input} value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} /></Row>
          <Row label={hasPin ? 'New PIN (4 digit)' : 'PIN (4 digit)'}><input type="password" inputMode="numeric" maxLength={4} required autoComplete="off" style={S.input} value={form.pin} onChange={(e) => setForm({ ...form, pin: digits(e.target.value) })} /></Row>
          <Row label="Confirm PIN"><input type="password" inputMode="numeric" maxLength={4} required autoComplete="off" style={S.input} value={form.confirm_pin} onChange={(e) => setForm({ ...form, confirm_pin: digits(e.target.value) })} /></Row>
        </div>
        <button className="btn primary" style={S.btn} disabled={saving || form.pin.length !== 4}>{saving ? 'Saving…' : hasPin ? 'Change PIN' : 'Set PIN'}</button>
      </form>
    </div>
  );
}

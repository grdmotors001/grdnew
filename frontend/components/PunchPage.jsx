'use client';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api';

// Outlet Punch In / Punch Out: selfie + GPS. Server outlet ke radius ki jaanch karta hai.
const timeIST = (v) => { if (!v) return '-'; const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Is phone/browser me location support nahi hai.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission band hai. Browser/phone settings me Location allow karein.' : 'Location nahi mil saki. GPS on karke dobara try karein.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

export function PunchPage() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(''); // 'in' | 'out' => camera khula hai
  const [camErr, setCamErr] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const load = () => get('/hr/punch-status', { noClientCache: true }).then(setSt).catch((e) => setError(e.message || 'Status load nahi hua.'));
  useEffect(() => { load(); return () => stopCam(); }, []);

  const stopCam = () => { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; } };

  const openCam = async (a) => {
    setError(''); setNotice(''); setCamErr(''); setAction(a);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 50);
    } catch (e) {
      setCamErr('Camera nahi khul paya. Browser me Camera allow karein.');
    }
  };
  const cancel = () => { stopCam(); setAction(''); setCamErr(''); };

  const submit = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setError('Camera abhi ready nahi hai, ek second ruk kar dobara dabayein.'); return; }
    setBusy(true); setError('');
    try {
      const pos = await getPosition();
      const w = 320, h = Math.round((v.videoHeight / v.videoWidth) * w);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      const selfie = c.toDataURL('image/jpeg', 0.6);
      const r = await post('/hr/punch', { action, ...pos, selfie });
      setNotice((action === 'in' ? 'Punch In ho gaya' : 'Punch Out ho gaya') + ' (outlet se ' + r.distance_m + ' m door).');
      stopCam(); setAction('');
      await load();
    } catch (e) {
      setError(e.message || 'Punch nahi ho saka.');
    } finally { setBusy(false); }
  };

  const today = st?.today;
  const punchedIn = !!today?.first_in;
  const punchedOut = !!today?.last_out && !today?.single_punch;

  return <div className="page">
    <div className="pageHeader"><div><h2>Punch In / Out</h2><p className="muted">Outlet par aakar selfie ke saath punch karein. Location outlet ke paas honi chahiye.</p></div></div>
    {error && !action && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div className="card" style={{ marginBottom: 12 }}>{notice}</div>}
    {st && !st.linked && <div className="card">Aapka login kisi employee se juda nahi hai. Admin se HR &gt; Employees me link karwayein.</div>}
    {st?.linked && !st.outlet && <div className="card" style={{ maxWidth: 460 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{st.employee.name}</div>
      <div className="muted" style={{ marginTop: 6 }}>Is app se Punch In/Out sirf outlet wale employees ke liye hai. Aapki Location ({st.employee.location || 'set nahi'}) kisi outlet se match nahi karti, isliye yahan se punch nahi ho sakta. Zarurat ho to admin se HR &gt; Employees me Location outlet ke naam par set karwayein.</div>
    </div>}
    {st?.linked && st.outlet && <div className="card" style={{ maxWidth: 460 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{st.employee.name}</div>
      <div className="muted">Outlet: {st.outlet ? st.outlet.name : (st.employee.location || 'set nahi')}{st.outlet && !st.outlet.has_location ? ' (location abhi admin ne set nahi ki)' : ''}</div>
      <div style={{ margin: '14px 0' }}>
        <div>Aaj Punch In: <strong>{timeIST(today?.first_in)}</strong></div>
        <div>Aaj Punch Out: <strong>{punchedOut ? timeIST(today?.last_out) : '-'}</strong></div>
      </div>
      {!action && <div className="actions">
        <button className="btn primary" disabled={busy || punchedIn || !st.outlet.has_location} onClick={() => openCam('in')}>Punch In</button>
        <button className="btn" disabled={busy || !punchedIn || punchedOut || !st.outlet.has_location} onClick={() => openCam('out')}>Punch Out</button>
      </div>}
      {action && <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#000', display: 'flex', flexDirection: 'column' }}>
        <div style={{ color: '#fff', padding: 'max(12px, env(safe-area-inset-top)) 16px 10px', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{action === 'in' ? 'Punch In' : 'Punch Out'}</div>
          <div style={{ fontSize: 13, opacity: .8, marginTop: 2 }}>Apna chehra camera me dikhayein, phir Take Selfie dabayein.</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px' }}>
          {camErr
            ? <div className="error" style={{ margin: 0 }}>{camErr}</div>
            : <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14, background: '#000', transform: 'scaleX(-1)' }} />}
        </div>
        {error && <div className="error" style={{ margin: '10px 12px 0' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px max(16px, env(safe-area-inset-bottom))' }}>
          <button className="btn" style={{ flex: 1, padding: '14px 0', fontSize: 16 }} disabled={busy} onClick={cancel}>Cancel</button>
          <button className="btn primary" style={{ flex: 2, padding: '14px 0', fontSize: 17, fontWeight: 800 }} disabled={busy || !!camErr} onClick={submit}>{busy ? 'Ho raha hai…' : 'Take Selfie'}</button>
        </div>
      </div>}
    </div>}
  </div>;
}

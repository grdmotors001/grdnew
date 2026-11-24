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
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div className="card" style={{ marginBottom: 12 }}>{notice}</div>}
    {st && !st.linked && <div className="card">Aapka login kisi employee se juda nahi hai. Admin se HR &gt; Employees me link karwayein.</div>}
    {st?.linked && <div className="card" style={{ maxWidth: 460 }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{st.employee.name}</div>
      <div className="muted">Outlet: {st.outlet ? st.outlet.name : (st.employee.location || 'set nahi')}{st.outlet && !st.outlet.has_location ? ' (location abhi admin ne set nahi ki)' : ''}</div>
      <div style={{ margin: '14px 0' }}>
        <div>Aaj Punch In: <strong>{timeIST(today?.first_in)}</strong></div>
        <div>Aaj Punch Out: <strong>{punchedOut ? timeIST(today?.last_out) : '-'}</strong></div>
      </div>
      {!action && <div className="actions">
        <button className="btn primary" disabled={busy || punchedIn} onClick={() => openCam('in')}>Punch In</button>
        <button className="btn" disabled={busy || !punchedIn || punchedOut} onClick={() => openCam('out')}>Punch Out</button>
      </div>}
      {action && <div>
        <div className="muted" style={{ marginBottom: 6 }}>{action === 'in' ? 'Punch In' : 'Punch Out'}: apna chehra camera me dikhayein, phir "Photo lekar Punch" dabayein.</div>
        {camErr ? <div className="error">{camErr}</div> : <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000', transform: 'scaleX(-1)' }} />}
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || !!camErr} onClick={submit}>{busy ? 'Ho raha hai…' : 'Photo lekar Punch'}</button>
          <button className="btn" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      </div>}
    </div>}
  </div>;
}

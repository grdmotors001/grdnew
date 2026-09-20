'use client';

import { useState } from 'react';
import { post, setToken } from '../lib/api';

export function GRDLogin({ onLogin }) {
  const [mode, setMode] = useState('staff');
  const [userid, setUserid] = useState('');
  const [password, setPassword] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const data = await post(mode === 'dealer' ? '/auth/dealer-login' : '/auth/login', { userid, password });
      if (mode === 'dealer') { setToken(data.token); onLogin({ ...data.dealer, is_dealer: true }); }
      else setOtpToken(data.otp_token);
    } catch (e) { setError(e.message || 'Login failed'); }
    finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { const data = await post('/auth/verify-otp', { otp_token: otpToken, otp }); setToken(data.token); onLogin(data.user); }
    catch (e) { setError(e.message || 'OTP verification failed'); }
    finally { setBusy(false); }
  };

  const socials = [
    ['Instagram','https://www.instagram.com/grdmotorsofficial/','https://cdn.simpleicons.org/instagram/ffffff'],
    ['Facebook','https://www.facebook.com/davratherickshaw/','https://cdn.simpleicons.org/facebook/ffffff'],
    ['WhatsApp','https://wa.me/917678171836','https://cdn.simpleicons.org/whatsapp/ffffff'],
    ['Website','https://davrath.com/','https://cdn.simpleicons.org/googlechrome/ffffff'],
    ['Google Maps','https://maps.app.goo.gl/6zKJLUG7Yyf28dKT8','https://cdn.simpleicons.org/googlemaps/4285f4'],
  ];

  return (
    <main className="grdLoginShell">
      <style>{`
        .grdLoginShell{position:fixed;inset:0;overflow:hidden;background:#e9f8ff;font-family:Arial,Helvetica,sans-serif}
        .grdArtwork{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;user-select:none;-webkit-user-drag:none}
        .grdRealPanel{position:absolute;z-index:20;right:6.5%;top:50%;transform:translateY(-45%);width:min(490px,31vw);box-sizing:border-box;padding:30px 34px 25px;border-radius:28px;background:rgba(255,255,255,.99);box-shadow:0 24px 70px rgba(12,71,115,.23)}
        .badge{display:inline-block;border-radius:999px;background:#e6f3ff;color:#0b69ce;padding:7px 13px;font-size:10px;font-weight:900}.title{font-size:30px;line-height:1.05;margin:15px 0 7px;color:#172f52;font-weight:900}.title em{font-style:normal;color:#147ce3}.sub{margin:0 0 16px;color:#60758a;font-size:12px;line-height:1.45}.divider{height:1px;background:#dbe7ef;margin-bottom:15px}
        .tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tab{height:43px;border:1px solid #c8dce9;background:#fff;border-radius:10px;color:#28435f;font-weight:800;font-size:11px;cursor:pointer}.tab.active{color:#fff;border-color:transparent;background:linear-gradient(90deg,#087ce8,#18ac65)}
        .field{margin-top:12px}.field label{display:block;font-size:11px;font-weight:900;color:#193553;margin-bottom:6px}.wrap{position:relative}.input{width:100%;height:49px;border:1px solid #bdd2e1;border-radius:11px;background:#fff;color:#183753;padding:0 42px;outline:none;box-sizing:border-box;font-size:14px}.input:focus{border-color:#0c7de7;box-shadow:0 0 0 3px rgba(12,125,231,.1)}.icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}.eye{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#537089;padding:7px;cursor:pointer}
        .forgot{text-align:right;margin:7px 0 0}.forgot button{border:0;background:none;color:#0b6fce;font-weight:800;font-size:11px;padding:0;cursor:pointer}.loginBtn{width:100%;height:51px;border:0;border-radius:11px;margin-top:16px;color:#fff;font-weight:900;font-size:15px;background:linear-gradient(90deg,#087ce8,#16ad63);cursor:pointer}.loginBtn:disabled{opacity:.65}.help{text-align:center;margin-top:12px;color:#667b8e;font-size:10px}.help strong{color:#0a70d4}.secure{text-align:center;border-top:1px solid #e1ebf1;margin-top:15px;padding-top:13px;color:#718494;font-size:10px}.error{color:#a92020;background:#fff1f2;border:1px solid #fecdd3;padding:9px;border-radius:9px;margin:10px 0;font-size:11px}.otpNote{text-align:center;font-size:11px;color:#607789;margin:12px 0}
        .socialBar{position:absolute;z-index:30;left:0;right:0;bottom:0;height:150px;display:flex;align-items:center;gap:22px;padding:0 4%;box-sizing:border-box;background:transparent}.social{display:flex;align-items:center;justify-content:center;width:205px;height:70px;text-decoration:none}.social img{width:31px;height:31px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.2))}
        @media(max-width:800px){.grdArtwork{content:url('/grd-login-mobile.svg');object-position:center}.grdRealPanel{right:50%;top:51%;transform:translate(50%,-38%);width:calc(100vw - 36px);max-width:470px;padding:22px}.socialBar{height:85px;gap:2px;padding:0 4px}.social{width:20%;height:70px}.social img{width:27px;height:27px}}
        @media(max-width:520px){.grdRealPanel{width:calc(100vw - 22px);padding:17px;border-radius:20px}.title{font-size:25px}.tab{font-size:10px}.social img{width:25px;height:25px}}
      `}</style>

      <img className="grdArtwork" src="/grd-login-desktop.svg" alt="G.R.D. Motors" draggable="false" />

      <section className="grdRealPanel">
        <div className="badge">ADMIN · STAFF · DEALER · CUSTOMER</div>
        <h2 className="title">{otpToken ? <>Verify <em>OTP</em></> : <>Welcome <em>Back!</em></>}</h2>
        <p className="sub">{otpToken ? 'Enter the OTP sent for secure staff verification.' : 'Login to access your G.R.D. Motors account — you will land on your own dashboard automatically.'}</p>
        <div className="divider" />
        {!otpToken ? <form onSubmit={submit}>
          <div className="tabs">
            <button type="button" className={'tab'+(mode==='staff'?' active':'')} onClick={()=>{setMode('staff');setUserid('');setPassword('');setError('')}}>🔒 Password Login</button>
            <button type="button" className={'tab'+(mode==='dealer'?' active':'')} onClick={()=>{setMode('dealer');setUserid('');setPassword('');setError('')}}>▣ Dealer Login</button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="field"><label>{mode==='dealer'?'Dealer ID':'Username / Mobile number'}</label><div className="wrap"><span className="icon">👤</span><input className="input" value={userid} onChange={e=>setUserid(e.target.value)} autoFocus required placeholder={mode==='dealer'?'Enter Dealer ID':'Enter username or mobile number'} /></div></div>
          <div className="field"><label>Password</label><div className="wrap"><span className="icon">🔐</span><input className="input" type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter password" /><button type="button" className="eye" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'◉':'◌'}</button></div></div>
          <div className="forgot"><button type="button">Forgot Password?</button></div>
          <button className="loginBtn" disabled={busy}>{busy?'Checking…':'→ Login'}</button>
          <div className="help">Dealer? Use <strong>Dealer Login</strong> tab above · Customer login is available through the customer portal.</div>
          <div className="secure">🛡️ Your data is safe and secure with G.R.D. Motors.</div>
        </form> : <form onSubmit={verify}>
          {error && <div className="error">{error}</div>}
          <div className="field"><label>OTP</label><div className="wrap"><span className="icon">🔢</span><input className="input" inputMode="numeric" maxLength={4} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus required placeholder="Enter 4 digit OTP" /></div></div>
          <div className="otpNote">Temporary OTP for testing: <b>1234</b></div>
          <button className="loginBtn" disabled={busy}>{busy?'Verifying…':'✓ Verify & Login'}</button>
          <button type="button" className="tab" style={{width:'100%',marginTop:9}} onClick={()=>{setOtpToken('');setOtp('');setError('')}}>← Back</button>
        </form>}
      </section>

      <nav className="socialBar" aria-label="G.R.D. Motors social links">
        {socials.map(([name,href,icon])=><a key={name} className="social" href={href} target="_blank" rel="noopener noreferrer" aria-label={name} title={name}><img src={icon} alt="" /></a>)}
      </nav>
    </main>
  );
}

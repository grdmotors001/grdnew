'use client';

import { useState } from 'react';
import { post, setToken, setPortalKind } from '../lib/api';

const SocialIcon = {
  Instagram: <img src="/icons/instagram.png" width="26" height="26" alt="Instagram" />,
  Facebook: <img src="/icons/facebook.png" width="26" height="26" alt="Facebook" />,
  WhatsApp: <img src="/icons/whatsapp.png" width="26" height="26" alt="WhatsApp" />,
  Website: <img src="/icons/website.png" width="26" height="26" alt="Website" />,
  'Google Maps': <img src="/icons/gmaps.png" width="26" height="26" alt="Google Maps" />,
};

const FeatureIcon = {
  leaf: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#138d56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 3 20 2c1 3.5-1.5 8-4.5 10.5-1.2 1-3 2.2-4.5 2.5" />
      <path d="M9 20A6.5 6.5 0 0 1 4 12.5" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#138d56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#138d56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9c.14.36.5.6.9.64H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.36z" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#138d56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  ),
  handshake: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12l3 3 6-6" />
      <path d="M2 12l5-5 4 2 4-2 5 5-4 4-2-1-3 3-5-5" />
    </svg>
  ),
};

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
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post(mode === 'dealer' ? '/auth/dealer-login' : '/auth/login', { userid, password });
      if (mode === 'dealer') {
        setToken(data.token);
        setPortalKind('dealer');
        try { window.localStorage.setItem('grd_dealer_profile', JSON.stringify(data.dealer)); } catch {}
        onLogin({ ...data.dealer, is_dealer: true });
      } else {
        setOtpToken(data.otp_token);
      }
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post('/auth/verify-otp', { otp_token: otpToken, otp });
      setToken(data.token);
      setPortalKind('staff');
      onLogin(data.user);
    } catch (e) {
      setError(e.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const socialLinks = [
    ['Instagram', 'https://www.instagram.com/grdmotorsofficial/'],
    ['Facebook', 'https://www.facebook.com/davratherickshaw/'],
    ['WhatsApp', 'https://wa.me/917678171836'],
    ['Website', 'https://davrath.com/'],
    ['Google Maps', 'https://maps.app.goo.gl/6zKJLUG7Yyf28dKT8'],
  ];

  const navLinks = [
    ['Home', '#'],
    ['About Us', 'https://davrath.com/about/'],
    ['Our Products', 'https://davrath.com/e-vehicles/'],
    ['Why EV', 'https://davrath.com/career/'],
    ['Contact', 'https://davrath.com/contact/'],
  ];

  const features = [
    ['leaf', 'Eco Friendly', 'Mobility'],
    ['shield', 'Trusted', 'Service'],
    ['gear', 'Smart Business', 'Management'],
    ['bolt', 'Better', 'Tomorrow'],
  ];

  const footerBadges = [
    ['bolt', '100% Electric'],
    ['shield', 'Low Maintenance'],
    ['handshake', 'Better Earnings'],
  ];

  return (
    <main className="grdCleanLogin">
      <style>{`
        *{box-sizing:border-box}
        .grdCleanLogin{position:fixed;inset:0;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#17385c;background:#fff}

        .navbar{position:absolute;left:0;right:0;top:0;height:72px;background:#fff;box-shadow:0 1px 0 #e6edf2;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:0 4%}
        .navLogo{height:44px;display:block}
        .navLinks{display:flex;align-items:center;gap:34px;list-style:none;margin:0;padding:0}
        .navLinks a{color:#1a3a5c;text-decoration:none;font-weight:700;font-size:14px;padding-bottom:22px;border-bottom:2px solid transparent}
        .navLinks a.active{color:#0b69ce;border-bottom-color:#0b69ce}
        .navRight{display:flex;align-items:center;gap:8px;color:#0e3a63;font-weight:900;font-size:11px;line-height:1.15;text-transform:uppercase}

        .hero{position:absolute;left:0;right:0;top:72px;bottom:132px;overflow:hidden;background-image:linear-gradient(180deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.35) 100%),url('/hero-bg.jpg');background-size:cover;background-position:center}

        .tag{position:absolute;left:6%;top:38px;z-index:3;font-size:13px;font-weight:900;letter-spacing:4px;color:#138d56}
        .heroText{position:absolute;left:6%;top:64px;z-index:3;max-width:640px}
        .heroText h1{font-size:56px;line-height:1.02;margin:0;font-weight:900;color:#102f5d;letter-spacing:-1.5px}
        .heroText h1 .blue{color:#087ce8}.heroText h1 .green{color:#18aa68}
        .heroText p{font-size:14px;line-height:1.55;color:#28516f;margin:16px 0 0;max-width:480px}

        .features{position:absolute;left:6%;top:250px;z-index:3;display:flex;gap:26px}
        .feature{display:flex;flex-direction:column;align-items:center;text-align:center;width:96px}
        .feature .fi{width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.85);display:grid;place-items:center;box-shadow:0 6px 16px rgba(12,71,115,.10);margin-bottom:8px}
        .feature span{font-size:11px;font-weight:800;color:#12314f;line-height:1.3}

        .tomorrow{position:absolute;left:46%;top:26px;z-index:3;text-align:center;font-family:"Comic Sans MS",cursive;font-size:38px;line-height:.95;transform:rotate(-6deg);color:#0a4d8e}
        .tomorrow span{display:block}.tomorrow .g{color:#25a94e}

        .vehicles{position:absolute;left:3%;bottom:-6px;z-index:4;display:flex;align-items:flex-end;gap:0}
        .vehicle{height:150px;width:auto;display:flex;align-items:end;justify-content:center;overflow:hidden;filter:drop-shadow(0 14px 12px rgba(15,45,70,.20))}
        .vehicle img{height:100%;width:auto;object-fit:contain}

        .loginCard{position:absolute;z-index:20;right:6%;top:110px;width:29vw;min-width:400px;max-width:480px;padding:28px 32px 24px;border-radius:24px;background:rgba(255,255,255,.99);box-shadow:0 24px 70px rgba(12,71,115,.22)}
        .badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:#e7f3ff;color:#0b69ce;padding:7px 13px;font-size:10px;font-weight:900}
        .title{font-size:28px;line-height:1.05;margin:15px 0 7px;color:#172f52;font-weight:900}.title em{font-style:normal;color:#147ce3}
        .sub{margin:0 0 16px;color:#60758a;font-size:12px;line-height:1.45}
        .divider{height:1px;background:#dbe7ef;margin-bottom:15px}

        .tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tab{height:43px;border:1px solid #c8dce9;background:#fff;border-radius:10px;color:#28435f;font-weight:800;font-size:11px;cursor:pointer}.tab.active{color:#fff;border-color:transparent;background:linear-gradient(90deg,#0b7f4f,#18ac65)}

        .field{margin-top:12px}.field label{display:block;font-size:11px;font-weight:900;color:#193553;margin-bottom:6px}.wrap{position:relative;display:flex;align-items:center;gap:9px}.input{flex:1;width:100%;height:49px;border:1px solid #bdd2e1;border-radius:11px;background:#fff;color:#183753;padding:0 40px 0 14px;outline:none;font-size:14px}.input:focus{border-color:#0c7de7;box-shadow:0 0 0 3px rgba(12,125,231,.1)}.icon{flex:none;width:20px;text-align:center;color:#537089;font-size:16px}.eye{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#537089;padding:7px;cursor:pointer}

        .forgot{text-align:right;margin:7px 0 0}.forgot button{border:0;background:none;color:#0b6fce;font-weight:800;font-size:11px;padding:0;cursor:pointer}
        .loginBtn{width:100%;height:51px;border:0;border-radius:11px;margin-top:16px;color:#fff;font-weight:900;font-size:15px;background:linear-gradient(90deg,#087ce8,#16ad63);cursor:pointer}.loginBtn:disabled{opacity:.65}
        .help{text-align:center;margin-top:12px;color:#667b8e;font-size:10px}.help strong{color:#0a70d4}
        .secure{text-align:center;border-top:1px solid #e1ebf1;margin-top:15px;padding-top:13px;color:#718494;font-size:10px}
        .error{color:#a92020;background:#fff1f2;border:1px solid #fecdd3;padding:9px;border-radius:9px;margin:10px 0;font-size:11px}
        .otpNote{text-align:center;font-size:11px;color:#607789;margin:12px 0}

        .footer{position:absolute;left:0;right:0;bottom:0;height:132px;background:#0a2f56;border-top:4px solid #22a760;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:0 5%;gap:32px;flex-wrap:wrap}
        .socialRow{display:flex;align-items:center;gap:28px}
        .social{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:11px;font-weight:900}
        .socialIcon{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;overflow:hidden}.socialIcon img{width:100%;height:100%;object-fit:contain}
        .badgeRow{display:flex;align-items:center;gap:30px}
        .footBadge{display:flex;align-items:center;gap:9px;color:#fff;font-size:12px;font-weight:800}
        .footBadge .bi{width:28px;height:28px;border-radius:8px;background:#ffffff1f;display:grid;place-items:center}

        @media(max-width:1200px){.badgeRow{display:none}.features{gap:16px}.feature{width:82px}}
        @media(max-width:1050px){.heroText h1{font-size:44px}.tomorrow{left:40%;font-size:30px}.vehicles{transform:scale(.8);transform-origin:left bottom}.loginCard{right:3%;width:38vw;min-width:360px}.navLinks{gap:20px}}
        @media(max-width:900px){.features{display:none}}
        @media(max-width:800px){
          .navLinks{display:none}.navRight{display:none}
          .heroText{top:40px}.heroText h1{font-size:36px}.heroText p{display:none}
          .tomorrow{display:none}
          .vehicles{bottom:0;left:5%;transform:scale(.6);transform-origin:left bottom}
          .loginCard{left:50%;right:auto;top:52%;transform:translate(-50%,-50%);width:calc(100vw - 28px);min-width:0;max-width:480px;padding:22px}
          .footer{height:70px;padding:0 5px;gap:0;justify-content:space-around}
          .socialRow{gap:0;width:100%;justify-content:space-around}
          .social span{display:none}.socialIcon{width:31px;height:31px}
        }
        @media(max-width:520px){
          .grdCleanLogin{position:relative;min-height:100dvh;height:auto;overflow:auto;padding-bottom:76px}
          .navbar{position:relative;height:56px}.navLogo{height:34px}
          .hero{display:none}
          .loginCard{position:relative;left:auto;right:auto;top:auto;transform:none;width:calc(100vw - 24px);min-width:0;max-width:none;margin:16px auto;padding:18px;border-radius:20px}
          .tabs{gap:7px}.tab{height:46px;font-size:10px}
          .field{margin-top:14px}
          .input{height:52px}
          .loginBtn{height:52px;margin-top:15px}
          .footer{position:fixed;height:62px;bottom:0;z-index:30}
        }
      `}</style>

      <nav className="navbar">
        <img className="navLogo" src="/grdlogo.png" alt="G.R.D. Motors" />
        <ul className="navLinks">
          {navLinks.map(([l, href], i) => (
            <li key={l}>
              <a
                href={href}
                className={i === 0 ? 'active' : ''}
                target={href === '#' ? undefined : '_blank'}
                rel={href === '#' ? undefined : 'noopener noreferrer'}
              >{l}</a>
            </li>
          ))}
        </ul>
        <div className="navRight">
          {FeatureIcon.leaf}
          <span>ELECTRIC<br/>MOBILITY<br/>FOR A BETTER<br/>INDIA</span>
        </div>
      </nav>

      <div className="hero">
        <div className="tag">CLEAN &nbsp; • &nbsp; GREEN &nbsp; • &nbsp; FUTURE READY</div>
        <div className="heroText">
          <h1>Powering Your<br/><span className="blue">EV</span> <span className="green">Journey</span></h1>
          <p>Reliable electric mobility solutions, trusted service and smart business management — all in one secure G.R.D. Motors system.</p>
        </div>

        <div className="features">
          {features.map(([icon, l1, l2]) => (
            <div className="feature" key={l1 + l2}>
              <div className="fi">{FeatureIcon[icon]}</div>
              <span>{l1}<br/>{l2}</span>
            </div>
          ))}
        </div>

        <div className="tomorrow"><span>Drive</span><span>A Cleaner</span><span className="g">Tomorrow</span></div>

        <div className="vehicles">
          <div className="vehicle"><img src="/vehicles/vehicle-1.png" alt="G.R.D. Motors vehicle"/></div>
          <div className="vehicle"><img src="/vehicles/vehicle-2.png" alt="G.R.D. Motors vehicle"/></div>
          <div className="vehicle"><img src="/vehicles/vehicle-3.png" alt="G.R.D. Motors loader"/></div>
        </div>
      </div>

      <section className="loginCard">
        <div className="badge">{FeatureIcon.shield}ADMIN · STAFF · DEALER · CUSTOMER</div>
        <h2 className="title">{otpToken ? <>Verify <em>OTP</em></> : <>Welcome <em>Back!</em></>}</h2>
        <p className="sub">{otpToken ? 'Enter the OTP sent for secure staff verification.' : 'Login to access your G.R.D. Motors account — you will land on your own dashboard automatically.'}</p>
        <div className="divider"/>
        {!otpToken ? <form onSubmit={submit}>
          <div className="tabs">
            <button type="button" className={'tab'+(mode==='staff'?' active':'')} onClick={()=>{setMode('staff');setUserid('');setPassword('');setError('')}}>🔒 Password Login</button>
            <button type="button" className={'tab'+(mode==='dealer'?' active':'')} onClick={()=>{setMode('dealer');setUserid('');setPassword('');setError('')}}>▣ Dealer Login</button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="field"><label>{mode==='dealer'?'Dealer ID':'Username / Mobile number'}</label><div className="wrap"><span className="icon">👤</span><input className="input" value={userid} onChange={e=>setUserid(e.target.value)} autoFocus required placeholder={mode==='dealer'?'Enter Dealer ID':'Enter username or mobile number'}/></div></div>
          <div className="field"><label>Password</label><div className="wrap"><span className="icon">🔐</span><input className="input" type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter password"/><button type="button" className="eye" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'◉':'◌'}</button></div></div>
          <div className="forgot"><button type="button">Forgot Password?</button></div>
          <button className="loginBtn" disabled={busy}>{busy?'Checking…':'→ Login'}</button>
          <div className="help">Dealer? Use <strong>Dealer Login</strong> tab above · Customer login is available through the customer portal.</div>
          <div className="secure">🛡️ Your data is safe and secure with G.R.D. Motors.</div>
        </form> : <form onSubmit={verify}>
          {error && <div className="error">{error}</div>}
          <div className="field"><label>OTP</label><div className="wrap"><span className="icon">🔢</span><input className="input" inputMode="numeric" maxLength={4} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus required placeholder="Enter 4 digit OTP"/></div></div>
          <div className="otpNote">Temporary OTP for testing: <b>1234</b></div>
          <button className="loginBtn" disabled={busy}>{busy?'Verifying…':'✓ Verify & Login'}</button>
          <button type="button" className="tab" style={{width:'100%',marginTop:9}} onClick={()=>{setOtpToken('');setOtp('');setError('')}}>← Back</button>
        </form>}
      </section>

      <nav className="footer" aria-label="G.R.D. Motors social links">
        <div className="socialRow">
          {socialLinks.map(([name,href])=><a key={name} className="social" href={href} target="_blank" rel="noopener noreferrer"><span className="socialIcon">{SocialIcon[name]}</span><span>{name}</span></a>)}
        </div>
        <div className="badgeRow">
          {footerBadges.map(([icon, label]) => (
            <div className="footBadge" key={label}><span className="bi">{FeatureIcon[icon]}</span>{label}</div>
          ))}
        </div>
      </nav>
    </main>
  );
}

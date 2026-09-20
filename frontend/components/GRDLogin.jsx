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
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post(mode === 'dealer' ? '/auth/dealer-login' : '/auth/login', { userid, password });
      if (mode === 'dealer') {
        setToken(data.token);
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
      onLogin(data.user);
    } catch (e) {
      setError(e.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const socialLinks = [
    ['Instagram', 'https://www.instagram.com/grdmotorsofficial/', '◎'],
    ['Facebook', 'https://www.facebook.com/davratherickshaw/', 'f'],
    ['WhatsApp', 'https://wa.me/917678171836', '◉'],
    ['Website', 'https://davrath.com/', '◎'],
    ['Google Maps', 'https://maps.app.goo.gl/6zKJLUG7Yyf28dKT8', '●'],
  ];

  return (
    <main className="grdCleanLogin">
      <style>{`
        .grdCleanLogin{position:fixed;inset:0;overflow:hidden;background:linear-gradient(180deg,#e4f7ff 0%,#f7fcff 67%,#e9f7ee 100%);font-family:Arial,Helvetica,sans-serif;color:#17385c}
        .grdCleanLogin:before{content:"";position:absolute;left:-8%;right:-8%;bottom:135px;height:150px;background:linear-gradient(180deg,rgba(104,193,111,.05),rgba(73,164,83,.22));clip-path:polygon(0 82%,3% 66%,6% 82%,9% 55%,12% 82%,15% 64%,18% 82%,21% 48%,24% 82%,27% 60%,30% 82%,33% 52%,36% 82%,39% 63%,42% 82%,45% 45%,48% 82%,51% 60%,54% 82%,57% 50%,60% 82%,63% 62%,66% 82%,69% 46%,72% 82%,75% 58%,78% 82%,81% 48%,84% 82%,87% 60%,90% 82%,93% 52%,96% 82%,100% 62%,100% 100%,0 100%)}
        .grdCleanLogin:after{content:"";position:absolute;left:0;right:0;bottom:132px;height:4px;background:#8bc9d6;z-index:1}
        .brand{position:absolute;left:5.8%;top:18px;z-index:5}.brandLogo{width:455px;height:auto;display:block}.mobilityBadge{position:absolute;right:5.5%;top:25px;z-index:5;display:flex;align-items:center;gap:10px;color:#083f78;font-weight:900;font-size:14px;line-height:1.05;text-transform:uppercase}.mobilityBadge .leaf{font-size:38px;color:#43b83b;transform:rotate(-18deg)}
        .tag{position:absolute;left:6%;top:130px;z-index:3;font-size:13px;font-weight:900;letter-spacing:4px;color:#138d56}.hero{position:absolute;left:6%;top:155px;z-index:3}.hero h1{font-size:76px;line-height:.96;margin:0;font-weight:900;color:#102f5d;letter-spacing:-2px}.hero h1 .blue{color:#087ce8}.hero h1 .green{color:#18aa68}.hero p{font-size:14px;line-height:1.55;color:#28516f;margin:20px 0 0}.hero .line{width:125px;height:5px;border-radius:5px;background:linear-gradient(90deg,#087ce8,#19ac67);margin-top:18px}
        .tomorrow{position:absolute;left:44%;top:145px;z-index:3;text-align:center;font-family:"Comic Sans MS",cursive;font-size:48px;line-height:.92;transform:rotate(-6deg);color:#0a4d8e}.tomorrow span{display:block}.tomorrow .g{color:#25a94e}
        .road{position:absolute;left:0;right:0;bottom:132px;height:110px;background:linear-gradient(180deg,#e0f0f3,#c5dce2);z-index:0}.road:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:#9bcbd5}
        .vehicles{position:absolute;left:3%;bottom:148px;display:flex;gap:10px;z-index:2}.vehicle{width:245px;height:95px;border:1px solid #d8e5ea;background:rgba(255,255,255,.72);box-shadow:0 8px 18px rgba(24,74,103,.10);display:flex;align-items:center;justify-content:center;overflow:hidden}.vehicle img{width:100%;height:100%;object-fit:contain}
        .loginCard{position:absolute;z-index:10;right:6.5%;top:50%;transform:translateY(-45%);width:31vw;min-width:410px;max-width:500px;padding:30px 34px 25px;border-radius:28px;background:rgba(255,255,255,.99);box-shadow:0 24px 70px rgba(12,71,115,.20);box-sizing:border-box}
        .badge{display:inline-block;border-radius:999px;background:#e7f3ff;color:#0b69ce;padding:7px 13px;font-size:10px;font-weight:900}.title{font-size:30px;line-height:1.05;margin:15px 0 7px;color:#172f52;font-weight:900}.title em{font-style:normal;color:#147ce3}.sub{margin:0 0 16px;color:#60758a;font-size:12px;line-height:1.45}.divider{height:1px;background:#dbe7ef;margin-bottom:15px}
        .tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tab{height:43px;border:1px solid #c8dce9;background:#fff;border-radius:10px;color:#28435f;font-weight:800;font-size:11px;cursor:pointer}.tab.active{color:#fff;border-color:transparent;background:linear-gradient(90deg,#087ce8,#18ac65)}
        .field{margin-top:12px}.field label{display:block;font-size:11px;font-weight:900;color:#193553;margin-bottom:6px}.wrap{position:relative}.input{width:100%;height:49px;border:1px solid #bdd2e1;border-radius:11px;background:#fff;color:#183753;padding:0 42px;outline:none;box-sizing:border-box;font-size:14px}.input:focus{border-color:#0c7de7;box-shadow:0 0 0 3px rgba(12,125,231,.1)}.icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}.eye{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#537089;padding:7px;cursor:pointer}
        .forgot{text-align:right;margin:7px 0 0}.forgot button{border:0;background:none;color:#0b6fce;font-weight:800;font-size:11px;padding:0;cursor:pointer}.loginBtn{width:100%;height:51px;border:0;border-radius:11px;margin-top:16px;color:#fff;font-weight:900;font-size:15px;background:linear-gradient(90deg,#087ce8,#16ad63);cursor:pointer}.loginBtn:disabled{opacity:.65}.help{text-align:center;margin-top:12px;color:#667b8e;font-size:10px}.help strong{color:#0a70d4}.secure{text-align:center;border-top:1px solid #e1ebf1;margin-top:15px;padding-top:13px;color:#718494;font-size:10px}.error{color:#a92020;background:#fff1f2;border:1px solid #fecdd3;padding:9px;border-radius:9px;margin:10px 0;font-size:11px}.otpNote{text-align:center;font-size:11px;color:#607789;margin:12px 0}
        .footer{position:absolute;left:0;right:0;bottom:0;height:132px;background:#07509a;border-top:4px solid #22a760;z-index:20;display:flex;align-items:center;padding:0 5%;box-sizing:border-box;gap:32px}.social{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:11px;font-weight:900;min-width:135px}.socialIcon{width:30px;height:30px;border-radius:8px;background:#1687e8;display:grid;place-items:center;font-size:17px}.social:nth-child(3) .socialIcon{background:#19b66b}
        @media(max-width:1050px){.hero h1{font-size:60px}.tomorrow{left:40%;font-size:38px}.vehicles{transform:scale(.85);transform-origin:left bottom}.loginCard{right:3%;width:40vw;min-width:390px}}
        @media(max-width:800px){.brand{left:5%;top:14px}.brandLogo{width:300px}.mobilityBadge{display:none}.tag{top:95px;font-size:9px;letter-spacing:2px}.hero{top:120px;left:6%}.hero h1{font-size:46px}.hero p{display:none}.tomorrow{display:none}.vehicles{bottom:650px;left:5%;transform:scale(.62);transform-origin:left bottom}.road{display:none}.loginCard{left:50%;right:auto;top:54%;transform:translate(-50%,-50%);width:calc(100vw - 28px);min-width:0;max-width:480px;padding:22px}.footer{height:70px;padding:0 5px;gap:0;justify-content:space-around}.social{min-width:0;width:20%;justify-content:center}.social span{display:none}.socialIcon{width:31px;height:31px}.grdCleanLogin:after{display:none}}
        @media(max-width:520px){.brand{left:5%;top:10px}.brandLogo{width:245px}.hero h1{font-size:39px}.vehicles{display:none}.loginCard{top:52%;padding:17px;border-radius:20px}.title{font-size:25px}}
      `}</style>

      <div className="brand" aria-label="G.R.D. Motors"><svg className="brandLogo" viewBox="0 0 760 190" role="img" aria-label="G.R.D. Motors Manufacturer of E-Rickshaw and E-Cart">
        <defs><linearGradient id="logoBlueGreen" x1="0" x2="1"><stop stopColor="#087ce8"/><stop offset=".55" stopColor="#12a86a"/><stop offset="1" stopColor="#1a9d34"/></linearGradient><linearGradient id="logoBlack" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4a4a4a"/><stop offset=".45" stopColor="#080808"/><stop offset="1" stopColor="#202020"/></linearGradient></defs>
        <path d="M250 20c28-35 66-30 88-4-29-7-51 1-72 24-12 13-25 28-37 52 2-27 8-51 21-72z" fill="#39b92f"/>
        <circle cx="345" cy="12" r="10" fill="#087ce8"/><circle cx="315" cy="25" r="12" fill="#19a9df"/><circle cx="348" cy="45" r="15" fill="#36b52f"/><circle cx="307" cy="57" r="15" fill="#087ce8"/><circle cx="365" cy="75" r="13" fill="#21a72d"/>
        <text x="8" y="112" fontFamily="Arial,Helvetica,sans-serif" fontSize="91" fontWeight="900" fontStyle="italic" letterSpacing="-5" fill="url(#logoBlack)">G.R.D. MOTORS</text>
        <path d="M8 128 Q380 112 752 128" fill="none" stroke="url(#logoBlueGreen)" strokeWidth="5"/><path d="M350 128l18-18" stroke="#fff" strokeWidth="8"/>
        <text x="35" y="162" fontFamily="Arial,Helvetica,sans-serif" fontSize="25" fontWeight="800" letterSpacing="1.2" fill="#111">MANUFACTURER OF E-RICKSHAW &amp; E-CART</text>
      </svg></div>
      <div className="mobilityBadge"><span className="leaf">↗</span><span>ELECTRIC<br/>MOBILITY<br/>FOR A BETTER<br/>INDIA 🇮🇳</span></div>

      <div className="tag">CLEAN &nbsp; • &nbsp; GREEN &nbsp; • &nbsp; FUTURE READY</div>
      <div className="hero">
        <h1>Powering Your<br/><span className="blue">EV</span> <span className="green">Journey</span></h1>
        <p>Reliable electric mobility solutions, trusted service and smart business management<br/>— all in one secure G.R.D. Motors system.</p>
        <div className="line"/>
      </div>
      <div className="tomorrow"><span>Drive</span><span>A Cleaner</span><span className="g">Tomorrow</span></div>
      <div className="road"/>
      <div className="vehicles">
        <div className="vehicle"><img src="https://davrath.com/wp-content/uploads/slider/cache/8334a677cda0ae574a40331f4d3325f4/21.png" alt="G.R.D. Motors vehicle"/></div>
        <div className="vehicle"><img src="https://davrath.com/wp-content/uploads/slider/cache/876e3048c8c5833bb08274aa76db12aa/31.png" alt="G.R.D. Motors vehicle"/></div>
        <div className="vehicle"><img src="https://davrath.com/wp-content/uploads/slider/cache/76183185dbf7c53e2f52170bf120a8c8/davrath-number-one-e-loader-brand-india.jpg" alt="G.R.D. Motors loader"/></div>
      </div>

      <section className="loginCard">
        <div className="badge">ADMIN · STAFF · DEALER · CUSTOMER</div>
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
        {socialLinks.map(([name,href,icon])=><a key={name} className="social" href={href} target="_blank" rel="noopener noreferrer"><span className="socialIcon">{icon}</span><span>{name}</span></a>)}
      </nav>
    </main>
  );
}

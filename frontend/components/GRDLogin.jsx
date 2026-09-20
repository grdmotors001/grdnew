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
      setError(e.message);
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
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const socialLinks = [
    { cls: 'instagram', icon: '◎', label: 'Follow Us', sub: 'Instagram', href: 'https://www.instagram.com/grdmotorsofficial/' },
    { cls: 'facebook', icon: 'f', label: 'Like Us', sub: 'Facebook', href: 'https://www.facebook.com/davratherickshaw/' },
    { cls: 'whatsapp', icon: '◔', label: 'Chat Us', sub: '+91-7678171836', href: 'https://wa.me/917678171836' },
    { cls: 'website', icon: '◎', label: 'Visit Our', sub: 'Website', href: 'https://davrath.com/' },
    { cls: 'maps', icon: '●', label: 'Find Us', sub: 'Google Maps', href: 'https://maps.app.goo.gl/6zKJLUG7Yyf28dKT8' },
  ];

  return (
    <div className="grdLoginPage">
      <style>{`
        .grdLoginPage{min-height:100vh;position:relative;overflow:hidden;background:linear-gradient(180deg,#e9f8ff 0%,#f7fdff 48%,#eef9f0 100%);color:#092b56;font-family:Arial,Helvetica,sans-serif}
        .grdLoginPage:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 7% 42%,#39aee933 0 10%,transparent 29%),radial-gradient(circle at 58% 25%,#8fdfff55 0 13%,transparent 35%),linear-gradient(180deg,#bceaff22,#fff0 45%);pointer-events:none}
        .grdTop{position:relative;z-index:2;height:126px;padding:25px 6vw 15px;display:flex;align-items:flex-start;justify-content:space-between;background:linear-gradient(180deg,#eafaffaa,#ffffff00)}
        .grdBrand{display:flex;align-items:center;gap:13px}
        .grdLogoMark{width:59px;height:59px;display:flex;align-items:flex-end;gap:4px;position:relative}
        .grdLogoBar{width:10px;border-radius:4px 4px 1px 1px;transform:skewY(-20deg)}
        .grdLogoBar.one{height:33px;background:#1687e8}.grdLogoBar.two{height:46px;background:#28b66d}.grdLogoBar.three{height:57px;background:#1656a0}
        .grdLogoArrow{position:absolute;right:-2px;top:1px;width:24px;height:7px;background:#65c83d;border-radius:9px;transform:rotate(-38deg)}
        .grdLogoArrow:after{content:"";position:absolute;right:-2px;top:-5px;border-left:9px solid #65c83d;border-top:8px solid transparent;border-bottom:8px solid transparent}
        .grdBrandText strong{display:block;color:#10467f;font-size:clamp(28px,3.2vw,46px);font-weight:900;letter-spacing:.02em;line-height:1}
        .grdBrandText span{display:block;color:#153c65;font-size:11px;font-weight:800;letter-spacing:.1em;margin-top:6px}
        .grdIndia{display:flex;align-items:center;gap:10px;color:#12467f;font-weight:800;font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:.04em}
        .grdLeaf{font-size:42px;line-height:1;color:#4fbf42;transform:rotate(-18deg)}
        .grdHero{position:relative;z-index:2;min-height:calc(100vh - 126px);padding:0 6vw 122px}
        .grdCopy{position:relative;z-index:5;padding-top:8px;width:min(58%,720px)}
        .grdTag{display:inline-block;color:#229452;font-size:12px;font-weight:900;letter-spacing:.22em;margin-bottom:10px}
        .grdCopy h1{margin:0;font-size:clamp(44px,5.5vw,78px);line-height:.96;font-weight:950;letter-spacing:-.04em;color:#102e58}
        .grdCopy h1 span{color:#087be8}
        .grdCopy h1 em{font-style:normal;color:#1ca96a}
        .grdCopy p{max-width:560px;margin:18px 0 0;font-size:15px;line-height:1.55;color:#294d6d}
        .grdSwoosh{width:130px;height:5px;margin-top:18px;border-radius:99px;background:linear-gradient(90deg,#1385e8,#23a86a)}
        .grdDrive{position:absolute;z-index:4;left:43%;top:3%;font-family:cursive;font-size:clamp(30px,3.2vw,52px);line-height:.88;color:#0a4c8b;transform:rotate(-8deg);text-align:center}
        .grdDrive span{color:#24a949;display:block;margin-left:55px}
        .grdCity{position:absolute;left:0;right:0;bottom:98px;height:235px;background:linear-gradient(180deg,#ffffff00,#ffffff99 32%,#e9f7ff 100%);clip-path:polygon(0 58%,3% 51%,5% 58%,8% 43%,10% 56%,13% 46%,15% 59%,18% 39%,20% 55%,23% 47%,25% 58%,28% 35%,30% 54%,33% 45%,35% 59%,38% 40%,41% 54%,44% 43%,47% 57%,50% 35%,53% 55%,56% 42%,59% 57%,62% 38%,65% 54%,68% 45%,71% 57%,74% 39%,77% 55%,80% 43%,83% 57%,86% 37%,89% 54%,92% 45%,95% 58%,98% 42%,100% 58%,100% 100%,0 100%)}
        .grdRoad{position:absolute;left:-4%;right:-4%;bottom:84px;height:150px;background:linear-gradient(180deg,#dcecf1,#b9d3dc);transform:perspective(300px) rotateX(8deg);border-top:5px solid #a9d0dc}
        .grdVehicles{position:absolute;z-index:5;left:4vw;bottom:128px;display:flex;align-items:flex-end;gap:25px}
        .grdVehicle{width:220px;height:175px;position:relative;filter:drop-shadow(0 14px 10px #164e6a33)}
        .grdVehicle .roof{position:absolute;left:18px;right:18px;top:12px;height:34px;border-radius:70% 70% 10px 10px;background:var(--v);border:5px solid #143c61}
        .grdVehicle .body{position:absolute;left:28px;right:25px;bottom:23px;height:98px;border-radius:28px 28px 17px 17px;background:linear-gradient(145deg,var(--v),#0c335b);border:5px solid #153c5f}
        .grdVehicle .window{position:absolute;left:51px;right:51px;top:42px;height:57px;border-radius:12px;background:#bcecff;border:4px solid #173c5b}
        .grdVehicle .seat{position:absolute;left:77px;top:68px;width:68px;height:32px;border-radius:12px 12px 5px 5px;background:#12263b}
        .grdVehicle .wheel{position:absolute;bottom:3px;width:43px;height:43px;border-radius:50%;background:#101c28;border:7px solid #d4e0e6;box-shadow:inset 0 0 0 6px #1c3e57}
        .grdVehicle .wheel.left{left:33px}.grdVehicle .wheel.right{right:28px}
        .grdVehicle .lamp{position:absolute;left:96px;bottom:34px;width:28px;height:18px;border-radius:50%;background:#eafcff;border:3px solid #35516a}
        .grdVehicle:after{content:"GRD";position:absolute;left:91px;bottom:64px;color:#fff;font-weight:900;font-size:13px;letter-spacing:.1em}
        .grdVehicle.green{--v:#16a55c}.grdVehicle.blue{--v:#087ce7}.grdVehicle.dark{--v:#0e5fae}
        .grdLoginPanel{position:absolute;z-index:20;right:5vw;top:50%;transform:translateY(-45%);width:min(490px,38vw);padding:30px 34px 25px;border-radius:26px;background:#fffffff2;border:1px solid #fff;box-shadow:0 24px 70px #0c47733b;backdrop-filter:blur(12px)}
        .grdModeBadge{display:inline-block;border-radius:999px;background:#e6f3ff;color:#0b69ce;padding:7px 13px;font-size:10px;font-weight:900;letter-spacing:.07em}
        .grdLoginTitle{font-size:30px;line-height:1.05;margin:15px 0 7px;color:#172f52;font-weight:900}.grdLoginTitle em{font-style:normal;color:#147ce3}
        .grdLoginSub{margin:0 0 16px;color:#60758a;font-size:12px;line-height:1.45}
        .grdDivider{height:1px;background:#dbe7ef;margin-bottom:15px}
        .grdTabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
        .grdTab{height:43px;border:1px solid #c8dce9;background:#fff;border-radius:10px;color:#28435f;font-weight:800;font-size:11px}.grdTab.active{color:#fff;border-color:transparent;background:linear-gradient(90deg,#087ce8,#18ac65);box-shadow:0 7px 18px #087ce822}
        .grdField{margin-top:12px}.grdField label{display:block;font-size:11px;font-weight:900;color:#193553;margin-bottom:6px}
        .grdInputWrap{position:relative}.grdInput{width:100%;height:49px;border:1px solid #bdd2e1;border-radius:11px;background:#fff;color:#183753;padding:0 42px;outline:none;box-sizing:border-box}.grdInput:focus{border-color:#0c7de7;box-shadow:0 0 0 3px #0c7de718}.grdInputIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}.grdEye{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#537089;padding:7px}
        .grdForgot{text-align:right;margin:7px 0 0}.grdForgot button{border:0;background:none;color:#0b6fce;font-weight:800;font-size:11px;padding:0}
        .grdLoginBtn{width:100%;height:51px;border:0;border-radius:11px;margin-top:16px;color:#fff;font-weight:900;font-size:15px;background:linear-gradient(90deg,#087ce8,#16ad63);box-shadow:0 10px 25px #087ce833}.grdLoginBtn:disabled{opacity:.65}
        .grdHelp{text-align:center;margin-top:12px;color:#667b8e;font-size:10px}.grdHelp strong{color:#0a70d4}.grdSecure{display:flex;justify-content:center;gap:6px;align-items:center;border-top:1px solid #e1ebf1;margin-top:15px;padding-top:13px;color:#718494;font-size:10px}
        .grdError{color:#a92020;background:#fff1f2;border:1px solid #fecdd3;padding:9px;border-radius:9px;margin:10px 0;font-size:11px}.grdOtpNote{text-align:center;font-size:11px;color:#607789;margin:12px 0}
        .grdSocials{position:absolute;z-index:30;left:5vw;right:5vw;bottom:18px;display:flex;align-items:center;justify-content:flex-start;gap:18px;padding:12px 0 0;border-top:2px solid #0b579a;box-shadow:0 -7px 0 #22a760;clip-path:ellipse(62% 100% at 50% 100%)}
        .grdSocialLink{display:flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-size:10px;font-weight:800;padding:6px 5px}.grdSocialIcon{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#fff;font-size:17px;font-weight:900;flex:0 0 30px}.grdSocialLink small{display:block;font-size:9px;font-weight:500;opacity:.9}.grdSocialLink strong{display:block;font-size:10px}
        .instagram .grdSocialIcon{background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af)}.facebook .grdSocialIcon{background:#1877f2}.whatsapp .grdSocialIcon{background:#10b95a}.website .grdSocialIcon{background:#167bdc}.maps .grdSocialIcon{background:#fff;color:#4285f4}
        .grdFooterText{margin-left:auto;color:#fff;font-size:10px;font-weight:800;letter-spacing:.04em;display:flex;align-items:center;gap:7px}
        @media(max-width:1050px){.grdLoginPanel{width:min(450px,44vw);right:3vw}.grdVehicles{left:2vw;gap:8px}.grdVehicle{transform:scale(.82);transform-origin:bottom left}.grdCopy{width:54%}.grdDrive{left:38%}}
        @media(max-width:800px){.grdTop{height:100px;padding:18px 20px}.grdLogoMark{transform:scale(.72);transform-origin:left center}.grdBrandText strong{font-size:26px}.grdBrandText span{font-size:8px}.grdIndia{display:none}.grdHero{min-height:calc(100vh - 100px);padding:0 20px 190px}.grdCopy{width:100%;text-align:center}.grdCopy h1{font-size:44px}.grdCopy p{font-size:12px;margin-left:auto;margin-right:auto}.grdSwoosh{margin-left:auto;margin-right:auto}.grdDrive{display:none}.grdCity{bottom:155px}.grdRoad{bottom:135px}.grdVehicles{bottom:158px;left:50%;transform:translateX(-50%) scale(.65);transform-origin:bottom center;gap:0}.grdLoginPanel{top:51%;right:50%;transform:translate(50%,-38%);width:calc(100vw - 36px);max-width:470px;padding:22px}.grdSocials{left:15px;right:15px;bottom:8px;gap:5px;justify-content:center;clip-path:none;border-top:0;box-shadow:none;background:#084d8f;border-radius:18px;padding:8px}.grdFooterText{display:none}}
        @media(max-width:520px){.grdTop{height:78px;padding:13px 14px}.grdLogoMark{display:none}.grdBrandText strong{font-size:22px}.grdBrandText span{font-size:7px}.grdHero{min-height:calc(100vh - 78px);padding:0 12px 180px}.grdCopy h1{font-size:34px}.grdCopy p{display:none}.grdLoginPanel{width:calc(100vw - 22px);padding:17px;border-radius:20px}.grdLoginTitle{font-size:25px}.grdTabs{gap:5px}.grdTab{font-size:10px}.grdVehicles{transform:translateX(-50%) scale(.49)}.grdSocialLink{gap:4px;padding:4px 2px}.grdSocialIcon{width:25px;height:25px;flex-basis:25px;font-size:14px}.grdSocialLink small{font-size:7px}.grdSocialLink strong{font-size:8px}}
      `}</style>

      <header className="grdTop">
        <div className="grdBrand">
          <div className="grdLogoMark" aria-hidden="true"><span className="grdLogoBar one"/><span className="grdLogoBar two"/><span className="grdLogoBar three"/><span className="grdLogoArrow"/></div>
          <div className="grdBrandText"><strong>G.R.D. MOTORS</strong><span>MANUFACTURER OF E-RICKSHAW &amp; E-CART</span></div>
        </div>
        <div className="grdIndia"><span className="grdLeaf">⌁</span><span>ELECTRIC<br/>MOBILITY<br/>FOR A BETTER INDIA 🇮🇳</span></div>
      </header>

      <main className="grdHero">
        <div className="grdCopy">
          <div className="grdTag">CLEAN&nbsp;&nbsp; • &nbsp;&nbsp;GREEN&nbsp;&nbsp; • &nbsp;&nbsp;FUTURE READY</div>
          <h1>Powering Your<br/><span>EV <em>Journey</em></span></h1>
          <p>Reliable electric mobility solutions, trusted service and smart business management — all in one secure G.R.D. Motors system.</p>
          <div className="grdSwoosh"/>
        </div>

        <div className="grdDrive">Drive<br/>A Cleaner<br/><span>Tomorrow</span></div>

        <div className="grdCity" aria-hidden="true"/>
        <div className="grdRoad" aria-hidden="true"/>

        <div className="grdVehicles" aria-hidden="true">
          <div className="grdVehicle blue"><span className="roof"/><span className="window"/><span className="seat"/><span className="body"/><span className="wheel left"/><span className="wheel right"/><span className="lamp"/></div>
          <div className="grdVehicle green"><span className="roof"/><span className="window"/><span className="seat"/><span className="body"/><span className="wheel left"/><span className="wheel right"/><span className="lamp"/></div>
          <div className="grdVehicle dark"><span className="roof"/><span className="window"/><span className="seat"/><span className="body"/><span className="wheel left"/><span className="wheel right"/><span className="lamp"/></div>
        </div>

        <section className="grdLoginPanel">
          <div className="grdModeBadge">ADMIN · STAFF · DEALER · CUSTOMER</div>
          <h2 className="grdLoginTitle">{otpToken ? <>Verify <em>OTP</em></> : <>Welcome <em>Back!</em></>}</h2>
          <p className="grdLoginSub">{otpToken ? 'Enter the OTP sent for secure staff verification.' : 'Login to access your G.R.D. Motors account — you will land on your own dashboard automatically.'}</p>
          <div className="grdDivider"/>

          {!otpToken ? (
            <form onSubmit={submit}>
              <div className="grdTabs">
                <button type="button" className={'grdTab'+(mode === 'staff' ? ' active' : '')} onClick={() => { setMode('staff'); setUserid(''); setError(''); }}>🔒 Password Login</button>
                <button type="button" className={'grdTab'+(mode === 'dealer' ? ' active' : '')} onClick={() => { setMode('dealer'); setUserid(''); setError(''); }}>▣ Dealer Login</button>
              </div>
              {error && <div className="grdError">{error}</div>}
              <div className="grdField">
                <label>{mode === 'dealer' ? 'Dealer ID' : 'Username / Mobile number'}</label>
                <div className="grdInputWrap"><span className="grdInputIcon">👤</span><input className="grdInput" value={userid} onChange={e => setUserid(e.target.value)} autoFocus required placeholder={mode === 'dealer' ? 'Enter Dealer ID' : 'Enter username or mobile number'}/></div>
              </div>
              <div className="grdField">
                <label>Password</label>
                <div className="grdInputWrap"><span className="grdInputIcon">🔐</span><input className="grdInput" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter password"/><button type="button" className="grdEye" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? '◉' : '◌'}</button></div>
              </div>
              <div className="grdForgot"><button type="button">Forgot Password?</button></div>
              <button className="grdLoginBtn" disabled={busy}>{busy ? 'Checking…' : '→ Login'}</button>
              <div className="grdHelp">Dealer? Use <strong>Dealer Login</strong> tab above · Customer login is available through the customer portal.</div>
              <div className="grdSecure">🛡️ Your data is safe and secure with G.R.D. Motors.</div>
            </form>
          ) : (
            <form onSubmit={verify}>
              {error && <div className="grdError">{error}</div>}
              <div className="grdField"><label>OTP</label><div className="grdInputWrap"><span className="grdInputIcon">🔢</span><input className="grdInput" inputMode="numeric" maxLength={4} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus required placeholder="Enter 4 digit OTP"/></div></div>
              <div className="grdOtpNote">Temporary OTP for testing: <b>1234</b></div>
              <button className="grdLoginBtn" disabled={busy}>{busy ? 'Verifying…' : '✓ Verify & Login'}</button>
              <button type="button" className="btn" style={{width:'100%',marginTop:9}} onClick={() => { setOtpToken(''); setOtp(''); setError(''); }}>← Back</button>
            </form>
          )}
        </section>

        <footer className="grdSocials" aria-label="G.R.D. Motors social links">
          {socialLinks.map((s) => (
            <a key={s.cls} className={`grdSocialLink ${s.cls}`} href={s.href} target="_blank" rel="noreferrer">
              <span className="grdSocialIcon">{s.icon}</span>
              <span><small>{s.label}</small><strong>{s.sub}</strong></span>
            </a>
          ))}
          <div className="grdFooterText">🇮🇳 MADE IN INDIA&nbsp;&nbsp; | &nbsp;&nbsp;DRIVE THE CHANGE&nbsp;&nbsp; 🌿</div>
        </footer>
      </main>
    </div>
  );
}

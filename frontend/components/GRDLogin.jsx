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

  return (
    <div className="grdLoginPage">
      <style>{`      <style>{`
        .grdLoginPage{min-height:100vh;display:block;position:relative;overflow:hidden;background:linear-gradient(180deg,#0a3d82 0 20%,#dff3ff 38%,#f7fcff 72%,#fff 100%);color:#102a43}
        .grdLoginPage:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 15% 45%,#55b7ff55 0 12%,transparent 30%),radial-gradient(circle at 82% 40%,#8de6c355 0 10%,transparent 30%),linear-gradient(125deg,transparent 0 22%,#0b5ed722 22% 30%,transparent 30% 100%);pointer-events:none}
        .grdLoginHero{position:relative;min-height:100vh;padding:26px 5vw 150px;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,#07366f 0 19%,#0b5ed7 19%,#dff4ff 42%,#f7fcff 78%,#fff 100%)}
        .grdLoginHero:after{content:"";position:absolute;left:-8%;right:-8%;bottom:82px;height:170px;border-radius:50% 50% 0 0/100% 100% 0 0;background:linear-gradient(180deg,#ffffff00,#ffffffee 60%,#fff);box-shadow:0 -8px 0 #39a852}
        .grdLogo{position:relative;z-index:5;display:flex;align-items:center;justify-content:center;gap:16px;color:#fff}
        .grdLogoMark{width:58px;height:58px;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:4px}
        .grdLogoBar{width:10px;border-radius:3px 3px 0 0;transform:skewY(-22deg);box-shadow:0 4px 9px #001b3d55}
        .grdLogoBar.one{height:34px;background:#0b7fe3}.grdLogoBar.two{height:45px;background:#22b86f}.grdLogoBar.three{height:55px;background:#fff}
        .grdLogoArrow{position:absolute;width:25px;height:7px;background:#7bdc42;right:0;top:7px;transform:rotate(-38deg);border-radius:6px}
        .grdLogoArrow:after{content:"";position:absolute;right:-2px;top:-5px;border-left:10px solid #7bdc42;border-top:8px solid transparent;border-bottom:8px solid transparent}
        .grdLogoText{text-align:center}.grdLogoText strong{display:block;font-size:clamp(34px,5vw,64px);letter-spacing:.025em;color:#fff;font-weight:900;text-shadow:0 3px 8px #001b3d66}.grdLogoText span{display:block;font-size:clamp(10px,1.1vw,15px);font-weight:800;color:#fff;letter-spacing:.13em;margin-top:3px}
        .grdHeroCopy{position:relative;z-index:3;margin:24px auto 0;max-width:780px;text-align:center}.grdHeroCopy h1{font-size:clamp(30px,4vw,56px);line-height:1.05;margin:0;font-weight:900;color:#fff}.grdHeroCopy h1 em{font-style:normal;color:#73df43}.grdHeroCopy p{font-size:14px;line-height:1.55;color:#eaf8ff;max-width:600px;margin:10px auto}.grdEvTag{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;background:#ffffff18;color:#d9ffd0;border:1px solid #ffffff44;font-size:10px;font-weight:850;letter-spacing:.09em}.grdAccentLine{width:70px;height:4px;border-radius:99px;background:linear-gradient(90deg,#1687e8,#20a866);margin:14px auto 0}
        .grdHeroFeatures{position:absolute;z-index:4;left:50%;bottom:102px;transform:translateX(-50%);display:flex;gap:48px;justify-content:center}.grdFeature{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:105px}.grdFeatureIcon{width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #0b5ed7;box-shadow:0 4px 15px #0b5ed722;display:grid;place-items:center;font-size:18px}.grdFeature strong{font-size:11px;color:#0b4ea2}.grdFeature span{font-size:10px;color:#526b7a}
        .grdLoginPanel{position:absolute;z-index:10;left:50%;top:53%;transform:translate(-50%,-50%);width:min(470px,calc(100vw - 36px));padding:28px;background:#ffffffee;border:1px solid #fff;border-radius:28px;box-shadow:0 24px 70px #08386b33;backdrop-filter:blur(10px)}
        .grdLoginCard{width:100%}.grdModeBadge{display:block;width:max-content;margin:0 auto;border-radius:999px;background:#e7f5ee;color:#0b5ed7;padding:6px 12px;font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.grdLoginTitle{text-align:center;font-size:29px;line-height:1.15;margin:13px 0 7px;font-weight:900;color:#102a43}.grdLoginTitle em{font-style:normal;color:#159447}.grdLoginSub{text-align:center;margin:0 0 17px;color:#607789;font-size:12px;line-height:1.45}.grdDivider{height:1px;background:#dceaf2;margin-bottom:15px}.grdTabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.grdTab{height:42px;border:1px solid #cfe3ee;background:#fff;border-radius:10px;color:#40566a;font-weight:800;font-size:12px}.grdTab.active{background:linear-gradient(90deg,#0b7fe3,#20a866);border-color:transparent;color:#fff;box-shadow:0 7px 18px #0b5ed71c}.grdField{margin-top:12px}.grdField label{display:block;font-size:11px;font-weight:800;color:#17324d;margin-bottom:6px}.grdInputWrap{position:relative}.grdInput{width:100%;height:50px;border:1px solid #b8cfe0;border-radius:12px;background:#fff;color:#17324d;padding:0 43px 0 42px;outline:none}.grdInput:focus{border-color:#0b7fe3;box-shadow:0 0 0 3px #0b5ed718}.grdInputIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}.grdEye{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#607789;padding:7px}.grdForgot{text-align:right;margin:8px 0 0}.grdForgot button{border:0;background:none;color:#0b5ed7;font-weight:800;font-size:11px;padding:0}.grdLoginBtn{width:100%;height:50px;border:0;border-radius:12px;margin-top:17px;color:#fff;font-weight:900;background:linear-gradient(90deg,#087cf0,#21b968);box-shadow:0 10px 25px #0b5ed733}.grdLoginBtn:disabled{opacity:.65;cursor:not-allowed}.grdHelp{display:flex;justify-content:center;gap:5px;margin-top:12px;color:#607789;font-size:10px;text-align:center}.grdHelp strong{color:#0b5ed7}.grdSecure{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:16px;color:#718694;font-size:10px}.grdError{color:#b42318;background:#fff1f2;border:1px solid #fecdd3;padding:10px;border-radius:9px;margin:10px 0;font-size:12px}.grdOtpNote{text-align:center;font-size:12px;color:#607789;margin:12px 0}
        .grdSocials{position:absolute;z-index:6;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap;width:90%}.grdSocialLink{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid #b9d6e8;border-radius:10px;background:#fff;color:#0b4ea2;text-decoration:none;font-size:10px;font-weight:850;box-shadow:0 4px 14px #0b5ed71a}.grdSocialIcon{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:14px;color:#fff;font-weight:900}.grdSocialIcon.insta{background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af)}.grdSocialIcon.fb{background:#1877f2}.grdSocialIcon.web{background:linear-gradient(135deg,#0b5ed7,#159447)}.grdSocialIcon.map{background:#fff;color:#4285f4;border:1px solid #dbe7f2}
        @media(max-width:850px){.grdLoginHero{padding:22px 20px 170px}.grdLogoText strong{font-size:32px}.grdLogoText span{font-size:9px}.grdHeroCopy{margin-top:18px}.grdHeroCopy p{font-size:12px}.grdLoginPanel{top:54%;padding:22px;border-radius:22px}.grdHeroFeatures{gap:15px;bottom:108px}.grdFeature{min-width:80px}.grdFeatureIcon{width:34px;height:34px}.grdSocials{bottom:18px;width:96%}}
        @media(max-width:520px){.grdLoginHero{min-height:100vh;padding-bottom:185px}.grdLogo{gap:8px}.grdLogoMark{transform:scale(.72)}.grdLogoText strong{font-size:25px}.grdHeroCopy h1{font-size:29px}.grdHeroCopy p{display:none}.grdLoginPanel{top:52%;width:calc(100vw - 24px);padding:18px}.grdLoginTitle{font-size:24px}.grdHeroFeatures{display:none}.grdSocials{gap:5px}.grdSocialLink{padding:6px 7px;font-size:9px}.grdSocialIcon{width:21px;height:21px}}
      `}</style>
      <section className="grdLoginHero">
        <div className="grdLogo">
          <div className="grdLogoMark" aria-hidden="true"><span className="grdLogoBar one"/><span className="grdLogoBar two"/><span className="grdLogoBar three"/><span className="grdLogoArrow"/></div>
          <div className="grdLogoText"><strong>G.R.D. MOTORS</strong><span>MANUFACTURER OF E-RICKSHAW &amp; E-CART</span></div>
        </div>
        <div className="grdHeroCopy">
          <h1>Powering Your <em>EV Journey</em></h1>
          <p>Reliable electric mobility, trusted service and smart business management — all in one secure G.R.D. Motors system.</p>
          <div className="grdEvTag"><span>⚡</span> CLEAN · GREEN · FUTURE READY</div><div className="grdAccentLine"/>
        </div>
        <div className="grdHeroFeatures">
          <div className="grdFeature"><div className="grdFeatureIcon">🌿</div><strong>ZERO EMISSION</strong><span>Clean Mobility</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">⚡</div><strong>COST EFFECTIVE</strong><span>Smart EV</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">🛡️</div><strong>RELIABLE</strong><span>Performance</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">🇮🇳</div><strong>MAKE IN INDIA</strong><span>Future Ready</span></div>
        </div>
        <div className="grdSocials" aria-label="G.R.D. Motors links">
          <a className="grdSocialLink" href={'https://' + 'www.instagram.com/grdmotorsofficial/'} target="_blank" rel="noreferrer"><span className="grdSocialIcon insta">◎</span><span>Instagram</span></a>
          <a className="grdSocialLink" href={'https://' + 'www.facebook.com/davratherickshaw/'} target="_blank" rel="noreferrer"><span className="grdSocialIcon fb">f</span><span>Facebook</span></a>
          <a className="grdSocialLink" href={'https://' + 'davrath.com/'} target="_blank" rel="noreferrer"><span className="grdSocialIcon web">⌂</span><span>Website</span></a>
          <a className="grdSocialLink" href={'https://' + 'maps.app.goo.gl/6zKJLUG7Yyf28dKT8'} target="_blank" rel="noreferrer"><span className="grdSocialIcon map">●</span><span>Google Maps</span></a>
        </div>
      </section>

      <section className="grdLoginPanel">
        <div className="grdLoginCard">
          <div className="grdModeBadge">ADMIN · STAFF · DEALER · CUSTOMER</div>
          <h2 className="grdLoginTitle">{otpToken ? <>Verify <em>OTP</em></> : <>Welcome <em>Back!</em></>}</h2>
          <p className="grdLoginSub">{otpToken ? 'Enter the OTP sent for secure staff verification.' : 'Login to access your G.R.D. Motors account — you will land on your own dashboard automatically.'}</p>
          <div className="grdDivider" />

          {!otpToken ? (
            <form onSubmit={submit}>
              <div className="grdTabs">
                <button type="button" className={'grdTab'+(mode === 'staff' ? ' active' : '')} onClick={() => { setMode('staff'); setUserid(''); setError(''); }}>🔒 Password Login</button>
                <button type="button" className={'grdTab'+(mode === 'dealer' ? ' active' : '')} onClick={() => { setMode('dealer'); setUserid(''); setError(''); }}>▣ Dealer Login</button>
              </div>
              {error && <div className="grdError">{error}</div>}
              <div className="grdField">
                <label>{mode === 'dealer' ? 'Dealer ID' : 'Username / Mobile number'}</label>
                <div className="grdInputWrap">
                  <span className="grdInputIcon">👤</span>
                  <input className="grdInput" value={userid} onChange={e => setUserid(e.target.value)} autoFocus required placeholder={mode === 'dealer' ? 'Enter Dealer ID' : 'Enter username or mobile number'} />
                </div>
              </div>
              <div className="grdField">
                <label>Password</label>
                <div className="grdInputWrap">
                  <span className="grdInputIcon">🔐</span>
                  <input className="grdInput" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter password" />
                  <button type="button" className="grdEye" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? '◉' : '◌'}</button>
                </div>
              </div>
              <div className="grdForgot"><button type="button">Forgot Password?</button></div>
              <button className="grdLoginBtn" disabled={busy}>{busy ? 'Checking…' : '→ Login'}</button>
              <div className="grdHelp">Dealer? Use <strong>Dealer Login</strong> tab above · Customer login is available through the customer portal.</div>
              <div className="grdSecure">🔐 Your data is safe and secure with G.R.D. Motors.</div>
            </form>
          ) : (
            <form onSubmit={verify}>
              {error && <div className="grdError">{error}</div>}
              <div className="grdField">
                <label>OTP</label>
                <div className="grdInputWrap">
                  <span className="grdInputIcon">🔢</span>
                  <input className="grdInput" inputMode="numeric" maxLength={4} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus required placeholder="Enter 4 digit OTP" />
                </div>
              </div>
              <div className="grdOtpNote">Temporary OTP for testing: <b>1234</b></div>
              <button className="grdLoginBtn" disabled={busy}>{busy ? 'Verifying…' : '✓ Verify & Login'}</button>
              <button type="button" className="btn" style={{width:'100%',marginTop:9}} onClick={() => { setOtpToken(''); setOtp(''); setError(''); }}>← Back</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

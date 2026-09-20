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
      <style>{`
        .grdLoginPage{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#fff;color:#102a43}
        .grdLoginHero{position:relative;min-height:100vh;padding:58px 7vw 48px;background:linear-gradient(135deg,#eef8ff 0%,#e7f7ee 52%,#fff 100%);overflow:hidden;display:flex;flex-direction:column}
        .grdLoginHero:before{content:"";position:absolute;width:520px;height:520px;border-radius:50%;background:#1e88e515;right:-220px;top:-180px}
        .grdLoginHero:after{content:"";position:absolute;width:360px;height:360px;border-radius:50%;background:#39a85218;left:-220px;bottom:-220px}
        .grdLogo{position:relative;z-index:1;display:flex;align-items:center;gap:12px}
        .grdLogoMark{width:58px;height:58px;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:4px}
        .grdLogoBar{width:10px;border-radius:3px 3px 0 0;transform:skewY(-22deg);box-shadow:0 4px 9px #7d1b2a20}
        .grdLogoBar.one{height:34px;background:#1687e8}.grdLogoBar.two{height:45px;background:#16a56b}.grdLogoBar.three{height:55px;background:#0b4ea2}
        .grdLogoArrow{position:absolute;width:25px;height:7px;background:#0b4ea2;right:0;top:7px;transform:rotate(-38deg);border-radius:6px}
        .grdLogoArrow:after{content:"";position:absolute;right:-2px;top:-5px;border-left:10px solid #0b4ea2;border-top:8px solid transparent;border-bottom:8px solid transparent}
        .grdLogoText strong{display:block;font-size:20px;letter-spacing:.04em;color:#0b4ea2}
        .grdLogoText span{display:block;font-size:11px;font-weight:700;color:#16a56b;letter-spacing:.11em;margin-top:2px}
        .grdHeroCopy{position:relative;z-index:1;margin-top:76px;max-width:520px}
        .grdHeroCopy h1{font-size:clamp(38px,4.2vw,62px);line-height:1.04;margin:0;font-weight:850;letter-spacing:-.035em;color:#102a43}
        .grdHeroCopy h1 em{font-style:normal;color:#159447}
        .grdHeroCopy p{font-size:16px;line-height:1.7;color:#526b7a;max-width:450px;margin:22px 0 0}
        .grdAccentLine{width:54px;height:4px;border-radius:99px;background:linear-gradient(90deg,#0b5ed7,#20a866);margin-top:25px}
        .grdHeroFeatures{position:relative;z-index:1;display:flex;gap:34px;margin-top:auto;padding-top:50px}
        .grdFeature{display:flex;flex-direction:column;gap:7px}
        .grdFeatureIcon{width:34px;height:34px;border-radius:10px;background:#fff;box-shadow:0 4px 15px #0b5ed714;display:grid;place-items:center;font-size:16px}
        .grdFeature strong{font-size:12px;color:#17324d}.grdFeature span{font-size:11px;color:#667b8c}
        .grdLoginPanel{display:flex;align-items:center;justify-content:center;padding:40px 7vw;background:#fff}
        .grdLoginCard{width:min(455px,100%)}
        .grdModeBadge{display:inline-flex;border-radius:999px;background:#e7f5ee;color:#1687e8;padding:7px 13px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
        .grdLoginTitle{font-size:30px;line-height:1.15;margin:17px 0 8px;font-weight:850;color:#102a43}
        .grdLoginTitle em{font-style:normal;color:#ed6f22}
        .grdLoginSub{margin:0 0 24px;color:#74666a;font-size:13px;line-height:1.55}
        .grdDivider{height:1px;background:#f0e4df;margin-bottom:20px}
        .grdTabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:22px}
        .grdTab{height:42px;border:1px solid #cfe3ee;background:#fff;border-radius:10px;color:#40566a;font-weight:750;font-size:12px}
        .grdTab.active{background:linear-gradient(90deg,#0b7fe3,#159447);border-color:transparent;color:#fff;box-shadow:0 7px 18px #0b5ed71c}
        .grdField{margin-top:13px}
        .grdField label{display:block;font-size:12px;font-weight:750;color:#17324d;margin-bottom:7px}
        .grdInputWrap{position:relative}
        .grdInput{width:100%;height:48px;border:1px solid #cfe0eb;border-radius:10px;background:#f7faff;color:#17324d;padding:0 43px 0 42px;outline:none;box-shadow:inset 0 1px 2px #00000004}
        .grdInput:focus{border-color:#0b7fe3;box-shadow:0 0 0 3px #0b7fe318}
        .grdInputIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}
        .grdEye{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#607789;padding:7px}
        .grdForgot{text-align:right;margin:9px 0 0}
        .grdForgot button{border:0;background:none;color:#0b5aa8;font-weight:750;font-size:11px;padding:0}
        .grdLoginBtn{width:100%;height:45px;border:0;border-radius:10px;margin-top:20px;color:#fff;font-weight:800;background:linear-gradient(90deg,#0b7fe3,#0b5aa8);box-shadow:0 8px 20px #0b5aa820}
        .grdLoginBtn:disabled{opacity:.65;cursor:not-allowed}
        .grdHelp{display:flex;justify-content:center;gap:5px;margin-top:17px;color:#74666a;font-size:11px;text-align:center}
        .grdHelp strong{color:#0b5aa8}
        .grdSecure{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:22px;color:#8b7a7f;font-size:11px}
        .grdError{color:#b42318;background:#fff1f2;border:1px solid #fecdd3;padding:10px;border-radius:9px;margin:10px 0;font-size:12px}
        .grdOtpNote{text-align:center;font-size:12px;color:#74666a;margin:12px 0}

        .grdSocials{position:relative;z-index:2;display:flex;align-items:center;gap:10px;margin-top:28px;flex-wrap:wrap}
        .grdSocialLink{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #cfe3ee;border-radius:12px;background:#ffffffd9;color:#0b4ea2;text-decoration:none;font-size:11px;font-weight:800;box-shadow:0 5px 16px #0b5ed70d;transition:.18s}
        .grdSocialLink:hover{transform:translateY(-2px);border-color:#8cc8e8;box-shadow:0 8px 20px #0b5ed71a}
        .grdSocialIcon{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:14px;color:#fff;font-weight:900}
        .grdSocialIcon.insta{background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af)}
        .grdSocialIcon.fb{background:#1877f2}
        .grdSocialIcon.web{background:linear-gradient(135deg,#0b5ed7,#159447)}
        .grdSocialIcon.map{background:#fff;color:#4285f4;border:1px solid #dbe7f2}

        @media(max-width:850px){.grdLoginPage{grid-template-columns:1fr}.grdLoginHero{min-height:330px;padding:28px 28px 30px}.grdHeroCopy{margin-top:35px}.grdHeroCopy h1{font-size:38px}.grdHeroFeatures{padding-top:35px;gap:22px}.grdLoginPanel{padding:38px 24px 50px}}
        @media(max-width:520px){.grdLoginHero{min-height:300px}.grdHeroFeatures{display:none}.grdLoginPanel{padding:30px 18px 40px}.grdLoginTitle{font-size:27px}}
      `}</style>

      <section className="grdLoginHero">
        <div className="grdLogo">
          <div className="grdLogoMark" aria-hidden="true">
            <span className="grdLogoBar one" />
            <span className="grdLogoBar two" />
            <span className="grdLogoBar three" />
            <span className="grdLogoArrow" />
          </div>
          <div className="grdLogoText">
            <strong>G.R.D. MOTORS</strong>
            <span>POWERING YOUR RIDE</span>
          </div>
        </div>

        <div className="grdHeroCopy">
          <h1>Powering Your <em>EV Journey</em></h1>
          <p>Electric mobility, trusted service and smart business management — all in one secure G.R.D. Motors system.</p>
          <div className="grdEvTag"><span>⚡</span> CLEAN · GREEN · ELECTRIC MOBILITY</div><div className="grdAccentLine" />
        </div>

        <div className="grdHeroFeatures">
          <div className="grdFeature"><div className="grdFeatureIcon">🌿</div><strong>Secure</strong><span>Your Data</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">⚡</div><strong>Trusted</strong><span>By Thousands</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">🔋</div><strong>Growth</strong><span>With Us</span></div>
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

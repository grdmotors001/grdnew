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
        .grdLoginPage{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#fff;color:#24151b}
        .grdLoginHero{position:relative;min-height:100vh;padding:58px 7vw 48px;background:linear-gradient(135deg,#fff7f0 0%,#fde9dd 52%,#fff 100%);overflow:hidden;display:flex;flex-direction:column}
        .grdLoginHero:before{content:"";position:absolute;width:520px;height:520px;border-radius:50%;background:#f47a2312;right:-220px;top:-180px}
        .grdLoginHero:after{content:"";position:absolute;width:360px;height:360px;border-radius:50%;background:#8d183011;left:-220px;bottom:-220px}
        .grdLogo{position:relative;z-index:1;display:flex;align-items:center;gap:12px}
        .grdLogoMark{width:58px;height:58px;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:4px}
        .grdLogoBar{width:10px;border-radius:3px 3px 0 0;transform:skewY(-22deg);box-shadow:0 4px 9px #7d1b2a20}
        .grdLogoBar.one{height:34px;background:#f47a23}.grdLogoBar.two{height:45px;background:#ed4f22}.grdLogoBar.three{height:55px;background:#9c1f2b}
        .grdLogoArrow{position:absolute;width:25px;height:7px;background:#9c1f2b;right:0;top:7px;transform:rotate(-38deg);border-radius:6px}
        .grdLogoArrow:after{content:"";position:absolute;right:-2px;top:-5px;border-left:10px solid #9c1f2b;border-top:8px solid transparent;border-bottom:8px solid transparent}
        .grdLogoText strong{display:block;font-size:20px;letter-spacing:.04em;color:#7e1728}
        .grdLogoText span{display:block;font-size:11px;font-weight:700;color:#f07822;letter-spacing:.11em;margin-top:2px}
        .grdHeroCopy{position:relative;z-index:1;margin-top:76px;max-width:520px}
        .grdHeroCopy h1{font-size:clamp(38px,4.2vw,62px);line-height:1.04;margin:0;font-weight:850;letter-spacing:-.035em;color:#20131a}
        .grdHeroCopy h1 em{font-style:normal;color:#e96d22}
        .grdHeroCopy p{font-size:16px;line-height:1.7;color:#6d5b60;max-width:450px;margin:22px 0 0}
        .grdAccentLine{width:54px;height:4px;border-radius:99px;background:linear-gradient(90deg,#7d1729,#ef7422);margin-top:25px}
        .grdHeroFeatures{position:relative;z-index:1;display:flex;gap:34px;margin-top:auto;padding-top:50px}
        .grdFeature{display:flex;flex-direction:column;gap:7px}
        .grdFeatureIcon{width:34px;height:34px;border-radius:10px;background:#fff;box-shadow:0 4px 15px #6e1b2a12;display:grid;place-items:center;font-size:16px}
        .grdFeature strong{font-size:12px;color:#2b1a20}.grdFeature span{font-size:11px;color:#806f74}
        .grdLoginPanel{display:flex;align-items:center;justify-content:center;padding:40px 7vw;background:#fff}
        .grdLoginCard{width:min(455px,100%)}
        .grdModeBadge{display:inline-flex;border-radius:999px;background:#fcede4;color:#e66d22;padding:7px 13px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
        .grdLoginTitle{font-size:30px;line-height:1.15;margin:17px 0 8px;font-weight:850;color:#24151b}
        .grdLoginTitle em{font-style:normal;color:#ed6f22}
        .grdLoginSub{margin:0 0 24px;color:#74666a;font-size:13px;line-height:1.55}
        .grdDivider{height:1px;background:#f0e4df;margin-bottom:20px}
        .grdTabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:22px}
        .grdTab{height:42px;border:1px solid #efdcd4;background:#fff;border-radius:10px;color:#5d4d52;font-weight:750;font-size:12px}
        .grdTab.active{background:linear-gradient(90deg,#ef7624,#8f1a2d);border-color:transparent;color:#fff;box-shadow:0 7px 18px #9b24301c}
        .grdField{margin-top:13px}
        .grdField label{display:block;font-size:12px;font-weight:750;color:#291b20;margin-bottom:7px}
        .grdInputWrap{position:relative}
        .grdInput{width:100%;height:48px;border:1px solid #eadbd5;border-radius:10px;background:#f7faff;color:#2c2024;padding:0 43px 0 42px;outline:none;box-shadow:inset 0 1px 2px #00000004}
        .grdInput:focus{border-color:#ef7624;box-shadow:0 0 0 3px #ef762418}
        .grdInputIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px}
        .grdEye{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#75676b;padding:7px}
        .grdForgot{text-align:right;margin:9px 0 0}
        .grdForgot button{border:0;background:none;color:#8e182b;font-weight:750;font-size:11px;padding:0}
        .grdLoginBtn{width:100%;height:45px;border:0;border-radius:10px;margin-top:20px;color:#fff;font-weight:800;background:linear-gradient(90deg,#ef7624,#8e182b);box-shadow:0 8px 20px #8e182b20}
        .grdLoginBtn:disabled{opacity:.65;cursor:not-allowed}
        .grdHelp{display:flex;justify-content:center;gap:5px;margin-top:17px;color:#74666a;font-size:11px;text-align:center}
        .grdHelp strong{color:#8e182b}
        .grdSecure{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:22px;color:#8b7a7f;font-size:11px}
        .grdError{color:#a51e2d;background:#fff1f2;border:1px solid #fecdd3;padding:10px;border-radius:9px;margin:10px 0;font-size:12px}
        .grdOtpNote{text-align:center;font-size:12px;color:#74666a;margin:12px 0}
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
          <h1>Powering Your <em>Journey</em></h1>
          <p>Reliable mobility solutions, trusted service and smart business management — all in one secure G.R.D. Motors system.</p>
          <div className="grdAccentLine" />
        </div>

        <div className="grdHeroFeatures">
          <div className="grdFeature"><div className="grdFeatureIcon">🛡️</div><strong>Secure</strong><span>Your Data</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">👥</div><strong>Trusted</strong><span>By Thousands</span></div>
          <div className="grdFeature"><div className="grdFeatureIcon">📈</div><strong>Growth</strong><span>With Us</span></div>
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

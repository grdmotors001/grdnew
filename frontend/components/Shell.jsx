'use client';
import { useEffect, useState } from 'react';
import { get, post, setToken } from '../lib/api';
import { NAV_GROUPS, SHOWROOM_SECTIONS, groupForKey, labelFor, buildNavGroups } from '../lib/menu';
import { THEMES, useTheme } from '../lib/theme';
import { ChatWidget } from './ChatWidget';
import {
  LayoutDashboard, Building2, Users, Package, BatteryCharging, Landmark, HandCoins,
  FlaskConical, Wrench, UserCog, Sliders, Banknote, ShoppingCart, Factory,
  Truck, Receipt, Car, BookOpen, Warehouse, Store, Boxes, ClipboardList, FileText,
  BarChart3, Wallet, Gift, Calendar, Key, Database, LogOut, ChevronLeft, ChevronRight,
  Palette, CreditCard, Settings2, MessageCircle,
} from 'lucide-react';

// Lookup used to resolve an admin-picked icon name (stored as a plain
// string on a NavTab, see lib/menu.js NAV_ICON_NAMES) back to the actual
// lucide-react component, for custom sidebar tabs.
const ICON_BY_NAME = {
  LayoutDashboard, Building2, Users, Package, BatteryCharging, Landmark, HandCoins,
  FlaskConical, Wrench, UserCog, Sliders, Banknote, ShoppingCart, Factory,
  Truck, Receipt, Car, BookOpen, Warehouse, Store, Boxes, ClipboardList, FileText,
  BarChart3, Wallet, Gift, Calendar, Key, Database, Palette, CreditCard, Settings2,
  MessageCircle,
};

// Icon per menu key — mirrors MENU's grouping in lib/menu.js so the sidebar
// (collapsed or expanded) always has a matching icon for every item.

const GROUP_ICONS = {
  Masters: Sliders,
  Factory: Factory,
  Battery: BatteryCharging,
  'Sales & Billing': Receipt,
  Expenses: Wallet,
  Accounts: CreditCard,
  Inventory: Warehouse,
  HR: Users,
  Reports: BarChart3,
  System: Settings2,
};

const ICONS = {
  dealer: Building2, party: Users, product: Package, 'chassis-master': Car, 'battery-maker': BatteryCharging,
  rto: Landmark, financer: HandCoins, 'production-formula': FlaskConical, mechanic: Wrench,
  user: UserCog, 'option-setting': Sliders, bank: Banknote, colour: Palette,
  'purchase-bills': ShoppingCart, 'billing-pending-sales': Wallet, 'production-voucher': Factory, 'delivery-challan': Truck,
  'tax-invoice': Receipt, 'old-rickshaw': Car, 'battery-delivery-challan': BatteryCharging,
  'journal-stock': BookOpen, 'cash-at-dealer': Wallet, 'dealer-cash-receipt': Wallet,
  'repair-service-voucher': Wrench, 'old-rickshaw-challan': Truck, 'vahan-inventory': ClipboardList,
  'closing-stock-premises': Warehouse, 'closing-stock-dealers': Store, 'closing-stock-raw': Boxes,
  'stock-ledger-premises': ClipboardList, 'stock-ledger-dealers': ClipboardList,
  'loan-workflow': ClipboardList, 'loan-application-view': ClipboardList,
  'purchase-register': FileText, 'production-register': FileText, 'delivery-challan-register': FileText,
  'sale-register': BarChart3, 'gst-register': FileText, 'hypothecation-register': FileText,
  'payment-receivable-report': Wallet, 'subsidy-report': Gift, ledger: BookOpen,
  'day-book': Calendar, 'ledger-v': BookOpen, password: Key,
  'backup-restore': Database, 'hr-attendance': Users, profile: UserCog,
  'nav-settings': Settings2,
};

export function Login({ onLogin }) {
  const [mode, setMode] = useState('staff');
  const [userid, setUserid] = useState('');
  const [password, setPassword] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const data = await post(mode === 'dealer' ? '/auth/dealer-login' : '/auth/login', { userid, password });
      if (mode === 'dealer') { setToken(data.token); onLogin({ ...data.dealer, is_dealer: true }); }
      else setOtpToken(data.otp_token);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { const data = await post('/auth/verify-otp', { otp_token: otpToken, otp }); setToken(data.token); onLogin(data.user); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return <div className="login">
    <div className="loginbox" style={{maxWidth:430}}>
      <div style={{textAlign:'center',marginBottom:22}}>
        <div style={{width:64,height:64,borderRadius:18,margin:'0 auto 12px',display:'grid',placeItems:'center',fontSize:30,fontWeight:800,background:'var(--accent)',color:'#fff',boxShadow:'0 10px 30px rgba(37,99,235,.22)'}}>G</div>
        <h1 style={{marginBottom:5}}>G.R.D. MOTORS</h1>
        <p className="muted">{otpToken ? 'Secure OTP Verification' : mode === 'dealer' ? 'Dealer Portal' : 'eBill Management System'}</p>
      </div>
      {!otpToken ? <form onSubmit={submit}>
        <div className="loginModes"><button type="button" className={'btn'+(mode==='staff'?' primary':'')} onClick={()=>{setMode('staff');setUserid('')}}>Staff Login</button><button type="button" className={'btn'+(mode==='dealer'?' primary':'')} onClick={()=>{setMode('dealer');setUserid('')}}>Dealer Login</button></div>
        {error&&<div className="error">{error}</div>}
        <div className="field"><label>{mode==='dealer'?'Dealer ID':'Username / Mobile No.'}</label><input value={userid} onChange={e=>setUserid(e.target.value)} autoFocus required placeholder={mode==='dealer'?'Enter Dealer ID':'Enter username or mobile number'}/></div>
        <div className="field" style={{marginTop:12}}><label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter password"/></div>
        <button className="btn primary" style={{width:'100%',marginTop:18}} disabled={busy}>{busy?'Checking…':'Continue →'}</button>
      </form> : <form onSubmit={verify}>
        {error&&<div className="error">{error}</div>}
        <div className="field"><label>OTP</label><input inputMode="numeric" maxLength={4} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus required placeholder="Enter 4 digit OTP"/></div>
        <p className="muted" style={{fontSize:12,marginTop:10}}>Temporary OTP for testing: <b>1234</b></p>
        <button className="btn primary" style={{width:'100%',marginTop:14}} disabled={busy}>{busy?'Verifying…':'Verify & Login'}</button>
        <button type="button" className="btn" style={{width:'100%',marginTop:8}} onClick={()=>{setOtpToken('');setOtp('');setError('')}}>← Back</button>
      </form>}
    </div>
  </div>;
}
function NavItem({ icon: Icon, label, active, collapsed, onClick }) {
  return (<button
      className={'navbtn' + (active ? ' active' : '')}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <Icon size={17} className="navicon" />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

export function Shell({ active, setActive, user, onLogout, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { themeId, changeTheme } = useTheme();
  const [showPalette, setShowPalette] = useState(false);
  const [pendingTheme, setPendingTheme] = useState(themeId);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({});
  const [myAttendance, setMyAttendance] = useState(null);
  const [attendanceMonth, setAttendanceMonth] = useState(new Date().toISOString().slice(0,7));
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  // Admin-configured tabs from Menu / Tabs Settings, if any have been set
  // up (Setup > Menu / Tabs Settings). Falls back to the static NAV_GROUPS
  // layout from lib/menu.js until an admin actually creates one.
  const [customTabs, setCustomTabs] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    get('/nav-config').then((d) => setCustomTabs(d?.custom ? d.tabs : null)).catch(() => setCustomTabs(null));
  }, []);
  const builtNav = buildNavGroups(customTabs);
  const navGroups = { ...builtNav.groups };
  const iconByGroup = { ...builtNav.iconByGroup };
  const isAdmin = !!user?.is_super_user || String(user?.department || '').trim().toLowerCase() === 'admin';
  if (isAdmin && !Object.values(navGroups).flat().some(([key]) => key === 'loan-application-view')) {
    const targetGroup = navGroups['Sales & Billing'] ? 'Sales & Billing' : 'Loan Applications';
    navGroups[targetGroup] = [...(navGroups[targetGroup] || []), ['loan-application-view', 'Loan Application']];
  }

  useEffect(() => { setPendingTheme(themeId); }, [themeId]);

  const selectMenu = (key) => { setActive(key); setMobileMenu(false); setCollapsed(false); };

  const selectTheme = (id) => setPendingTheme(id);
  const applySelectedTheme = () => { changeTheme(pendingTheme); setShowPalette(false); };

  // Remember the collapsed/expanded state across reloads.
  useEffect(() => {
    const saved = window.localStorage.getItem('ebill_sidebar_collapsed');
    if (saved === '1') setCollapsed(true);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      window.localStorage.setItem('ebill_sidebar_collapsed', !c ? '1' : '0');
      return !c;
    });
  };

  const initial = (user?.username || '?').charAt(0).toUpperCase();
  const activeGroup = customTabs
    ? (Object.entries(navGroups).find(([, items]) => items.some(([key]) => key === active))?.[0] || 'Dashboard')
    : groupForKey(active);
  const groupItems = activeGroup === 'Dashboard' ? [] : (navGroups[activeGroup] || []);
  const allowedFor = (items) => user?.is_super_user ? items : items.filter(([key]) => key === 'loan-application-view' ? String(user?.department || '').trim().toLowerCase() === 'admin' : (user?.allowed_modules || []).includes(key));

  return (
    <div className="app">
      <style>{`
        .showroomModuleStrip{display:flex;align-items:stretch;gap:8px;overflow-x:auto;padding:4px 2px}
        .showroomModuleGroup{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}
        .showroomModuleLabel{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#6b7c90;padding:0 5px}
        .showroomModuleItems{display:flex;gap:3px}
        .showroomModuleItems .moduleStripItem{white-space:nowrap}
        @media(max-width:900px){.showroomModuleStrip{max-width:100%;padding-bottom:5px}.showroomModuleGroup{min-width:max-content}}
      `}</style>
      <div className="mobileAdminTop"><button onClick={() => setMobileMenu(true)} aria-label="Open menu">☰</button><div><strong>G.R.D. MOTORS</strong><small>eBill Management System</small></div></div>
      {mobileMenu && <button className="mobileMenuBackdrop" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
      {profileOpen && <div className="modal"><div className="modalbox profileBox" style={{maxWidth:760}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><div><h2>My Staff Profile</h2><p className="muted">Profile aur monthly attendance ek hi jagah.</p></div><button type="button" className="btn" onClick={()=>setProfileOpen(false)}>Close</button></div><div className="card" style={{marginTop:14}}><div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>{myAttendance?.employee?.photo_url ? <img src={myAttendance.employee.photo_url} alt="Staff" style={{width:76,height:76,borderRadius:18,objectFit:'cover',border:'1px solid var(--border)'}}/> : <div className="sidebarAvatar" style={{width:76,height:76,fontSize:28}}>{initial}</div>}<div><h3 style={{margin:0}}>{myAttendance?.employee?.name || user?.username}</h3><div className="muted">{myAttendance?.employee?.designation || user?.department || 'Staff'} · {myAttendance?.employee?.employee_code || 'Employee'}</div><div style={{marginTop:6}}>Date of Joining: <strong>{myAttendance?.employee?.joining_date || 'Not added'}</strong></div></div></div></div>{myAttendance?.employee ? <><div className="formgrid" style={{marginTop:14}}><Field label="Mobile No." value={myAttendance.employee.mobile||user?.mobile||'-'} onChange={()=>{}} disabled /><Field label="Department" value={myAttendance.employee.department||'-'} onChange={()=>{}} disabled /><Field label="Designation" value={myAttendance.employee.designation||'-'} onChange={()=>{}} disabled /><Field label="Date of Joining" value={myAttendance.employee.joining_date||'-'} onChange={()=>{}} disabled /></div><div className="toolbar" style={{marginTop:16}}><div className="field"><label>Attendance Month</label><input type="month" value={attendanceMonth} onChange={async e=>{const m=e.target.value;setAttendanceMonth(m);setAttendanceLoading(true);try{setMyAttendance(await get('/hr/me?month='+m))}catch(err){}finally{setAttendanceLoading(false)}}}/></div></div><div className="formgrid" style={{marginTop:8}}>{[['Present','Present'],['Late','Late'],['Overtime','OT'],['Absent','Absent']].map(([label,key])=>{const a=myAttendance.attendance||[];const val=key==='Present'?a.filter(x=>x.status==='Present').length:key==='Late'?a.filter(x=>Number(x.late_minutes||0)>0).length:key==='OT'?a.reduce((s,x)=>s+Number(x.overtime_hours||0),0).toFixed(2):a.filter(x=>x.status==='Absent').length;return <div className="card" key={key}><div className="muted">{label}</div><strong style={{fontSize:22}}>{val}</strong></div>})}</div><div className="card tableWrap" style={{marginTop:14}}><table className="table reportTable"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Status</th><th>Late</th><th>OT</th></tr></thead><tbody>{(myAttendance.attendance||[]).map(x=><tr key={x.work_date}><td>{x.work_date}</td><td>{x.first_in||'-'}</td><td>{x.last_out||'-'}</td><td>{x.status}</td><td>{Number(x.late_minutes||0)} min</td><td>{Number(x.overtime_hours||0).toFixed(2)} hr</td></tr>)}</tbody></table></div></> : <div className="error" style={{marginTop:14}}>{myAttendance?.message || 'HR profile not linked yet.'}</div>}<div className="actions" style={{marginTop:18}}><button type="button" className="btn" onClick={()=>setProfileOpen(false)}>Close</button></div></div></div>}
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '') + (mobileMenu ? ' mobile-open' : '')}>
        <div className="brand">
          <div className="brandMark"><Car size={24} strokeWidth={2.4} /></div>
          {!collapsed && (
            <div className="brandText">
              <strong>G.R.D. MOTORS</strong>
              <small>RTO Management System</small>
            </div>
          )}
          {!collapsed && (
            <div className="brandActions">
              <div className="themePaletteWrap">
                <button className="themeColorButton" onClick={() => setShowPalette(v => !v)} title="Themes" aria-label="Open themes"><Palette size={14}/></button>
                {showPalette && <div className="themeChooser" role="dialog" aria-label="Choose theme">
                  {THEMES.map(theme => <button key={theme.id} type="button" className={'themeCard'+(pendingTheme===theme.id?' selected':'')} onClick={() => selectTheme(theme.id)}>
                    <span className="themeCardSwatches">{[theme.colors.bg,theme.colors.primary,theme.colors.accent].map(c=><i key={c} style={{background:c}}/>)}</span>
                    <span className="themeCardText"><b>{theme.name}</b><small>{theme.description}</small></span>
                    {pendingTheme===theme.id && <span role="button" className="themeApplyButton" onClick={(e) => { e.stopPropagation(); applySelectedTheme(); }}>Apply</span>}
                  </button>)}
                </div>}
              </div>
              <button className="sidebarToggle" onClick={toggleCollapsed} title="Collapse">
                <ChevronLeft size={15} />
              </button>
            </div>
          )}
        </div>
        {collapsed && (
          <>
            <div className="themePaletteWrap">
              <button className="themeColorButton" onClick={() => setShowPalette(v => !v)} title="Themes" aria-label="Open themes"><Palette size={14}/></button>
              {showPalette && <div className="themeChooser themeChooserCollapsed" role="dialog" aria-label="Choose theme">
                {THEMES.map(theme => <button key={theme.id} type="button" className={'themeCard'+(pendingTheme===theme.id?' selected':'')} onClick={() => selectTheme(theme.id)}>
                  <span className="themeCardSwatches">{[theme.colors.bg,theme.colors.primary,theme.colors.accent].map(c=><i key={c} style={{background:c}}/>)}</span>
                  <span className="themeCardText"><b>{theme.name}</b><small>{theme.description}</small></span>
                  {pendingTheme===theme.id && <span className="themeApplyButton">✓</span>}
                </button>)}
              </div>}
            </div>
            <button className="sidebarExpand" onClick={toggleCollapsed} title="Expand"><ChevronRight size={15}/></button>
          </>
        )}

        <nav className="sidebarNav">
          <NavItem
            icon={LayoutDashboard}
            label="Dashboard"
            active={active === 'dashboard'}
            collapsed={collapsed}
            onClick={() => selectMenu('dashboard')}
          />
          {Object.entries(navGroups).map(([group, items]) => {
            const allowed = allowedFor(items);
            if (!allowed.length) return null;
            const GroupIcon = ICON_BY_NAME[iconByGroup[group]] || GROUP_ICONS[group] || FileText;
            const firstKey = allowed[0]?.[0];
            return (
              <div className="navGroupHead" key={group}>
                <button
                  className={'navGroupButton' + (activeGroup === group ? ' active' : '')}
                  title={collapsed ? group : undefined}
                  onClick={() => {
                    const target = activeGroup === group && allowed.some(([key]) => key === active)
                      ? active
                      : group === 'HR' && allowed.some(([key]) => key === 'hr-attendance')
                        ? 'hr-attendance'
                        : firstKey;
                    if (target) selectMenu(target);
                  }}
                >
                  <GroupIcon size={18} />
                  {!collapsed && <span>{group}</span>}
                  {!collapsed && <span className="navGroupCount">{allowed.length}</span>}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="sidebarFooter">
          <div className="sidebarAvatar">{initial}</div>
          {!collapsed && (
            <div className="sidebarFooterInfo">
              <strong>{user?.username}</strong>
              <button onClick={onLogout}>Log Out</button>
            </div>
          )}
          {collapsed && (
            <button className="sidebarLogoutIcon" onClick={onLogout} title="Log Out">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main className={'main' + (collapsed ? ' mainCollapsed' : '')}>
        <div className="top grdTopHeader">
          <div className="topTitleBlock grdTopTitle">
            <div className="title">{active === 'dashboard' ? 'Dashboard' : activeGroup}</div>
            <div className="subtitle">{active === 'dashboard' ? 'Admin Overview' : labelFor(active)} · {user?.username} · {user?.is_super_user ? 'Super User' : (user?.department || 'Staff')}</div>
          </div>
          {activeGroup === 'Showroom' ? (
            <div className="moduleStrip showroomModuleStrip" aria-label="Showroom">
              {SHOWROOM_SECTIONS.map(section => {
                const items = allowedFor(section.items);
                if (!items.length) return null;
                return (
                  <div className="showroomModuleGroup" key={section.label}>
                    <div className="showroomModuleLabel">{section.label}</div>
                    <div className="showroomModuleItems">
                      {items.map(([key, label]) => (
                        <button key={key} type="button"
                          className={'moduleStripItem' + (active === key ? ' active' : '')}
                          onClick={() => selectMenu(key)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : activeGroup !== 'Dashboard' && groupItems.length > 0 ? (
            <div className="moduleStrip" aria-label={activeGroup}>
              {allowedFor(groupItems).map(([key, label]) => (
                <button key={key} type="button"
                  className={'moduleStripItem' + (active === key ? ' active' : '')}
                  onClick={() => selectMenu(key)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grdHeaderActions">
            <button type="button" className="grdHeaderIcon" title="Office Chat" onClick={() => { if (window.innerWidth <= 700) window.location.href = '/chat'; else setChatOpen((v) => !v); }}><MessageCircle size={18} /></button>
            <button type="button" className="grdHeaderIcon" title="Notifications">🔔<span>3</span></button>
            <div className="grdHeaderUser"><div className="grdHeaderAvatar">{initial}</div><strong>{user?.username || 'admin'}</strong><span>⌄</span></div>
          </div>
        </div>
        {children}
      </main>
      <nav className="adminBottomNav adminBottomNavForce" aria-label="Staff bottom navigation">
        <button type="button" className={active === 'dashboard' ? 'active' : ''} onClick={() => selectMenu('dashboard')}>
          <LayoutDashboard size={18} /><small>Home</small>
        </button>
        <button type="button" onClick={() => setMobileMenu(v => !v)}>
          <span style={{fontSize:18,lineHeight:1}}>☰</span><small>Menu</small>
        </button>
        <button type="button" onClick={() => { window.location.href = '/chat'; }}>
          <MessageCircle size={18} /><small>Chat</small>
        </button>
        <button type="button" className={profileOpen ? 'active' : ''} onClick={() => {
          const saved = window.localStorage.getItem('grd_profile');
          setProfile(saved ? JSON.parse(saved) : {});
          setProfileOpen(true);
          setAttendanceLoading(true);
          get('/hr/me?month='+attendanceMonth).then(setMyAttendance).catch(()=>setMyAttendance(null)).finally(()=>setAttendanceLoading(false));
          setMobileMenu(false);
        }}>
          <Users size={18} /><small>Profile</small>
        </button>
      </nav>
      <ChatWidget open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}

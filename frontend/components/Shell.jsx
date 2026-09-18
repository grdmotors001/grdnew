'use client';
import { useEffect, useState } from 'react';
import { post, setToken } from '../lib/api';
import { MENU, labelFor } from '../lib/menu';
import { useDarkMode } from '../lib/theme';
import {
  LayoutDashboard, Building2, Users, Package, BatteryCharging, Landmark, HandCoins,
  FlaskConical, Wrench, UserCog, Sliders, Banknote, ShoppingCart, Factory,
  Truck, Receipt, Car, BookOpen, Warehouse, Store, Boxes, ClipboardList, FileText,
  BarChart3, Wallet, Gift, Calendar, Key, Database, LogOut, ChevronLeft, ChevronRight,
  Sun, Moon, Palette,
} from 'lucide-react';

// Icon per menu key — mirrors MENU's grouping in lib/menu.js so the sidebar
// (collapsed or expanded) always has a matching icon for every item.
const ICONS = {
  dealer: Building2, party: Users, product: Package, 'chassis-master': Car, 'battery-maker': BatteryCharging,
  rto: Landmark, financer: HandCoins, 'production-formula': FlaskConical, mechanic: Wrench,
  user: UserCog, 'option-setting': Sliders, bank: Banknote, colour: Palette,
  'purchase-bills': ShoppingCart, 'production-voucher': Factory, 'delivery-challan': Truck,
  'tax-invoice': Receipt, 'old-rickshaw': Car, 'battery-delivery-challan': BatteryCharging,
  'journal-stock': BookOpen,
  'closing-stock-premises': Warehouse, 'closing-stock-dealers': Store, 'closing-stock-raw': Boxes,
  'stock-ledger-premises': ClipboardList, 'stock-ledger-dealers': ClipboardList,
  'purchase-register': FileText, 'production-register': FileText, 'delivery-challan-register': FileText,
  'sale-register': BarChart3, 'gst-register': FileText, 'hypothecation-register': FileText,
  'payment-receivable-report': Wallet, 'subsidy-report': Gift, ledger: BookOpen,
  'day-book': Calendar, 'ledger-v': BookOpen, password: Key,
  'backup-restore': Database,
};

export function Login({ onLogin }) {
  const [mode, setMode] = useState('staff');
  const [userid, setUserid] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post(mode === 'dealer' ? '/auth/dealer-login' : '/auth/login', { userid, password });
      setToken(data.token);
      onLogin(mode === 'dealer' ? { ...data.dealer, is_dealer: true } : data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="loginbox" onSubmit={submit}>
        <h1>G.R.D. Motors</h1>
        <p className="muted">{mode === 'dealer' ? 'Dealer Portal' : 'eBill Administration'}</p>
        <div className="loginModes">
          <button type="button" className={'btn' + (mode === 'staff' ? ' primary' : '')} onClick={() => { setMode('staff'); setUserid('admin'); setPassword(''); setError(''); }}>Staff Login</button>
          <button type="button" className={'btn' + (mode === 'dealer' ? ' primary' : '')} onClick={() => { setMode('dealer'); setUserid(''); setPassword(''); setError(''); }}>Dealer Login</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>{mode === 'dealer' ? 'Dealer ID' : 'User ID'}</label>
          <input value={userid} onChange={(e) => setUserid(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, collapsed, onClick }) {
  return (
    <button
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
  const [dark, toggleDark] = useDarkMode();
  const [accent, setAccent] = useState('#2563eb');
  const [showPalette, setShowPalette] = useState(false);

  const palette = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#2563eb', '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
  ];

  useEffect(() => {
    const saved = window.localStorage.getItem('ebill_accent');
    if (saved) {
      setAccent(saved);
      document.documentElement.style.setProperty('--accent', saved);
    } else {
      document.documentElement.style.setProperty('--accent', '#2563eb');
    }
  }, []);

  const changeAccent = (color) => {
    setAccent(color);
    window.localStorage.setItem('ebill_accent', color);
    document.documentElement.style.setProperty('--accent', color);
    setShowPalette(false);
  };

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

  return (
    <div className="app">
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
        <div className="brand">
          <div className="brandMark">G</div>
          {!collapsed && (
            <div className="brandText">
              <strong>G.R.D. MOTORS</strong>
              <small>eBill Management System</small>
            </div>
          )}
          {!collapsed && (
            <div className="brandActions">
              <button className="themeToggle" onClick={toggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
                {dark ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <div className="themePaletteWrap">
                <button
                  className="themeColorButton"
                  onClick={() => setShowPalette((v) => !v)}
                  title="Change theme colour"
                  style={{ background: accent }}
                >
                  <span className="palettePreviewDots">
                    {palette.map((color) => <span key={color} style={{ background: color }} />)}
                  </span>
                </button>
                {showPalette && (
                  <div className="themePalette" role="listbox" aria-label="Choose theme colour">
                    {palette.map((color) => (
                      <button
                        key={color}
                        className={'themeSwatch' + (accent === color ? ' selected' : '')}
                        style={{ background: color }}
                        onClick={() => changeAccent(color)}
                        title={color}
                        aria-label={`Use ${color} theme`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <button className="sidebarToggle" onClick={toggleCollapsed} title="Collapse">
                <ChevronLeft size={15} />
              </button>
            </div>
          )}
        </div>
        {collapsed && (
          <>
            <button className="themeToggle" style={{ margin: '0 auto 8px' }} onClick={toggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <div className="themePaletteWrap">
              <button className="themeColorButton" onClick={() => setShowPalette((v) => !v)} title="Change theme colour" style={{ background: accent }}>
                <span className="palettePreviewDots">
                  {palette.map((color) => <span key={color} style={{ background: color }} />)}
                </span>
              </button>
              {showPalette && (
                <div className="themePalette themePaletteCollapsed" role="listbox" aria-label="Choose theme colour">
                  {palette.map((color) => (
                    <button
                      key={color}
                      className={'themeSwatch' + (accent === color ? ' selected' : '')}
                      style={{ background: color }}
                      onClick={() => changeAccent(color)}
                      title={color}
                      aria-label={`Use ${color} theme`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button className="sidebarExpand" onClick={toggleCollapsed} title="Expand">
              <ChevronRight size={15} />
            </button>
          </>
        )}

        <nav className="sidebarNav">
          <NavItem
            icon={LayoutDashboard}
            label="Dashboard"
            active={active === 'dashboard'}
            collapsed={collapsed}
            onClick={() => setActive('dashboard')}
          />
          {Object.entries(MENU).map(([group, items]) => {
            const allowed = user?.is_super_user ? items : items.filter(([key]) => (user?.allowed_modules || []).includes(key));
            if (!allowed.length) return null;
            return (
            <div className="group" key={group}>
              {collapsed ? <div className="groupGap" /> : <h4>{group}</h4>}
              {allowed.map(([key, label]) => (
                <NavItem
                  key={key}
                  icon={ICONS[key] || FileText}
                  label={label}
                  active={active === key}
                  collapsed={collapsed}
                  onClick={() => setActive(key)}
                />
              ))}
            </div>
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
        <div className="top">
          <div>
            <div className="title">{active === 'dashboard' ? 'Dashboard' : labelFor(active)}</div>
            <div className="subtitle">{user?.username} · {user?.is_super_user ? 'Super User' : (user?.department || 'Staff')}</div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

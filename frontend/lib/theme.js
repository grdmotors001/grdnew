'use client';

import { useEffect, useState } from 'react';

export const THEMES = [
  { id:'green-olive', name:'Green + olive', description:'Fresh, natural', colors:{bg:'#F3F6EC',surface:'#FFFFFF',primary:'#3B6D11',primaryHover:'#27500A',accent:'#97C459',textPrimary:'#1C2413',textSecondary:'#5F5E5A',border:'#D3D1C7'} },
  { id:'grey-white', name:'Grey + white', description:'Clean, neutral', colors:{bg:'#F1EFE8',surface:'#FFFFFF',primary:'#2C2C2A',primaryHover:'#444441',accent:'#B4B2A9',textPrimary:'#1C1C1A',textSecondary:'#5F5E5A',border:'#B4B2A9'} },
  { id:'white-black', name:'White + black', description:'Minimal, classic', colors:{bg:'#FFFFFF',surface:'#F7F7F5',primary:'#2C2C2A',primaryHover:'#000000',accent:'#888780',textPrimary:'#1A1A1A',textSecondary:'#5F5E5A',border:'#D3D1C7'} },
  { id:'navy-gold', name:'Navy + gold', description:'Premium, elegant', colors:{bg:'#F0F5FA',surface:'#FFFFFF',primary:'#042C53',primaryHover:'#0C447C',accent:'#EF9F27',textPrimary:'#042C53',textSecondary:'#5F5E5A',border:'#B5D4F4'} },
  { id:'maroon-cream', name:'Maroon + cream', description:'Warm, rich', colors:{bg:'#FDF6F3',surface:'#FFFFFF',primary:'#4A1B0C',primaryHover:'#712B13',accent:'#D85A30',textPrimary:'#3A1509',textSecondary:'#5F5E5A',border:'#F0997B'} },
  { id:'teal-charcoal', name:'Teal + charcoal', description:'Modern, calm', colors:{bg:'#F2F9F6',surface:'#FFFFFF',primary:'#04342C',primaryHover:'#085041',accent:'#1D9E75',textPrimary:'#04342C',textSecondary:'#5F5E5A',border:'#9FE1CB'} },
  { id:'purple-lavender', name:'Purple + lavender', description:'Creative, soft', colors:{bg:'#F5F4FE',surface:'#FFFFFF',primary:'#26215C',primaryHover:'#3C3489',accent:'#7F77DD',textPrimary:'#26215C',textSecondary:'#5F5E5A',border:'#CECBF6'} },
  { id:'coral-sand', name:'Coral + sand', description:'Friendly, vibrant', colors:{bg:'#FBF6F0',surface:'#FFFFFF',primary:'#993C1D',primaryHover:'#D85A30',accent:'#F0997B',textPrimary:'#3A1509',textSecondary:'#5F5E5A',border:'#F5C4B3'} },
];

export const THEME_KEY = 'ebill_theme';

export function applyTheme(themeId) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.style.setProperty('--bg', theme.colors.bg);
  root.style.setProperty('--card', theme.colors.surface);
  root.style.setProperty('--ink', theme.colors.textPrimary);
  root.style.setProperty('--muted', theme.colors.textSecondary);
  root.style.setProperty('--line', theme.colors.border);
  root.style.setProperty('--accent', theme.colors.primary);
  root.style.setProperty('--accent-hover', theme.colors.primaryHover);
  root.style.setProperty('--theme-accent', theme.colors.accent);
  root.style.setProperty('--input-bg', theme.colors.surface);
  root.style.setProperty('--th-bg', theme.colors.surface);
  root.style.setProperty('--modal-bg', theme.colors.surface);
  root.style.setProperty('--strip-bg', theme.colors.surface);
  return theme.id;
}

export function useTheme() {
  const [themeId, setThemeId] = useState(THEMES[0].id);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY) || THEMES[0].id;
    const id = applyTheme(saved);
    setThemeId(id);
  }, []);

  const changeTheme = (id) => {
    const next = applyTheme(id);
    window.localStorage.setItem(THEME_KEY, next);
    setThemeId(next);
    return next;
  };

  return { themeId, changeTheme };
}

// Kept as a compatibility shim for components that may still import the old hook.
// Dark/light switching is intentionally removed; the application is theme-only.
export function useDarkMode() {
  const { themeId, changeTheme } = useTheme();
  return [false, () => changeTheme(themeId)];
}

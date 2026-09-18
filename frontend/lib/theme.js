'use client';
import { useEffect, useState } from 'react';

const KEY = 'ebill_theme';

function apply(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

// Reads the persisted theme (falls back to the OS preference on first visit)
// and keeps <html data-theme="..."> plus localStorage in sync with it.
// The inline script in app/layout.jsx sets the attribute before React
// hydrates, so there's no light-flash on reload — this hook just keeps
// React's own state (for the toggle UI) in sync with that.
export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    const initial = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(initial);
    apply(initial);
  }, []);

  const toggle = () => {
    setDark((d) => {
      const next = !d;
      window.localStorage.setItem(KEY, next ? 'dark' : 'light');
      apply(next);
      return next;
    });
  };

  return [dark, toggle];
}

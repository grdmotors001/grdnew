'use client';
import { useEffect } from 'react';

// Service worker ko poori app me register karta hai (pehle sirf /chat par hota tha).
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}

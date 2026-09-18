import Script from 'next/script';
import './globals.css';
export const metadata={title:'G.R.D. Motors eBill',description:'Modern eBill administration'};

// Sets data-theme on <html> before React hydrates/paints, so a saved "dark"
// preference doesn't flash light-mode for a frame on reload.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ebill_theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({children}){
  return (
    <html lang="en" suppressHydrationWarning>
      <head><Script id="theme-init" strategy="beforeInteractive">{THEME_INIT}</Script></head>
      <body>{children}</body>
    </html>
  );
}

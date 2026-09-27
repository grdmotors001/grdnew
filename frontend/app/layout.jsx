import Script from 'next/script';
import './globals.css';
export const metadata={title:'G.R.D. Motors eBill',description:'Modern eBill administration'};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover'};

// Sets data-theme on <html> before React hydrates/paints, so a saved "dark"
// preference doesn't flash light-mode for a frame on reload.
// Initialize one of the eight preset themes before React paints.
const THEME_INIT = `(function(){try{var allowed=['green-olive','grey-white','white-black','navy-gold','maroon-cream','teal-charcoal','purple-lavender','coral-sand'];var t=localStorage.getItem('ebill_theme');if(allowed.indexOf(t)<0)t='green-olive';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({children}){
  return (
    <html lang="en" suppressHydrationWarning>
      <head><Script id="theme-init" strategy="beforeInteractive">{THEME_INIT}</Script></head>
      <body>{children}</body>
    </html>
  );
}

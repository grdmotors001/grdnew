// PWA manifest: isse "Install app" karne par app bina browser bar (3 dot / URL) ke
// poori screen me kholta hai.
export default function manifest() {
  return {
    name: 'G.R.D. Motors eBill',
    short_name: 'GRD eBill',
    description: 'G.R.D. Motors RTO Management System',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5ec',
    theme_color: '#356311',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

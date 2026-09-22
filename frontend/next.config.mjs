/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'https://grdnew-backend.vercel.app';
    return [
      { source: '/api/backend/auth/:path*', destination: `${backend}/api/backend/auth/:path*` },
    ];
  },
  // Next.js expects hostnames here, not host:port.
  // This allows the dev server to be opened from another device/browser
  // using the PC's LAN address.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.1.55',
    '192.168.1.111',
  ],
};

export default nextConfig;

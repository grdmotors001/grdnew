/** @type {import('next').NextConfig} */
const nextConfig = {
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

import type { NextConfig } from 'next';

// Backend URL as seen from the Next.js server process.
// Inside Docker, the backend is reachable at http://backend:4000.
// Override with BACKEND_INTERNAL_URL if running Next outside the compose network.
const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/ical/:path*', destination: `${BACKEND}/ical/:path*` },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // ExcelJS imports Node built-ins that don't exist in the browser.
      // The browser bundle doesn't actually use them, so we can safely stub.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;

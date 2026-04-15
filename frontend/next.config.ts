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
};

export default nextConfig;

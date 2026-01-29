/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  experimental: {
    typedRoutes: true,
  },
  webpack: (config) => {
    // RC1 hardening: avoid noisy webpack cache warnings + flakiness when running `next dev` under Playwright.
    // Only applies when explicitly enabled via env var.
    if (process.env.COACHKIT_DISABLE_WEBPACK_CACHE === 'true') {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;

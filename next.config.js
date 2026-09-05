/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    // @react-pdf/renderer pulls in yoga-layout, whose WASM binary webpack's
    // usual bundling for API routes doesn't trace/carry through correctly
    // on Vercel (works locally since the full node_modules tree is already
    // on disk there) — marking it external makes it a plain Node require()
    // against the real node_modules at runtime instead, same as Next's own
    // documented fix for native/binary-asset packages like `sharp`/`canvas`.
    serverComponentsExternalPackages: ["@react-pdf/renderer"],
  },
};

module.exports = nextConfig;

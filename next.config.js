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
    // @react-pdf/renderer pulls in yoga-layout (WASM) and pdfkit — marking
    // it external makes it a plain Node require() against the real
    // node_modules at deploy time instead of going through webpack, same
    // as Next's documented fix for packages with native/binary assets
    // (sharp, canvas, ...).
    serverComponentsExternalPackages: ["@react-pdf/renderer"],
    // That alone isn't enough on Vercel: pdfkit loads its standard fonts
    // via a computed require (`pdfkit/standard-fonts/<name>`), which
    // Vercel's static file-tracing can't follow — it only sees the literal
    // string, not which of the dozen font files a given run actually
    // needs — so those files never get copied into the deployed function
    // and requiring one of them 404s as "Cannot find module" in production
    // even though local dev/build (full node_modules already on disk)
    // never surfaces it. Forcing every route to explicitly carry pdfkit's
    // and @react-pdf's full file trees works around that gap.
    outputFileTracingIncludes: {
      "**": ["./node_modules/pdfkit/js/**/*", "./node_modules/@react-pdf/**/*"],
    },
  },
};

module.exports = nextConfig;

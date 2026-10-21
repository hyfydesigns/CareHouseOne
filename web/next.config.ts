import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  // Native and WASM packages run on the server only and must not be bundled.
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite", "pg", "sharp"],
  poweredByHeader: false,
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // The public demo runs PGlite in memory: make sure its WebAssembly files are in the image.
  outputFileTracingIncludes: { "**": ["./node_modules/@electric-sql/pglite/dist/**/*"] },
  // Locally the public site is http://www.localhost:3000 (src/lib/hosts.ts).
  allowedDevOrigins: ["www.localhost", "app.localhost"],
  // Keep the development badge away from the sidebar's Sign out button.
  devIndicators: { position: "bottom-right" },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be checked for updates.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;

/**
 * SECURITY: the security headers below (added in a security audit pass)
 * were previously entirely absent — the site sent no CSP, no X-Frame-Options,
 * no X-Content-Type-Options, nothing. `headers()` is Next.js's own built-in
 * mechanism (no new dependency, e.g. no `helmet`, which can't reliably be
 * installed in this project's sandbox anyway — see other "no new dependency"
 * notes throughout this codebase, e.g. server/src/middleware/rateLimit.js).
 *
 * The Content-Security-Policy below is real, not decorative — it's built
 * from the site's ACTUAL external resource usage (checked directly, not
 * guessed): Google Fonts (app/globals.css's @import), the embedded Google
 * Maps iframe (app/page.tsx), and the client-side Formspree POST
 * (lib/site.ts / components/ApartmentChatbot.tsx). It still allows
 * 'unsafe-inline' for scripts and styles — a deliberate, documented
 * trade-off: a fully strict CSP needs per-request nonces threaded through
 * every page via middleware.ts, which this project doesn't have yet. Even
 * with 'unsafe-inline', this CSP still blocks the more common real-world
 * attack shape (injecting a `<script src="https://attacker.example/x.js">`
 * from an external origin, or framing this site in a clickjacking iframe on
 * another site) — it is a real improvement over having no CSP at all, not a
 * complete one. A follow-up nonce-based script-src is the natural next step.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://formspree.io",
  "frame-src https://www.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Belt-and-suspenders alongside frame-ancestors above — older browsers
  // that don't support CSP frame-ancestors still get clickjacking
  // protection from this.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing on this site uses the camera, microphone, or geolocation — deny
  // them outright so an embedded/compromised third-party script can't
  // silently request access.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Only meaningful over HTTPS (which is how this site is actually served),
  // browsers ignore it over plain HTTP — safe to always send.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS
      }
    ];
  }
};

export default nextConfig;

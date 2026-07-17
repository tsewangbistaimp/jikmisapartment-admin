# Jikmis Apartment — Security Audit

Audit date: 2026-07-14. Scope: the full repository — the live Next.js guest-facing site and AI receptionist, the legacy Express/Prisma API, and the shared Postgres database, across authentication, database permissions, API protection, environment variables, access control, data validation, and SQL injection.

Methodology: manual source review of every route/controller/middleware file (no automated scanner), cross-referenced against the actual Prisma schema and request-handling code — not a checklist audit. Every finding below was verified by reading the exact code path, and every fix was verified with the project's dry-run test harness (16 test files, all passing) plus a full TypeScript type-check.

## Summary

7 real issues found and fixed. No SQL injection surface exists anywhere in this codebase (100% Prisma parameterized queries, zero raw SQL). Authentication, password handling, and role-based access control were already well-built and needed no changes. One architectural trade-off is flagged but not changed (see "Not changed" below) — fixing it properly is a bigger decision than an audit pass should make unilaterally.

## Issues found and fixed

### 1. Cron endpoint ran unauthenticated if `CRON_SECRET` was ever unset (High)
`app/api/cron/send-reminders/route.ts` only checked the Bearer token `if (cronSecret)` was configured at all — if the environment variable was missing (easy to forget; nothing else breaks without it), the endpoint that sends real guest emails was fully public with no auth check. **Fixed:** now fails closed — returns a 500 and refuses to run if `CRON_SECRET` isn't set, matching the fail-fast pattern already used for `JWT_SECRET` in `server/src/index.js`.

### 2. No rate limiting on cost/abuse-sensitive public endpoints (High)
Four endpoints had zero rate limiting despite being fully public: `POST /api/chat` and the legacy `POST /chat` (both call the paid OpenAI API on the site's own key), `POST /api/bookings` (writes a real database row per request — could be scripted to spam junk bookings across every available date, denying real guests inventory), and `POST /api/orders` (sends two real outbound emails per request, one to an address the caller fully controls — a mail-relay abuse vector). Meanwhile `/auth/login` and `/auth/register` already had rate limiting, so the gap was inconsistent, not a deliberate choice. **Fixed:** added a rate limiter to all four. Next.js side got a new hand-rolled limiter (`lib/rateLimit.ts`, no new dependency — mirrors the existing Express one); the legacy Express `/chat` route now reuses its existing limiter middleware.

### 3. HTML injection in the invoice email (Medium)
`lib/guestMessaging.js`'s invoice email builds an HTML body with the guest's own name interpolated unescaped: `` `<p>Dear ${contact.name},</p>` ``. `contact.name` traces back to guest-submitted booking data. **Fixed:** added an `escapeHtml()` helper and applied it to every dynamic value in that HTML template.

### 4. No security headers anywhere (Medium)
Neither the Next.js site nor the Express API set any security headers — no CSP, no `X-Frame-Options`, no `X-Content-Type-Options`, nothing. **Fixed:** added a real (not decorative) CSP built from the site's actual external resource usage — Google Fonts, the embedded Google Maps iframe, the client-side Formspree POST — via Next.js's built-in `headers()` config (`next.config.mjs`, no new dependency), plus `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS. The Express API got its own minimal header set (`default-src 'none'`, appropriate for a pure JSON API).

**Honest caveat, not hidden:** the Next.js CSP still allows `'unsafe-inline'` for scripts and styles. A fully strict CSP needs per-request nonces threaded through `middleware.ts`, which this project doesn't have. Even with `'unsafe-inline'`, this still blocks loading a script from an external attacker-controlled domain and blocks framing the site elsewhere (clickjacking) — a real improvement over having no CSP, not a complete one.

### 5. `/api/orders` leaked internal config details to any caller (Low)
When required environment variables were missing, the endpoint returned their exact names in the JSON response to any unauthenticated caller. **Fixed:** logged server-side only now; the client gets a generic "temporarily unavailable" message.

### 6. Unvalidated query params in room listing (Low)
`GET /rooms`'s `?type=`/`?maxPrice=` query params went straight into a Prisma filter with no validation — never a SQL-injection risk (Prisma parameterizes everything and would reject bad input on its own), but a malformed value produced an unhandled 500 instead of a clean 400. **Fixed:** added a zod schema, consistent with every other endpoint in this API.

### 7. Placeholder secrets in local dev environment (Low, operational)
`.env.local`'s `JWT_SECRET` was still literally the documented placeholder string, and `CRON_SECRET` wasn't set. The server already refuses to start with a placeholder `JWT_SECRET` (good, existing protection), so this wasn't exploitable — but it meant the server couldn't actually run. **Fixed:** generated and set strong, unique 64-character random secrets for both, locally.

## Confirmed secure — no changes needed

- **No SQL injection surface at all.** Every database query in the entire codebase goes through Prisma's parameterized query builder. Zero uses of `$queryRaw`/`$executeRaw`/raw SQL anywhere.
- **Password handling:** bcrypt with cost factor 12, never stored or returned in plaintext, never included in any API response's `select`.
- **JWT/session security:** every authenticated request re-validates the account against the database (not just the token), so a deactivated or role-changed account loses/changes access on its very next request instead of waiting up to 7 days for the token to expire. Server refuses to start if `JWT_SECRET` is unset or still the placeholder.
- **Role-based access control:** consistently enforced server-side (not just hidden in the UI) across every admin/staff route, with real edge-case handling — an Owner can't accidentally deactivate/demote themselves, and the system refuses to remove the last active Owner account.
- **IDOR protections:** booking deletion correctly checks ownership (`Owner OR the booking's own user`); non-staff users listing bookings are correctly scoped to only their own.
- **Self-registration** correctly defaults new accounts to the unprivileged `USER` role — no privilege-escalation-via-signup path.
- **Public invoice access** uses an unguessable random UUID token (not the sequential invoice number), and the response is deliberately sanitized to never echo the token back or include unrelated data.
- **No hardcoded secrets** anywhere in source. `.env`/`.env*.local` correctly gitignored.
- **No XSS surface via React:** zero uses of `dangerouslySetInnerHTML` anywhere in the codebase.
- **CORS** on the Express API is correctly restricted to the configured `CLIENT_URL`, not wildcard.
- **Error responses** never leak stack traces to clients.
- **SMTP transport** uses secure defaults; TLS certificate validation is never disabled.

## Not changed (flagged, needs a decision — not silently fixed)

**The JWT is stored in `localStorage`, not an httpOnly cookie.** This is a real, standard XSS-token-theft risk in principle (any successful script injection on the admin app could exfiltrate the token). The actual exploitability today is low — this audit found zero `dangerouslySetInnerHTML` usage and no other injection point in the admin UI itself — but it's still a weaker pattern than an httpOnly cookie. It was **not** changed in this pass because the fix is a real architecture change, not a drop-in patch: the Express API and Next.js site are separate origins by design (`CLIENT_URL`/`API_URL`), so moving to cookies means reworking CORS (`credentials: true`), `SameSite`/`Secure` attributes, and adding CSRF protection — a change with enough moving parts that it deserves its own decision and testing pass, not a change bundled quietly into an audit. Flagging it here rather than either ignoring it or unilaterally rewriting the auth architecture.

## Before deploying to production

1. Set real, unique `JWT_SECRET` and `CRON_SECRET` values in the production environment (the ones fixed above are for local development only — never reuse them in production).
2. Set `SEED_ADMIN_PASSWORD` before seeding a production database (otherwise it falls back to a printed-with-a-warning dev default — see `prisma/seed.js`).
3. Decide on the `localStorage` → httpOnly-cookie question above before this is handling real guest/payment data at scale.

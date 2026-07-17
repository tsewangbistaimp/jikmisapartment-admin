# Jikmis Apartment — Production Deployment Guide

Target: **apartment.tsewangbista.com**, hosted on **Vercel** (Next.js app), with **Supabase** as the production Postgres database.

## Scope — read this first

This deploys the **Next.js app only**: the guest-facing marketing site, the room listing/detail pages, the AI receptionist chat widget, the direct booking form, the invoice page, and the reminder cron job. All of these are self-contained in Next.js's own `app/api/*` routes and talk to the database directly via Prisma — nothing about them depends on the separate legacy Express API in `/server`.

The Express API (`/server`) is **not** deployed as part of this guide. That means the Next.js pages that call it — `/admin`, `/admin/analytics`, `/admin/calendar`, `/login`, `/register`, `/booking`, `/dashboard`, `/rooms` (the authenticated room-management view, not the public room listing) — will build and deploy fine, but any button on them that calls the API will fail with a connection error, because there's no Express server running anywhere for them to reach. This is expected, not a bug. If/when you want the staff admin dashboard live too, that's a second, separate deployment (e.g. the Express API on Render/Railway/Fly, with `NEXT_PUBLIC_API_URL` in Vercel pointed at it) — out of scope here, but the app is already structured so that's a clean follow-up, not a rewrite.

---

## What was fixed to make this deployable

A real `next build` was attempted from a clean `npm install` (this project's normal working copy has a sandbox-specific `node_modules` issue unrelated to the code, so a fresh copy was used to get trustworthy build output). Two real, fixable problems were found and fixed directly in the repo:

1. **Missing `postinstall` script.** `package.json` never ran `prisma generate` anywhere in its install/build lifecycle, so `@prisma/client` had no generated types and every file importing `PrismaClient` failed to type-check (`Module '"@prisma/client"' has no exported member 'PrismaClient'`). Fixed by adding `"postinstall": "prisma generate"` to `package.json` — this is the standard, Prisma-documented pattern for Vercel deployments (Vercel runs `npm install` before the build, so `postinstall` is exactly the right hook).

2. **22 ESLint errors that fail `next build` by default.** `next build` runs ESLint and fails on any `error`-severity rule violation unless explicitly disabled. Two rule types were tripped across 6 files: `react-hooks/set-state-in-effect` (a newer rule flagging `setState` calls inside `useEffect` — all of the flagged cases here are the standard, correct pattern of reading `localStorage`/`sessionStorage` once after mount, which can't be done during SSR, so each was annotated with a scoped `eslint-disable-next-line` and a comment explaining why) and `react/no-unescaped-entities` (raw `'`/`"` characters in JSX text, fixed by swapping in `&apos;`/`&quot;`).

Both are genuine fixes verified against the actual rule output, not guesses — every file listed below now lints and compiles clean:

- `package.json`
- `app/admin/page.tsx`, `app/admin/calendar/page.tsx`, `app/admin/analytics/page.tsx`
- `app/invoice/[token]/page.tsx`
- `components/ApartmentChatbot.tsx`, `components/PaymentInvoicePanel.tsx`

**One thing this environment could not verify end-to-end:** actually generating the Prisma client requires downloading a schema-engine binary from `binaries.prisma.sh`, and this sandbox's network policy blocks that specific host (confirmed via a direct request — `403 Forbidden`, `X-Proxy-Error: blocked-by-allowlist`). Vercel's build servers have normal internet access and Prisma-on-Vercel is an official, extremely common combination, so this isn't expected to be a problem — but it means the very first real deploy is also your first true end-to-end build verification. Watch the Vercel build log on that first deploy; if anything unexpected shows up, it'll be visible there immediately.

### Performance

- Every `<img>` below the fold across the homepage, the room listing, and the room detail gallery now has `loading="lazy"` (several already did; the rest — the homepage room-showcase cards, the room-listing grid, the room-detail gallery past the first photo, and the lightbox thumbnail strip — didn't and now do). The hero image and the first room-detail photo are deliberately left eager since they're above the fold.
- **Flagged, not changed:** `next.config.mjs` already configures `images: { formats: ["image/avif", "image/webp"] }`, but nothing in the codebase uses the `next/image` component — every image is a plain `<img>` tag, so that config currently does nothing. All of this project's images are same-origin local files under `/public/images` (verified — none are external URLs), so a migration to `next/image` is safe in principle, but doing it blind risks subtle layout breakage (`next/image`'s `fill` mode sizes from the *parent* element, not the image itself, and this project's CSS currently sizes images directly via `aspect-ratio`/`object-fit` on the `<img>` selector). That's a real win worth doing as its own visually-tested follow-up, not bundled quietly into a deployment pass.
- The homepage video already uses `preload="metadata"` (not `auto`), which is already the right choice — no change needed.

---

## Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub sign-in is the fastest path).
2. Click **New project**. Pick an organization (create one if this is your first project), name it (e.g. `jikmis-apartment`), set a strong database password (save it somewhere — you'll need it for the connection strings below, and Supabase won't show it again), and pick a region close to your users (Singapore or Mumbai will be lowest-latency for Kathmandu-based guests, if offered).
3. Wait for provisioning (a minute or two).
4. In the project, go to **Project Settings → Database**. You need two connection strings from this page:
   - **Connection pooling** (Supavisor, "Transaction" mode, port `6543`) — this is your production `DATABASE_URL`. Copy it and append `?pgbouncer=true` if it isn't already there (Prisma's official Supabase guidance — avoids prepared-statement conflicts under PgBouncer's transaction pooling mode).
   - **Direct connection** (port `5432`) — you'll use this *once*, temporarily, to run the initial migration in Step 2. Don't use it as the app's runtime `DATABASE_URL` — it has a low fixed connection limit that a serverless deployment (Vercel spins up multiple concurrent function instances) will exhaust quickly.

Keep both connection strings handy for the next two steps.

## Step 2 — Run the database migration against Supabase

This project already has 3 migrations committed under `prisma/migrations` (`init`, `add_reception_role_and_user_isactive`, `add_payment_type_and_invoice_token`) — you're applying existing history to a fresh database, not creating a first migration. From your own machine (not this sandbox — it has no network path to Supabase or to Prisma's engine binaries):

```bash
cd /path/to/jikmisapartment
npm install                                   # generates the Prisma client via postinstall
export DATABASE_URL="<the DIRECT connection string from Step 1, port 5432>"
npx prisma migrate deploy                     # applies all 3 existing migrations in order
```

Any future schema changes go through `npx prisma migrate dev --name <description>` locally (against a dev database) to create the new migration file, committed to git, then `prisma migrate deploy` (with the direct connection string) applies it to Supabase the same way.

**Seeding:** `prisma/seed.js` creates the Owner/Admin staff account used to log into `/admin` — but since the Express API (which actually handles `/auth/login`) isn't deployed in this guide, a seeded account has nothing to log into yet. Skip seeding for now; run it later (`SEED_ADMIN_PASSWORD=<strong password> npx prisma db seed`, also with the direct connection string) once/if you deploy the Express API too.

## Step 3 — Create a Vercel account and import the project

1. Push this repository to GitHub (or GitLab/Bitbucket) if it isn't already there — Vercel deploys from a git repo.
2. Go to [vercel.com](https://vercel.com) and sign up (GitHub sign-in again is simplest, and lets Vercel auto-detect the repo).
3. Click **Add New → Project**, select this repository.
4. Framework preset: Vercel will auto-detect **Next.js** — leave the default build command (`npm run build` / `next build`) and output settings as-is. `output: "standalone"` in `next.config.mjs` doesn't conflict with Vercel — Vercel uses its own build output format regardless and this setting is simply unused there, safe to leave in place (it matters if you ever self-host on a plain Node server instead).
5. **Don't click Deploy yet** — set the environment variables first (Step 4), since `DATABASE_URL` is needed at *build* time (the new `postinstall: prisma generate` step needs it to resolve `prisma.config.ts`, not just at runtime).

## Step 4 — Configure environment variables in Vercel

In the project's **Settings → Environment Variables** (or the equivalent screen during first-time import), add these for the **Production** environment:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **pooled** connection string, port 6543, with `?pgbouncer=true` | Required at both build time (`prisma generate`) and runtime |
| `NEXT_PUBLIC_APP_URL` | `https://apartment.tsewangbista.com` | Used server-side to build the public invoice link in guest emails |
| `CRON_SECRET` | a fresh random secret — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | Required — `/api/cron/send-reminders` now refuses to run at all if this is unset (fixed during the earlier security audit) |
| `OPENAI_API_KEY` | your real OpenAI API key | Powers the AI receptionist |
| `OPENAI_MODEL` | `gpt-4o-mini` (or your preferred model) | |
| `NEXT_PUBLIC_FORMSPREE_ENDPOINT` | `https://formspree.io/f/xvzepwkw` | Optional — this is already the code default; only set it if you want a different Formspree form |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | your SMTP relay's real values | Optional but recommended — without these, booking confirmation/reminder/thank-you emails are silently skipped (logged, not blocking). Gmail with an App Password, Resend, or SendGrid all work |

**Deliberately not set** (these belong to the Express API, which isn't part of this deployment): `JWT_SECRET`, `JWT_EXPIRES_IN`, `SEED_ADMIN_PASSWORD`, `PORT`, `HOST`, `CLIENT_URL`. Also deliberately not set: `NEXT_PUBLIC_API_URL` — leaving it unset means `/admin`, `/login`, etc. will show connection errors when used, which correctly reflects that their backend isn't deployed, rather than silently pointing at `localhost`.

Generate `CRON_SECRET` locally and paste only the output into Vercel's UI — don't commit it anywhere, and don't reuse the value already sitting in this project's local `.env.local` (that one is explicitly local-dev-only, documented in `SECURITY_AUDIT.md`).

## Step 5 — Deploy

Click **Deploy**. Watch the build log — this is the first real end-to-end build (see the caveat in the "What was fixed" section above about this sandbox not being able to verify the Prisma engine download). Expect it to succeed; if `prisma generate` fails here for a reason unrelated to network access, the error will be specific and actionable in the log.

Once it succeeds, Vercel gives you a `*.vercel.app` URL — confirm the site loads there before moving on to the domain.

## Step 6 — Configure the domain (apartment.tsewangbista.com)

1. In the Vercel project, go to **Settings → Domains**, type `apartment.tsewangbista.com`, click **Add**.
2. Vercel will show you the exact DNS record to add (for a subdomain like this, almost always a **CNAME** record pointing `apartment` to `cname.vercel-dns.com` — Vercel's UI will confirm the exact value to use).
3. Go to wherever `tsewangbista.com`'s DNS is managed (your domain registrar, or Cloudflare/another DNS host if you've delegated there) and add that CNAME record for the `apartment` subdomain.
4. Back in Vercel, wait for the domain to show **Valid Configuration** (DNS propagation is usually minutes, occasionally longer). Vercel provisions the SSL certificate automatically once DNS resolves correctly — no manual certificate step needed.

## Step 7 — Test the production environment

Once `apartment.tsewangbista.com` resolves to the new deployment:

- Load the homepage; confirm images, video, and the room showcase render.
- Open the AI receptionist chat widget, send a message, confirm it responds (validates `OPENAI_API_KEY` and the database connection — chat conversations are persisted via Prisma).
- Walk the AI receptionist through a full mock booking to confirm it can write a `Booking` row (validates `DATABASE_URL` write access, not just read).
- Submit the homepage "Check availability" form (validates the Formspree integration).
- Open `/rooms` and a room detail page; confirm listings load from the database.
- If you configured SMTP: complete a real booking and confirm the confirmation email arrives; open the invoice link from that email and confirm `/invoice/[token]` renders.
- Check response headers on any page (browser dev tools → Network) for `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` — confirms the security headers from `next.config.mjs` are live.
- Wait for (or manually trigger, via the Vercel dashboard's Cron tab) the `/api/cron/send-reminders` job and confirm it returns `200`, not `401`/`500` — confirms `CRON_SECRET` is set correctly.
- Visit `/admin` and confirm it loads the page shell but shows a connection/loading error when it tries to fetch data — this is the expected, documented limitation (Step "Scope" above), not something to debug.

---

## Known limitations, carried forward honestly

- **Admin/login/booking-management pages have no backend in this deployment.** Documented above — not a bug, a scope decision.
- **The in-memory rate limiter (`lib/rateLimit.ts`) doesn't share state across serverless instances.** Its own code comments assumed a persistent `output: "standalone"` process, but Vercel runs Next.js as scaling serverless functions, so under real concurrent traffic each function instance has its own independent rate-limit counters — meaning the effective limit is looser than configured, not tighter. Still meaningfully better than no rate limiting at all (single-instance and low-to-moderate traffic, which fits this project's scale, are close to the intended behavior); a shared store (Redis, Vercel KV, etc.) would be the correct fix if traffic grows enough for this gap to matter.
- **CSP still allows `'unsafe-inline'`** for scripts/styles (documented in `SECURITY_AUDIT.md`) — a real improvement over no CSP, not a complete lockdown. A nonce-based CSP is the natural next step if this becomes a priority.
- **JWT-in-localStorage** (the Express API's auth token storage) — flagged in the security audit as a real but low-urgency architectural trade-off, unrelated to this Next.js-only deployment but worth remembering if/when the Express API is deployed too.

## Quick reference — production environment variables

```
DATABASE_URL=<Supabase pooled connection string, port 6543, ?pgbouncer=true>
NEXT_PUBLIC_APP_URL=https://apartment.tsewangbista.com
CRON_SECRET=<generate fresh, 64-char random>
OPENAI_API_KEY=<real key>
OPENAI_MODEL=gpt-4o-mini
NEXT_PUBLIC_FORMSPREE_ENDPOINT=https://formspree.io/f/xvzepwkw   # optional, already the default
SMTP_HOST=...        # optional but recommended
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
```

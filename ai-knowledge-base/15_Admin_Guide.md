# Jikmis Apartment — Admin & Reception Guide

## 1. How the Live System Works Day-to-Day

**Updated:** the admin dashboard (`/admin`) is now connected to the same database the AI receptionist's booking assistant, the homepage booking form, and every other booking path write to (see `12_System_Logic.md`, sections 5 and 19, and `13_Database_Summary.md`). Bookings created by the AI in chat, submitted through the homepage form, or entered manually all land in the same `Booking` table and are both visible and manageable from `/admin`. The operational flow is:

1. A guest inquires and books via the AI chatbot, the homepage "Book Now" form (**updated** — this now creates a real `PENDING` booking directly too, not just an email/WhatsApp inquiry; see `12_System_Logic.md`, section 19), or WhatsApp/phone/in-person directly — for the latter, staff can now log the booking themselves in `/admin` (see section 5j) instead of it only existing as a WhatsApp conversation.
2. For AI-chat and homepage-form bookings, the website automatically emails the team at **jikmisdonkhang@gmail.com** with the booking details and creates a `PENDING` row in the database, visible immediately in `/admin`.
3. Staff log into `/admin`, review the booking (guest details, dates, room, price), and verify the 50% advance payment was received (cash, bank transfer, eSewa, or Khalti, per `05_Booking_Policies.md`).
4. Once payment is verified, staff record the paid amount in `/admin` and move the booking's status from `PENDING` to `CONFIRMED`.
5. At check-in, staff move the status to `CHECKED_IN`; at check-out, to `CHECKED_OUT`. If a booking falls through, staff set it to `CANCELLED`.
6. Staff verify guest ID/citizenship/passport at check-in.

**Availability for the AI receptionist's booking flow is now read live from the database** (`Room.totalUnits` vs. overlapping `PENDING`/`CONFIRMED`/`CHECKED_IN` bookings) — this part no longer needs manual text updates. The separate static "current availability" text used by the AI's general Q&A replies (outside an active booking) still needs manual updates, per section 2 below.

## 2. Updating Availability

- **AI booking flow (real-time):** availability is computed live from the database. To take a room out of circulation entirely, use the "Mark unavailable" toggle on a room in `/admin` (sets `Room.isAvailable = false`), or adjust `Room.totalUnits` if the number of physical units changes.
- **AI general Q&A replies (still static):** the three availability lines the AI cites in ordinary conversation (not an active booking) are still hardcoded in `app/api/chat/route.ts`'s knowledge-base-driven prompt/source data (see `02_Room_Types.md`, section 4). Updating these still requires a developer to edit source text and redeploy — there is no admin UI for this specific static text yet.

## 3. Updating Pricing or Room Details

Pricing and room details now live in three places that should be kept in sync:
1. `app/page.tsx` — the `roomShowcase` array (homepage display).
2. `ai-knowledge-base/02_Room_Types.md` / `03_Pricing.md` — what the AI's general chat replies cite (see `12_System_Logic.md`, section 2).
3. The `Room` table in the database (via `/admin` → Room management) — what the AI booking assistant actually uses to check availability and calculate price for a real booking.

If these drift out of sync, the AI could quote one price in casual chat and charge a different one when actually booking. Room management in `/admin` is the most important of the three to keep accurate, since it's the one tied to real money and real bookings.

## 4. Monitoring Inquiries

- AI-chat and homepage-form bookings: visible directly in `/admin` (see section 5), plus an email notification to jikmisdonkhang@gmail.com.
- General chat questions that don't turn into a booking, and the rare homepage-form submission that fell back to the email-only path (live room data was unreachable when the guest submitted — see `12_System_Logic.md`, section 3): still only visible as emails (via Formspree) and WhatsApp messages — not in `/admin`.

## 5. Admin Dashboard (`/admin`) — Now Live and Connected

### 5a. Login and Roles — Updated

- Navigate to `/login`. The previously-flagged hardcoded demo credentials pre-filled in the login form have been removed — the fields now start blank.
- There are two staff roles, both stored as `User.role` (see `13_Database_Summary.md`):
  - **Owner/Admin** (`role: "ADMIN"`) — full access: manage staff, manage rooms/pricing, view reports (dashboard stats), manage settings, plus everything Reception can do.
  - **Reception Staff** (`role: "RECEPTION"`) — create bookings (including logging walk-in/phone bookings), manage guests, update payments, view availability/bookings. Cannot manage rooms/pricing, cannot manage staff, cannot view the dashboard reports panel, and cannot hard-delete a booking (cancel via status change instead).
- A third role, `USER`, is unrelated to staff — it's a guest's own self-service account from the legacy authenticated booking flow (`/register`), and never appears in staff/admin screens.
- Both `ADMIN` and `RECEPTION` log in at the same `/login` page and land on the same `/admin` dashboard — the page hides Owner-only sections (Staff management, Room management, the dashboard stats panel) from Reception Staff automatically, based on the role stored on their account.
- **Staff accounts can be deactivated** (`User.isActive`) instead of deleted, preserving their booking/payment history. A deactivated account's existing login token is rejected on its very next request (not just at next login), and the account cannot log in again until an Owner reactivates it.
- **Self-service password change:** any logged-in account (Owner, Reception, or guest) can change its own password via `PATCH /auth/password` (current password required). There's no UI button for this yet — it's an API-only capability for now.
- **Login/register are rate-limited** per IP (in-memory, resets on server restart) to slow down brute-force login attempts and spam account creation.

### 5b. Dashboard Stats (`GET /admin/dashboard`)
Shows: total bookings, and counts broken down by the full status lifecycle — pending, confirmed, checked-in, checked-out, cancelled — plus total rooms, total registered users, total value of active (non-cancelled) bookings, total amount paid so far, and total outstanding balance across all active bookings.

### 5c. Viewing Bookings and Guest Details
`/admin` lists every booking — from the AI receptionist (`channel: "ai_chat"`) and from the legacy authenticated flow (`channel: "legacy_form"`) — in one place, each showing: room, a channel badge, guest name/email/phone/WhatsApp (for AI bookings, pulled from the guest* fields; for legacy bookings, from the linked user account), check-in/check-out dates, guest count, and any special requests.

### 5d. Changing Booking Status
Each booking has a status dropdown covering the full lifecycle: **Pending → Confirmed → Checked-in → Checked-out**, or **Cancelled** at any point. Changing it calls `PATCH /bookings/:id/status`. The AI receptionist itself never sets a booking past `PENDING` — moving a booking to `CONFIRMED` (i.e., verifying the advance payment) is always a manual staff decision.

### 5e. Viewing and Recording Payments
Each booking shows Total price, Paid amount, and Remaining balance (Total − Paid, computed on the fly — never stored separately, so it can't drift). A quick "set the total paid amount" input remains available directly on each booking card/modal (e.g., for correcting a data-entry mistake) via `PATCH /bookings/:id/payment`. **New — for actually recording a payment as it comes in, use the payment management panel described in section 5l**, which is the "Record advance payment" / "Record remaining balance" workflow. There is still no automated payment gateway — this is a manual record of payments collected outside the system, not a live payment processor.

### 5f. Managing Rooms and Availability
Admins can create, update, and delete `Room` records via `/admin`, including title, type, nightly/monthly pricing, description, facilities, rules, images, max guests, **total units** (how many physical rooms of this type exist — see `13_Database_Summary.md`), and an availability toggle. Toggling a room to "unavailable" blocks new bookings for it across the board; it does not affect already-confirmed bookings.

### 5g. Managing Users vs. Managing Staff — Two Different Screens

- **Registered guest users** — Owners can still list all `USER`-role accounts via `GET /admin/users`. AI-chat guests do not create user accounts, so they won't appear here — only guests who registered through the legacy `/register` flow will. This endpoint is read-only and unrelated to staff management.
- **Staff accounts (New) — Owner/Admin only:** `/admin` now has a "Staff management" panel (hidden from Reception Staff) for the "Manage staff" capability: create a new Owner/Admin or Reception Staff account (name, email, phone, temporary password, role), change an existing staff member's role, and activate/deactivate an account. Two safeguards prevent staff lockout: an Owner cannot deactivate or demote their own account, and the system will never let the last remaining active Owner/Admin be deactivated or demoted by anyone.

### 5h. Automated Guest Communications — New

The system now sends guests three automated messages, requiring no manual action from staff for the first two:

1. **Booking confirmation** — sent immediately when a booking is created (AI chat or manual/legacy form): a confirmation email (if the guest gave an email) plus a pre-filled WhatsApp link. For AI-chat guests, this WhatsApp link auto-opens in their browser tab right when the booking is made.
2. **Pre-arrival reminder** — sent automatically the day before check-in, for any booking still in `PENDING`/`CONFIRMED`/`CHECKED_IN` status, via a daily scheduled job.
3. **Post-checkout thank-you + Google review request** — sent automatically the day after checkout, **but only for bookings staff have actually moved to `CHECKED_OUT` status**. If staff forget to update a booking's status to `CHECKED_OUT`, the thank-you message never sends — this is a real dependency, not just a display detail, so keeping status current at checkout (section 6, step 6) directly controls whether guests get this message.

**Important limitation:** there is no WhatsApp Business API configured, so nothing is pushed to WhatsApp silently in the background — every "WhatsApp message" is a pre-filled `wa.me` link, not a real automatic send. There are two ways a guest actually sees this link: (1) for a booking made live in the AI chat widget, it auto-opens in the guest's own browser tab right when they book; (2) for every other case — a booking made through the legacy/admin form, a booking logged manually by staff (section 5j), or the later reminder/thank-you messages — the link is embedded directly inside the automated confirmation/reminder/thank-you EMAIL as a "tap to message us on WhatsApp" line, since there's no browser tab to auto-open for those. If a guest didn't provide an email, they won't receive any of these links at all outside of a live AI chat booking. Email is currently required infrastructure for these automations to reliably reach a guest — staff should always try to collect a guest email, including when logging a manual booking.

If a guest reports not receiving an automated email, check that `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are actually configured in the deployment environment (see `.env.example`) — without them, the system silently skips sending (logs a warning) rather than failing the booking.

### 5i. Pricing Caveat (still applies)
Both the legacy booking API and the AI booking assistant calculate price as `nights × pricePerNight` only — neither automatically applies monthly pricing or the monthly negotiation rules in `03_Pricing.md`. A monthly-stay booking created through either path will show the nightly-rate total; staff should manually adjust the recorded total/payment if a negotiated monthly rate was agreed.

### 5j. Logging a Walk-In or Phone Booking — New
`/admin` now has a "Log a booking" form, above the bookings list, for guests who booked by phone, WhatsApp, or in person rather than through the AI chat widget. Fill in the room, dates, guest count, and the guest's name/phone (required) plus WhatsApp/email/special requests (optional, but an email is needed for the guest to actually receive a confirmation email — see the limitation note above). Submitting it creates a real booking exactly like an AI-chat booking would (same availability check, same pricing, same `PENDING` status, same confirmation email/WhatsApp link automation) — the only difference is `channel` is recorded as `"admin_manual"` instead of `"ai_chat"`, so it's clear in the booking list who or what created it. After logging it, the page shows a link to open the WhatsApp confirmation yourself if you'd like to send it to the guest directly rather than relying on the email.

### 5k. Behind-the-Scenes Database Records — New (No Dedicated UI Yet)

A database structure review added several new tables that now populate automatically as a side effect of normal booking/payment/status actions, even though `/admin` doesn't have a dedicated screen for browsing them yet (direct database access is currently the only way to view them):
- **Guest history:** every booking with no linked account (AI-chat, homepage form, admin-manual — none of these create a `User` account) is matched or linked to a deduplicated `Guest` record by phone/email, so a repeat guest's stays can eventually be traced across bookings.
- **Payment ledger:** every time you save a payment (5e, 5l), the change is also recorded as its own itemized `Payment` row (amount, method, type, which staff member recorded it), on top of the running total you already see.
- **Invoices:** the first time you move a booking to `CONFIRMED` — or the first time you use the payment management panel's "View / download invoice" or "Send invoice to guest" action (5l) — an invoice record (`JA-<year>-<number>`) is created automatically. **New:** unlike earlier, there's now a full staff-facing workflow for viewing/downloading/emailing it — see section 5l.
- **AI conversation transcripts:** every AI chat turn (not just bookings) is now saved, so a conversation can be reviewed later if needed.
- **Notification log:** every confirmation/reminder/thank-you send attempt (both email and the WhatsApp link) is logged individually, including failures — more detail than the booking list's "sent" timestamps show.

None of this changes anything about how you use `/admin` day-to-day — it's all automatic. It's noted here so staff/developers know this data exists if it's ever needed (e.g. for a future admin screen, or a direct database query to answer a guest's question).

### 5l. Payment Management — New

A dedicated payment/invoice panel ("Manage payment & invoice") is available on every booking card in `/admin` and inside the booking detail modal on `/admin/calendar` (section 6) — the same shared component (`PaymentInvoicePanel`) in both places, so the workflow is identical no matter which screen staff are working from. This sits alongside, not instead of, the existing quick "set total paid" correction input (5e).

- **Record advance payment / Record remaining balance / Record other payment.** Three buttons open a small form (amount, payment method, optional note) that **adds** the entered amount to the booking's existing paid total — this is the natural "a guest just paid me X" action, as opposed to the older quick-correction input which requires typing the *new total*, not the amount received. "Record advance payment" and "Record remaining balance" are disabled once a booking is fully paid. The remaining-balance button pre-fills the exact amount still owed; the advance button pre-fills a suggested 50% advance (per `05_Booking_Policies.md`), capped at whatever's actually still owed. A payment that would push the total paid above the booking's total price is rejected with a clear error — it never silently caps or overpays.
- **Payment method.** Recorded per payment (cash / bank transfer / eSewa / Khalti), same options as the existing quick-correction input.
- **Payment history.** Every payment recorded through this panel (or the older quick-correction input) appears in an itemized list — date, type (advance/remaining/other), method, amount, and which staff member recorded it — newest first.
- **Generate invoice PDF / Download invoice.** A "View / download invoice" button opens the invoice in a new tab (`/invoice/<token>`, a public but unguessable link) with a "Print / Save as PDF" button on the page itself. **Important, stated plainly:** there is no PDF-generation library installable in this project's environment — a real `npm install` of one (pdfkit) was attempted and failed with the same pre-existing sandbox dependency-installation error documented elsewhere in this project. Rather than silently skip the "generate PDF" requirement or claim a capability that isn't there, this uses the browser's own native "Print > Save as PDF" (or "Microsoft Print to PDF" on Windows) as the actual PDF mechanism — the invoice page itself is built specifically to print cleanly (see 5l's invoice page layout below). If a true server-generated PDF binary is ever required (e.g., for automated bulk generation), that would need a developer to add a PDF library once the sandbox constraint is resolved, or generate it in a different environment.
- **Send invoice to guest.** Emails the guest a link to their invoice page, with a short text summary (total, paid, remaining, status) and a WhatsApp tap-to-message link, same delivery pattern as the booking confirmation/reminder/thank-you emails (5h). Requires the guest to have an email on file — if not, the button is disabled with an explanatory tooltip, and staff can still use "View / download invoice" to hand the guest a printed copy directly.

**What the invoice itself shows** (both on-screen and in the printed/PDF version): Jikmis Apartment's name and address, the guest's name/phone/email, room title and type, check-in/check-out dates and nights, total amount, amount paid, remaining amount, a payment-status badge (Unpaid / Partially paid / Fully paid), and — if any payments have been recorded — an itemized payment history table.

### 5m. Managing Guests — New

Reception Staff (and Owners) can now browse, search, and edit the deduplicated `Guest` records described in section 5k above via a new API surface (`GET /guests`, `GET /guests/:id` for a guest's full booking history, `PATCH /guests/:id` to edit contact details/notes) — the "Manage guests" capability. There's no dedicated `/admin` UI screen for this yet; it's available as an API today.

## 6. Booking Calendar (`/admin/calendar`) — New

A dedicated, visual companion to the bookings list on `/admin` (section 5) — same data, same underlying endpoints (`GET /rooms`, `GET /bookings`, `POST /bookings/manual`, `PATCH /bookings/:id/status`, `PATCH /bookings/:id/payment`), no new API surface. Staff-only (Owner/Admin or Reception Staff — a signed-out visitor or a guest account sees an access-required message instead). Linked from the top of `/admin` and from the site header nav on both pages.

**Monthly grid view.** Each room gets one row per physical unit (`Room.totalUnits` — e.g. the Single Studio Room's 2 units each get their own row), and each day of the selected month is a column. A booking renders as a colored bar spanning from its check-in day to the day before its check-out day (the room turns over same-day, so a check-out and a new check-in on the same date never overlap visually or in the underlying conflict logic). Bars that start before or extend past the visible month are shown clipped at the edge (a squared-off end instead of a rounded one) rather than being cut from the grid entirely. Prev/Next/Today buttons navigate months.

**Color status.** All five statuses are color-coded identically to the `/admin` bookings list (same hex colors): Pending (amber), Confirmed (green), Checked-in (blue), Checked-out (slate), Cancelled (red, struck through). A legend sits above the grid. Cancelled bookings get their own lightweight track below a room's real occupancy rows — a cancellation never occupies a unit slot, but it's still visible for history.

**Daily occupancy view.** Click any date in the header row to open a panel below the grid listing every room's status for that specific day — guest name, status, and "Arriving today" / "Departing today" flags where relevant. Click the same date again to close the panel.

**Room-wise availability.** A row of summary cards above the grid shows, for whichever day is currently in focus (the selected day, or today if none is selected), how many of each room's physical units are free right now — e.g. "Single Studio Room: 1 of 2 free". This updates live as you click different dates.

**Check-in/check-out display.** A bar's exact dates, plus full guest and payment details, are one click away: clicking any bar (or a day-panel entry) opens a detail panel with guest name/phone/email/WhatsApp, dates, guest count, special requests, price, amount paid, and remaining balance — plus inline controls to change the status or record a payment without leaving the calendar (same `PATCH` endpoints as section 5d/5e).

**Logging a new booking from the calendar.** Clicking an empty date cell in any room's row opens the same "Log a booking" form as section 5j, pre-filled with that room and date. Before you submit, the calendar warns you (in-page, not a hard block) if the dates you've picked already look fully booked for that room, based on whatever bookings are currently loaded — but the actual decision always comes from the server's own availability check (`POST /bookings/manual`, 409 if genuinely full), the same one every other booking path in this system already relies on. **Overlapping bookings are prevented automatically this way** — the calendar's in-page warning is a convenience, not a second, independent set of rules that could ever disagree with the real one.

**"Real time" — how it actually works.** This project has no WebSocket or Server-Sent-Events infrastructure (it's a Next.js frontend talking to a separate Express API — see `12_System_Logic.md`), so "real time" here means: the calendar re-fetches bookings automatically every ~15 seconds, immediately whenever you switch back to the browser tab, and pauses that polling while the tab is in the background so it doesn't hit the API unnecessarily. Any change you make yourself (status, payment, a new booking) updates the screen instantly without waiting for the next poll. A small "Updated Xs ago" indicator next to a manual Refresh button shows how current the data is. Two staff members working the calendar at the same time will see each other's changes within about 15 seconds, not instantly.

**Not built:** drag-and-drop rescheduling of a booking's dates, exporting/syncing to Google Calendar or iCal, and printing a formatted calendar view — none of these exist yet (see section 8).

## 6a. Analytics Dashboard (`/admin/analytics`) — New

A dedicated, Owner/Admin-only reporting view (`GET /admin/analytics`) — part of the "View reports" capability, so Reception Staff see an access-required message rather than the page, the same way they're excluded from the dashboard stats panel on `/admin`. Linked from the top of `/admin` (Owner-only link, next to "Open the booking calendar") and from the site header nav on `/admin` and `/admin/calendar`.

**Cards:**
- **Total bookings** — every booking ever made, any status.
- **Today's check-ins / Today's check-outs** — non-cancelled bookings with a check-in/check-out date of today, whether or not staff have already moved them to `CHECKED_IN`/`CHECKED_OUT` — this is an arrivals/departures list for the day, not a completed-tasks log.
- **Occupied rooms / Available rooms** — how many physical room units (`Room.totalUnits`) are occupied right now vs. free, computed the same way the booking calendar computes occupancy (a booking counts if it spans today and isn't cancelled), capped per room so a data anomaly can never show more rooms occupied than actually exist.
- **Monthly revenue** — this month's total booking value, attributed by each stay's check-in date (not when the booking was made).
- **Pending payments** — the total amount still owed across every booking that isn't fully paid (excluding cancelled bookings), plus how many bookings that is.

**Charts:**
- **Monthly revenue trend** — a bar chart of the last 6 months' revenue, so a slow or busy month is visible at a glance rather than only seeing the current month in isolation.
- **Booking sources** — a donut chart breaking down every booking ever made by channel (AI Chat, Manual/Legacy, Logged by Staff), with a legend showing counts and percentages — useful for seeing which booking channel actually brings in guests.

**On charts, stated plainly:** these are hand-built (SVG), not rendered by a charting library — no chart library can be reliably installed in this project's environment (the same constraint documented for invoice PDF generation in section 5l; a real `npm install` of a charting package fails with the project's pre-existing sandbox error). They're still fully interactive-looking, properly scaled, gridlined bar/donut charts using the site's existing color palette — just built without an external dependency rather than the feature being silently skipped or faked with static images.

The page refreshes automatically whenever staff switch back to its browser tab, plus a manual Refresh button — lighter-touch than the booking calendar's continuous 15-second polling, since analytics figures don't need to update within seconds the way live booking status does.

## 7. Reception Staff Checklist (Updated)

1. Check `/admin` regularly for new `PENDING` bookings (from the AI receptionist), plus jikmisdonkhang@gmail.com and WhatsApp (9708538395 / 9869035191) for inquiries that didn't go through the booking flow.
2. For a new `PENDING` booking, confirm real-world availability if needed, then wait for the 50% advance payment.
3. Once the advance payment is received, record the paid amount in `/admin` and move the status to `CONFIRMED`.
4. Track the remaining 50% (visible as "Remaining" in `/admin`), due within 2 days of check-in; update the paid amount again once received.
5. Verify a valid ID/citizenship/passport at check-in, then move the status to `CHECKED_IN`.
6. Move the status to `CHECKED_OUT` after checkout (before 12:00 PM noon) — **this also triggers the automated thank-you/review-request email the following day, so don't skip this step (see 5h).**
7. If a booking falls through, set the status to `CANCELLED`.
8. If a guest requests a discount, early check-in, late check-out, or airport pickup, remember these are never guaranteed automatically by the AI — a staff/owner decision is required.

## 8. Data Discrepancies Admin Staff Should Be Aware Of

See `01_Apartment_Overview.md`, section 7, for the full list — most notably, the legacy `/about` page shows a different WhatsApp number and email than the canonical contact details used everywhere else. Staff should ensure the canonical details (9708538395 / 9869035191, jikmisdonkhang@gmail.com) are what's actually monitored, and should ask the developer to correct or remove the outdated `/about` page content.

## 9. Not Found in Current Project

- A staff scheduling or shift system
- A formal training manual beyond what's inferable from the AI chatbot's own instructions and this guide
- A refund/cancellation approval workflow (who approves refunds, what authority level is required)
- A server-generated invoice PDF binary — "Download invoice" uses the browser's native print-to-PDF against a print-optimized web page instead, since no PDF-generation library is installable in this project's environment (see section 5l)
- A charting library (recharts, Chart.js, etc.) — the analytics dashboard's charts (section 6a) are hand-built SVG instead, for the same sandbox dependency-installation reason
- Inventory or supply management (e.g., for the café or housekeeping supplies)
- An automated payment gateway — payment amounts are recorded manually by staff, not captured automatically
- A real WhatsApp Business API integration — automated "WhatsApp messages" are pre-filled links, not silent pushes (see 5h)
- Drag-and-drop rescheduling, calendar export/sync (Google Calendar, iCal), or a printable calendar view on `/admin/calendar` (see section 6)
- True real-time push updates on the calendar — it polls every ~15 seconds rather than pushing changes instantly (no WebSocket/SSE infrastructure exists in this project; see section 6)
- A catch-up mechanism for missed cron runs — if the daily reminder/thank-you job doesn't run on the exact day a booking needs it, that message is not automatically sent later (see `14_API_Documentation.md`)
- **A dynamic "Settings" screen or database table.** The role spec's "Owner/Admin: Manage settings" / "Reception: Cannot change system settings" doesn't map to any literal settings UI in this project — there's no settings table anything reads from. In practice it maps to the mutable configuration that already exists and is already Owner-only: room/pricing management (5f), staff account management (5g), and environment-variable-level configuration (`.env` — SMTP, JWT secret, etc.) that only a developer/deployer touches, not a runtime "Settings" page. This is flagged explicitly rather than inventing a settings screen that doesn't exist in the code.
- A shared, multi-instance rate-limit store — the login/register rate limiter (5a) is in-memory per server process; it resets on restart and doesn't share state across multiple server instances.

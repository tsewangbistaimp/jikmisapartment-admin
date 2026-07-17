# Jikmis Apartment — API Documentation

Two separate API surfaces exist in this project: the **live Next.js API route** that actually powers the guest-facing chatbot, and the **legacy Express API** (`/server`) that backs the older booking/admin pages. A third route (`/api/orders`) is unrelated to Jikmis Apartment entirely. Each is documented separately below.

---

## Part 1 — Live API: `POST /api/chat`

This is the only backend API endpoint actually used by the live Jikmis Apartment website (`app/api/chat/route.ts`).

### Request

```
POST /api/chat
Content-Type: application/json
```

```json
{
  "message": "How much is the family room?",
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello! Welcome to Jikmis Apartment..." }
  ],
  "bookingState": null,
  "conversationId": null
}
```

- `message` (string, required): the guest's latest message. Trimmed server-side; empty messages are rejected.
- `messages` (array, optional): prior conversation history. Each item must have `role` (`"user"` or `"assistant"`) and `content` (string). Sanitized, trimmed, capped at 700 characters per message, and limited to the last 8 messages.
- `bookingState` (object or null, optional): opaque state object for an in-progress AI-assisted booking (see `12_System_Logic.md`, section 5a). `null`/absent means no booking flow is active. The client must store whatever `bookingState` came back in the previous response and echo it back unchanged on the next request — the server holds no session of its own.
- `conversationId` (string or null, optional — **new**): identifies the persisted `AiConversation` this message belongs to (see `12_System_Logic.md`, section 14). `null`/absent starts a new conversation. Same client-carried-state pattern as `bookingState` — the client stores whatever `conversationId` came back in the previous response and echoes it on the next request.

### Responses

**400 Bad Request** — if `message` is missing/empty:
```json
{ "message": "Message is required." }
```

**200 OK** — deterministic source-of-truth answer (pricing/availability/rules/etc.):
```json
{ "reply": "Our 2BHK Family Room is NPR 4,000 per night or NPR 65,000 per month.", "source": "jikmis_source_of_truth", "conversationId": "..." }
```

**200 OK** — local fallback (no OpenAI key configured, or OpenAI call failed):
```json
{ "reply": "...", "source": "local_fallback", "conversationId": "..." }
```

**200 OK** — AI-generated answer (OpenAI configured and call succeeded, grounded in the knowledge base):
```json
{ "reply": "...", "conversationId": "..." }
```
(no `source` field in this case)

**200 OK** — AI booking assistant turn (returned whenever `bookingState` was sent, or the message starts a booking):
```json
{
  "reply": "Good news — the Single Studio Room is available for 2026-08-01 to 2026-08-03 (2 nights). That comes to NPR 3,000 in total. Could I get your full name to continue?",
  "bookingState": { "step": "fullName", "slots": { "roomTitle": "Single Studio Room", "checkIn": "2026-08-01", "checkOut": "2026-08-03", "guests": 2, "nights": 2, "totalPrice": 3000, "...": "..." } },
  "whatsappUrl": null,
  "source": "booking_assistant",
  "conversationId": "..."
}
```
`bookingState` is `null` in this response once the flow finishes — either a booking was created or the guest cancelled. **Note:** the JSON response does not include a `bookingId` field even when a booking was created — the reference number is only conveyed inside the natural-language `reply` text (e.g. "Reference: ..."). (An earlier version of this document incorrectly stated a `bookingId` field was included — corrected here.) `whatsappUrl` is populated only on the single turn where a booking is actually created: a pre-filled `wa.me` link the client (`components/ApartmentChatbot.tsx`) auto-opens in a new tab so the guest gets a WhatsApp confirmation with one less step — see `12_System_Logic.md`, section 11b. It's `null`/absent on every other turn. `conversationId` (**new**) is present on every response — see the request field description above.

### Validation

- `message` must be a non-empty string after trimming.
- `messages`, if present, is filtered to only well-formed `{role, content}` objects; malformed entries are silently dropped.
- `bookingState`, if present, is structurally validated (`step` string + `slots` object) before use; a malformed value is treated as `null` rather than causing an error.

### Errors

- Missing/empty message → 400 with a plain message.
- OpenAI API failure (network error or non-OK HTTP response) → does not propagate an error to the client; instead silently falls back to the local rule-based reply with `source: "local_fallback"`.
- Database unreachable during a booking flow → the booking assistant does not error out to the client; it replies asking the guest to contact the team directly and still attempts to notify staff via Formspree (see `12_System_Logic.md`, section 5e).

### Notes

- This endpoint requires no authentication — it's a public endpoint.
- No rate limiting is defined in the code. **Not found in current project.**
- General Q&A replies from this endpoint do not themselves send email or WhatsApp messages — that logic lives client-side in `components/ApartmentChatbot.tsx` (see `12_System_Logic.md`, section 4), which separately calls the Formspree endpoint directly from the browser once it detects an email and phone number in the transcript. The AI booking assistant path is the exception: it **does** call Formspree itself, server-side, when a booking is created (section 5e) — independent of the client-side transcript-scanning logic.

### `GET /api/cron/send-reminders` — New

Server-side scheduled endpoint (`app/api/cron/send-reminders/route.ts`) that powers guest communication automation described in `12_System_Logic.md`, section 11d. Not called by any user-facing UI — triggered once daily by Vercel Cron per the schedule in `vercel.json` (`0 3 * * *` UTC).

**Auth:** if the `CRON_SECRET` environment variable is set, the request must include `Authorization: Bearer <CRON_SECRET>` or the endpoint returns `401 { "error": "Unauthorized" }`. Vercel supplies this header automatically on scheduled invocations. If `CRON_SECRET` is unset, the endpoint runs without authentication (not recommended in production).

**Response (200):**
```json
{
  "ok": true,
  "remindersSent": ["<bookingId>", "..."],
  "remindersFailed": [],
  "thankYousSent": ["<bookingId>", "..."],
  "thankYousFailed": []
}
```

**Behavior:**
- Finds bookings checking in tomorrow with status `PENDING`/`CONFIRMED`/`CHECKED_IN` and `reminderSentAt` still null; sends the pre-arrival reminder (email + WhatsApp link) via `lib/guestMessaging.js`, then stamps `reminderSentAt`.
- Finds bookings that checked out yesterday with status `CHECKED_OUT` and `thankYouSentAt` still null; sends the thank-you/review-request message, then stamps `thankYouSentAt`.
- A booking that fails to send is logged and listed under the `...Failed` array in the response but does not stop the rest of the batch from processing. Because its `*SentAt` field is still null, re-running the cron **later the same day** will retry it. **Known limitation:** the reminder/thank-you windows are both a fixed one-day lookback/lookahead from "today" — if the cron doesn't run at all on the day a booking is due (Vercel outage, deployment issue, etc.), that booking's date window passes and it will not be picked up by a later run; it would need a manual resend. This is a real gap, not yet handled by a wider catch-up window.

### `POST /api/bookings` — New

Public, unauthenticated endpoint (`app/api/bookings/route.ts`) backing the homepage "Book Now" form (`app/page.tsx`) — the single-shot counterpart to the AI chat's conversational booking flow. See `12_System_Logic.md`, section 19, for the full validate → check availability → calculate price → create booking → send confirmation write-up.

**Request:**
```json
{
  "roomId": "room_single",
  "checkIn": "2026-08-01",
  "checkOut": "2026-08-03",
  "guests": 2,
  "fullName": "Pema Lama",
  "phone": "9841234567",
  "whatsapp": "9841234567",
  "email": "pema@example.com",
  "specialRequests": "Late checkout please"
}
```
`roomId` must be a real `Room.id` (the client resolves this from `GET /rooms`, not a free-text room type). `whatsapp` and `specialRequests` are optional; `whatsapp` defaults to `phone` if omitted.

**Responses:**
- **201** — booking created: `{ bookingId, whatsappUrl, roomTitle, nights, totalPrice, capacityNote }`. `whatsappUrl` is `null` if messaging failed (the booking itself still succeeds — see the "never masks a successful booking" pattern used throughout this project). `capacityNote` is `null` unless the requested guest count exceeds the room's `maxGuests` (non-blocking, informational only).
- **400** — missing/invalid fields, a check-in date in the past, or check-out not after check-in.
- **404** — the room doesn't exist or isn't currently marked available.
- **409** — the room is fully booked for the requested dates (same `totalUnits`-aware conflict check every other booking path uses): `{ message: "<Room title> is already booked for <checkIn> to <checkOut>. Please choose different dates or another room." }`.
- **503** — the database couldn't be reached to check availability.
- **500** — the booking passed every check but couldn't be saved; the team is still notified via Formspree as a fallback so the lead isn't lost.

---

## Part 2 — Live Client-Side Integration: Formspree (Direct Booking Form)

Not a Jikmis-hosted API, but a third-party form-to-email service the live site depends on. **Updated:** the homepage booking form no longer calls this directly from the browser on a successful submission — it now goes through `POST /api/bookings` above, which notifies the team via Formspree server-side (alongside creating a real booking) instead. The client-side call described below now only fires as a fallback, if the form couldn't resolve a real database room to book (see `12_System_Logic.md`, section 3, step 5).

- **Endpoint:** `https://formspree.io/f/xvzepwkw` (configurable via `NEXT_PUBLIC_FORMSPREE_ENDPOINT`)
- **Method:** `POST`, JSON body
- **Used by:** the homepage booking form (`handleBookingSubmit`) and the chatbot's auto-notification logic (`sendBookingInfoFromChat`)
- **Booking form payload fields:** `_subject`, `name`, `email`, `phone`, `roomType`, `checkIn`, `checkOut`, `nights`, `guests`, `_replyto`
- **Chat auto-notify payload fields:** `_subject`, `email`, `phone`, `transcript`, `_replyto`
- **Response handling:** if the POST fails or returns a non-OK status, the UI shows an error message, but the WhatsApp deep link still opens regardless (see `12_System_Logic.md`).

---

## Part 3 — Legacy Express API (`/server`, not connected to the live homepage)

Base URL (local dev): `http://localhost:4000` (configurable via `PORT`/`HOST`; CORS restricted to `CLIENT_URL`).

### `GET /health`
Returns `{ "ok": true, "service": "jikmis-apartment-api" }`. No auth required.

### Auth Routes (`/auth`)

**Roles — New:** `User.role` is one of `USER` (guest self-service account, the only role `/auth/register` can create), `ADMIN` (Owner/Admin — full access), or `RECEPTION` (Reception Staff — front-desk operations only). See `13_Database_Summary.md` and `15_Admin_Guide.md`, section 5a, for the full permission breakdown. Staff accounts (`ADMIN`/`RECEPTION`) are created by an existing Owner via `POST /admin/staff` (below), never through public registration.

**`POST /auth/register`** — rate-limited (10 requests / IP / hour).
- Body: `{ name (string, min 2), email (valid email), phone (optional string), password (string, min 8) }`
- Success (201): `{ user: { id, name, email, phone, role }, token }` — `role` is always `USER`; the request body cannot set a role.
- Error (409): if email is already registered — `{ message: "Email is already registered." }`
- Error (400): validation failure — `{ message: "Validation failed.", errors: {...} }`
- Error (429): rate limit exceeded — `{ message: "Too many accounts created from this location. Please try again later." }`

**`POST /auth/login`** — rate-limited (10 requests / IP / 15 minutes).
- Body: `{ email (valid email), password (string, min 1) }`
- Success (200): `{ user: { id, name, email, phone, role }, token }`
- Error (401): `{ message: "Invalid email or password." }`, or, **new**, `{ message: "This account no longer has access. Contact an administrator." }` if the account has been deactivated (`User.isActive = false`, see `15_Admin_Guide.md`, section 5g).
- Error (429): rate limit exceeded — `{ message: "Too many login attempts. Please try again in a few minutes." }`

**`PATCH /auth/password`** — New. Requires auth (any role, including `USER`). Self-service password change.
- Body: `{ currentPassword (string), newPassword (string, min 8) }`
- Success (200): `{ message: "Password updated." }`
- Error (401): `{ message: "Current password is incorrect." }`

Passwords are hashed with bcrypt (12 rounds). Tokens are JWTs signed with `JWT_SECRET` (the server now refuses to start if this is unset or left at the `.env.example` placeholder value), containing `sub` (user id), `role`, `email`, expiring per `JWT_EXPIRES_IN` (default 7 days). **New:** every authenticated request re-checks the account against the database (`isActive` status, and the current `role` rather than the token's) — a deactivated account or a role change takes effect on the very next request, not only after the token expires.

### Room Routes (`/rooms`)

**`GET /rooms`** — Public. Query params: `type` (RoomType filter), `maxPrice` (filters `pricePerNight <= maxPrice`), `available` (`"true"` filters to `isAvailable: true`). Returns `{ rooms: [...] }`, sorted by `pricePerNight` ascending.

**`GET /rooms/:id`** — Public. Returns `{ room: {...} }` including nested `bookings` (checkIn, checkOut, status only). 404 if not found: `{ message: "Room not found." }`.

**`POST /rooms`** — Requires auth + admin role only (**"Manage rooms"/"Manage pricing" are Owner-only — Reception Staff get a 403**). Body validated against the room schema (`title`, `type` enum, `pricePerNight`, `pricePerMonth`, `description` min 10 chars, `facilities[]`, `rules[]`, `images[]` (must be valid URLs), `isAvailable`, `maxGuests`). Returns 201 with `{ room }`.

**`PUT /rooms/:id`** — Requires auth + admin role only. Same body schema as POST. Returns `{ room }`.

**`DELETE /rooms/:id`** — Requires auth + admin role only. Returns 204 No Content.

### Booking Routes (`/bookings`)

**Role gates — updated.** "Requires staff" below means Owner/Admin (`ADMIN`) **or** Reception Staff (`RECEPTION`) — a new `requireStaff` middleware (`server/src/middleware/auth.js`). "Requires admin" means Owner/Admin only, unchanged from before Reception existed.

**`GET /bookings`** — Requires auth (any role). Owner/Admin and Reception Staff see all bookings **(both AI-chat and legacy-form/manual, since they share the same table)**; a plain guest (`USER`) sees only their own. Returns `{ bookings: [...] }` with nested `room`, limited `user` fields (id, name, email, phone — `null` for AI-chat guest bookings), plus the guest* fields, `channel`, `amountPaid`, and `paymentMethod`, sorted by `createdAt` descending.

**`POST /bookings`** — Requires auth (any role — legacy authenticated flow only; the AI receptionist creates bookings directly via `lib/bookingAssistant.ts`, not this endpoint). Body: `{ roomId, checkIn (date), checkOut (date, must be after checkIn), guestCount (default 1), note (optional) }`.
- Validates the room exists and `isAvailable`; otherwise 404 `{ message: "Room is not available." }`.
- Checks for date-range conflicts against existing `PENDING`/`CONFIRMED`/`CHECKED_IN` bookings on the same room, now counted against the room's `totalUnits` (**updated** — previously any single overlap blocked the booking regardless of unit count); if the room is fully booked, 409 `{ message: "This room is already booked for the selected dates." }`.
- On success (201): `{ booking: {...}, whatsappUrl: string | null }` with `totalPrice` computed as `nights * pricePerNight` (nightly rate only — does not apply monthly pricing or negotiation rules), `channel: "legacy_form"`, `amountPaid: 0`. `whatsappUrl` is the same kind of pre-filled `wa.me` confirmation link the AI chat path returns — see `12_System_Logic.md`, section 11. Since this endpoint requires an authenticated `User`, no `Guest` record is created for it (see `12_System_Logic.md`, section 12) — the `User` already is the booking's identity.

**`POST /bookings/manual`** — **Requires staff** (Owner/Admin or Reception Staff — previously admin-only). For staff logging a walk-in/phone booking for a guest with no account. Body: `{ roomId, checkIn (date), checkOut (date), guestCount (default 1), guestName (required, min 2 chars), guestPhone (required), guestWhatsapp (optional, defaults to guestPhone), guestEmail (optional, valid email), specialRequests (optional), note (optional) }`. Same availability/conflict checking as `POST /bookings` (409 if fully booked, 404 if room unavailable). On success (201): `{ booking: {...}, whatsappUrl: string | null }` with `userId: null`, `channel: "admin_manual"`, and a matched-or-created `Guest` linked via `booking.guestId` — see `12_System_Logic.md`, sections 8h and 12, and `15_Admin_Guide.md`, section 5j.

**`PATCH /bookings/:id/status`** — **Requires staff** (previously admin-only). Body: `{ status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" }` (replaces the earlier `APPROVED`/`REJECTED` values). Returns updated `{ booking }`. If this moves the booking to `CONFIRMED` and it doesn't already have one, an `Invoice` row is auto-created (`13_Database_Summary.md`, section 13) — this never affects the response shape or blocks the status update if invoice creation fails. Reception Staff use this endpoint (status → `CANCELLED`) to cancel a booking, since `DELETE` is Owner-only (below).

**`PATCH /bookings/:id/payment`** — **Requires staff** (previously admin-only — "Update payments" is an explicit Reception capability). Body: `{ amountPaid: number, paymentMethod?: "cash" | "bank_transfer" | "esewa" | "khalti" }`. Rejects with 400 if `amountPaid` exceeds the booking's `totalPrice`. Returns updated `{ booking }`. "Remaining balance" is not a stored field — compute it client-side as `totalPrice - amountPaid`. The delta between the old and new `amountPaid` is also recorded as its own `Payment` ledger row (`13_Database_Summary.md`, section 12) — this never affects the response shape or blocks the update if logging fails. This is the older, **absolute-correction** endpoint (unchanged) — see the four new endpoints below for **payment management**'s incremental "record a payment" workflow, which coexists with this one rather than replacing it.

**`GET /bookings/:id/payments`** — **New. Requires staff.** Payment management's itemized "Payment history." Returns `{ payments: [{ id, amount, method, type, note, recordedAt, recordedByUser: { id, name } | null }, ...] }`, newest first. 404 if the booking doesn't exist.

**`POST /bookings/:id/payments`** — **New. Requires staff.** Payment management's "Record advance payment" / "Record remaining balance" / "Record other payment." Body: `{ amount: number (positive), method?: "cash" | "bank_transfer" | "esewa" | "khalti", type?: "advance" | "remaining" | "other" (default "other"), note?: string }`. **Incremental** — `amount` is *added* to the booking's existing `amountPaid`, unlike `PATCH /bookings/:id/payment` above which sets an absolute total. Rejects with 400 if the new total would exceed `totalPrice`: `{ message: "This payment would exceed the total price. Remaining balance is <n>." }`. On success (201): `{ booking: {...}, payment: {...} }` — both the updated booking and the newly created `Payment` ledger row.

**`GET /bookings/:id/invoice`** — **New. Requires staff.** Payment management's "Generate invoice PDF" / "View invoice" trigger — gets the booking's `Invoice`, creating it if it doesn't exist yet (same `getOrCreateInvoice` logic that auto-runs on `CONFIRMED`, see `13_Database_Summary.md`, section 13). Returns `{ invoice: {..., accessToken} }`. 404 if the booking doesn't exist. The caller builds the public invoice page URL as `<NEXT_PUBLIC_APP_URL>/invoice/<accessToken>`.

**`POST /bookings/:id/invoice/send`** — **New. Requires staff.** "Send invoice to guest." Requires the guest to have an email on file (`booking.user.email` or `booking.guestEmail`); otherwise 400: `{ message: "This guest has no email on file — cannot send an invoice." }`. On success (200): `{ sent: boolean, reason: string | null, invoiceUrl: string }` — `sent` mirrors `lib/mailer.js`'s `{sent, reason}` shape (`reason` is e.g. `"not_configured"` if SMTP isn't set up). Logs a `Notification` row (`13_Database_Summary.md`, section 15) the same way booking confirmation/reminder/thank-you emails already do, regardless of whether the send succeeded.

**`DELETE /bookings/:id`** — Requires auth. Only the booking's owner or an **Owner/Admin** may delete it — deliberately excludes Reception Staff, who cancel via the status endpoint above instead; otherwise 403 `{ message: "You cannot delete this booking." }`. 404 if booking doesn't exist. Returns 204 on success.

### Invoice Routes (`/invoices`) — New, public

**`GET /invoices/:token`** — **Public, no auth.** Backs the printable invoice page (`app/invoice/[token]/page.tsx`) — this endpoint, not `bookingId` or `invoiceNumber`, is what the page fetches. `:token` is the `Invoice.accessToken` (a random UUID) — the security boundary for this public endpoint, since `invoiceNumber` is sequential and guessable. 404 if the token doesn't match any invoice (`{ message: "Invoice not found." }`) — deliberately generic, doesn't leak whether a booking/invoice exists. On success (200), returns a fully sanitized, guest-facing shape:
```json
{
  "apartmentName": "Jikmis Apartment",
  "invoiceNumber": "JA-2026-0001",
  "issuedAt": "...",
  "guest": { "name": "...", "email": "...", "phone": "..." },
  "room": { "title": "...", "type": "SINGLE", "pricePerNight": 1500 },
  "checkIn": "...", "checkOut": "...", "guestCount": 2,
  "totalAmount": 3000, "subtotal": 3000, "taxAmount": 0,
  "amountPaid": 1500, "remaining": 1500,
  "paymentStatus": "partially_paid",
  "bookingStatus": "CONFIRMED",
  "payments": [{ "id": "...", "amount": 1500, "method": "esewa", "type": "advance", "recordedAt": "..." }]
}
```
`paymentStatus` is derived (`"unpaid"` / `"partially_paid"` / `"fully_paid"`), not stored. This is the endpoint whose response the "Generate invoice PDF"/"Download invoice" feature renders and the guest (or staff) prints/saves as a PDF via the browser — see `15_Admin_Guide.md`'s payment management section for why there's no server-generated PDF binary.

### Admin Routes (`/admin`)

**`GET /admin/dashboard`** — Requires auth + admin role only ("View reports" is Owner-only; Reception Staff get a 403). Returns (**updated** for the new status lifecycle and payment tracking):
```json
{
  "stats": {
    "totalBookings": 0,
    "pendingBookings": 0,
    "confirmedBookings": 0,
    "checkedInBookings": 0,
    "checkedOutBookings": 0,
    "cancelledBookings": 0,
    "rooms": 0,
    "users": 0,
    "totalRevenue": 0,
    "totalPaid": 0,
    "totalOutstanding": 0
  }
}
```
`totalRevenue`/`totalPaid`/`totalOutstanding` are summed across all non-cancelled bookings (`PENDING`, `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`).

**`GET /admin/analytics`** — **New.** Requires auth + admin role only (same "View reports" gate as `GET /admin/dashboard` above). Powers the analytics dashboard (`app/admin/analytics/page.tsx`, see `15_Admin_Guide.md`). Returns:
```json
{
  "totalBookings": 0,
  "todaysCheckIns": 0,
  "todaysCheckOuts": 0,
  "occupiedRooms": 0,
  "availableRooms": 0,
  "totalRoomUnits": 0,
  "monthlyRevenue": 0,
  "revenueTrend": [{ "month": "2026-02", "label": "Feb 2026", "revenue": 0 }, "... 6 entries, oldest first, current month last"],
  "pendingPayments": { "amount": 0, "count": 0 },
  "bookingSources": [{ "channel": "ai_chat", "count": 0 }, "... one entry per channel value in use, sorted by count descending"]
}
```
Field-by-field: `todaysCheckIns`/`todaysCheckOuts` count non-cancelled bookings whose `checkIn`/`checkOut` date is today (an arrivals/departures list, not restricted to bookings staff have already flipped to `CHECKED_IN`). `occupiedRooms`/`availableRooms`/`totalRoomUnits` are computed from `Room.totalUnits` against bookings currently spanning today (`checkIn <= today < checkOut`, status `PENDING`/`CONFIRMED`/`CHECKED_IN` — the same `OCCUPYING_STATUSES` convention used by the booking calendar, `12_System_Logic.md` section 16), capped per room at that room's `totalUnits` so a data anomaly is never reported as more rooms occupied than exist. `revenueTrend`/`monthlyRevenue` bucket non-cancelled bookings by their `checkIn` month (revenue attributed to the stay's month, the standard hospitality convention) across the last 6 calendar months including the current one; `monthlyRevenue` is just the current month's bucket. `pendingPayments` sums `totalPrice - amountPaid` across active (non-cancelled) bookings that aren't yet fully paid, plus how many such bookings there are. `bookingSources` groups every booking ever made (any status) by `channel` — see `13_Database_Summary.md`, section 5, for the channel values in use.

**`GET /admin/users`** — Requires auth + admin role only. Returns `{ users: [{ id, name, email, phone, role, createdAt }] }`, sorted newest first. Only includes users with accounts (legacy `/register` flow) — AI-chat guests never appear here since they don't create accounts. Includes staff accounts too, but see `GET /admin/staff` below for the dedicated staff-management view.

### Staff Routes (`/admin/staff`) — New, Owner/Admin only

The "Manage staff" capability. All three routes require auth + admin role; Reception Staff get a 403 on every one of them.

**`GET /admin/staff`** — Returns `{ staff: [{ id, name, email, phone, role, isActive, createdAt }] }` for every `ADMIN`/`RECEPTION` account, newest first.

**`POST /admin/staff`** — Creates a new staff account. Body: `{ name (min 2), email, phone (optional), password (min 8), role: "ADMIN" | "RECEPTION" }`. Success (201): `{ user: {...} }`. Error (409) if the email is already registered.

**`PATCH /admin/staff/:id`** — Updates a staff account. Body (all optional, at least one required): `{ role?: "ADMIN" | "RECEPTION", isActive?: boolean, name?: string, phone?: string }`. Two safeguards return 400 instead of applying the change:
- **Self-lockout guard:** a caller cannot deactivate or demote their own account.
- **Last-Owner guard:** the last remaining active `ADMIN` account cannot be deactivated or demoted by anyone.

Deactivating an account (`isActive: false`) does not delete it — its booking/payment history stays intact, and it's simply rejected by `requireAuth` on its next request (see the Auth Routes section above).

### Guest Routes (`/guests`) — New, Owner/Admin or Reception Staff

The "Manage guests" capability, over the deduplicated `Guest` records described in `13_Database_Summary.md` and `15_Admin_Guide.md`, section 5k — distinct from `/admin/users` (login accounts) and from the guest* snapshot fields stored directly on each `Booking`.

**`GET /guests`** — Optional `?search=` query param, matched against name/phone/whatsapp/email. Returns `{ guests: [...] }` (each including a `_count.bookings`), newest-updated first.

**`GET /guests/:id`** — Returns `{ guest: {...} }` including the guest's full booking history (with room details), newest first. 404 if not found.

**`PATCH /guests/:id`** — Body (all optional, at least one required): `{ name?, phone?, whatsapp?, email?, notes? }`. Returns updated `{ guest }`. 404 if not found.

Guest records themselves are still only ever *created* implicitly during booking (AI chat, admin-manual, guest matching) — these routes only read/search/edit existing ones.

### Legacy Chat Route (`/chat`, Express version)

A near-duplicate of the live Next.js chat logic, but **outdated**: its booking instructions state that "automatic email notification is not set up yet" (no longer true on the live site), and its `BOOKING_DETAILS_PROMPT` omits `email` from the list of details to collect. This route is not used by the live homepage.

### Error Handling (all legacy routes)

- `404` for unmatched routes: `{ message: "Route not found: <METHOD> <path>" }`
- `500` (or a custom `error.status`) for unhandled errors: `{ message: "<error message or 'Unexpected server error.'>" }`
- `400` for Zod validation failures: `{ message: "Validation failed.", errors: <zod flatten() output> }`
- `401` for missing auth: `{ message: "Authentication required." }`
- `401` for an invalid/malformed JWT: `{ message: "Invalid authentication token." }` (**updated**, distinguished from expired below)
- `401` for an expired JWT: `{ message: "Session expired. Please log in again." }` (**new** — previously indistinguishable from an invalid token)
- `401` for a deactivated or deleted account (valid token, but the account no longer qualifies — **new**): `{ message: "This account no longer has access. Contact an administrator." }`
- `429` for rate-limited login/register: see the Auth Routes section above
- `403` for insufficient role: `{ message: "You do not have permission to perform this action." }` (**updated** — previously `"Admin access required."`, generalized now that there are two staff roles, not just one)

---

## Part 4 — Unrelated Route: `/api/orders`

`app/api/orders/route.ts` exists in the codebase but is **not related to Jikmis Apartment**. It references an unrelated Google Sheets + Nodemailer order system tied to a different project/brand name, and its required environment variables are not present in `.env.example` or `.env.local`. This route should be treated as **out of scope** for apartment booking documentation and is flagged here only for completeness/transparency.

---

## Summary Table

| Endpoint | System | Auth | Purpose |
|---|---|---|---|
| `POST /api/chat` | Live (Next.js) | None | AI receptionist chat replies + booking assistant (writes directly to the shared database) |
| `POST /api/bookings` | Live (Next.js) | None | Homepage "Book Now" form — the AI chat's single-shot, non-conversational counterpart, same shared database (**new**) |
| `GET /api/cron/send-reminders` | Live (Next.js) | `CRON_SECRET` bearer token | Daily scheduled job: pre-arrival reminders + post-checkout thank-you/review requests (**new**) |
| Formspree (`/f/xvzepwkw`) | Live (third-party) | None | Emails booking/chat inquiries and new AI bookings to the team |
| `GET /health` | Express API | None | Health check |
| `POST /auth/register`, `/auth/login` | Express API | None (rate-limited) | Account creation/login (legacy authenticated flow only) |
| `PATCH /auth/password` | Express API | Auth required | Self-service password change (**new**) |
| `GET/POST/PUT/DELETE /rooms` | Express API | Mixed (writes need Owner/Admin) | Room CRUD, including `totalUnits` and availability — same `Room` table the AI booking assistant reads |
| `GET/POST/PATCH/DELETE /bookings` | Express API | Auth required (some need staff) | Booking CRUD, status lifecycle, conflict detection — same `Booking` table the AI booking assistant writes to |
| `POST /bookings/manual` | Express API | Staff required (**updated**, was admin-only) | Staff logs a walk-in/phone booking for a guest with no account |
| `PATCH /bookings/:id/status` | Express API | Staff required (**updated**, was admin-only) | Change a booking's status |
| `PATCH /bookings/:id/payment` | Express API | Staff required (**updated**, was admin-only) | Absolute-correction: set a booking's total `amountPaid` |
| `GET/POST /bookings/:id/payments` | Express API | Staff required | Payment management: itemized payment history / record an incremental advance-remaining-other payment (**new**) |
| `GET /bookings/:id/invoice` | Express API | Staff required | Payment management: get-or-create a booking's invoice (**new**) |
| `POST /bookings/:id/invoice/send` | Express API | Staff required | Payment management: email the invoice link to the guest (**new**) |
| `GET /invoices/:token` | Express API | None (public, token-secured) | Public printable invoice lookup — powers the "Download invoice" print-to-PDF page (**new**) |
| `GET /admin/dashboard`, `/admin/users` | Express API | Owner/Admin required | Admin analytics — now includes AI-chat bookings, since the admin dashboard (`/admin`) reads the same database (see `15_Admin_Guide.md`) |
| `GET /admin/analytics` | Express API | Owner/Admin required | Analytics dashboard: occupancy, today's arrivals/departures, revenue trend, pending payments, booking sources (**new**) |
| `GET/POST/PATCH /admin/staff` | Express API | Owner/Admin required | Staff account management — create, list, change role/active status (**new**) |
| `GET/PATCH /guests` | Express API | Staff required | Guest record search/detail/edit (**new**) |
| `POST /chat` (Express) | Legacy | None | Outdated duplicate of the live chat logic; not used by the live homepage |
| `/api/orders` | Unrelated | N/A | Not part of Jikmis Apartment — out of scope |

Note: the Express API (`/server`) is no longer purely "legacy" at the database level — its `Room`/`Booking` tables are the same ones the live AI receptionist's booking assistant reads and writes via `lib/prisma.ts`. Only the Express API's own routes/auth/pages remain a separate, secondary access path alongside the AI chat and `/admin` dashboard.

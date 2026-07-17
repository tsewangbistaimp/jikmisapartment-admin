# Jikmis Apartment — System Logic

This document describes how the Jikmis Apartment website actually works under the hood, based on the source code. There are **two separate systems** in this repository:

1. **The live guest-facing system** (Next.js homepage + AI chatbot + direct booking form) — this is what real guests interact with today.
2. **A legacy Express/Prisma backend** (`/server`, plus the `/booking`, `/rooms`, `/admin`, `/login`, `/register`, `/dashboard` pages) — per the project's own README, this is an earlier booking/admin module. Its database is now also used directly by the live AI receptionist's booking assistant (see section 3 below) — so this backend is no longer purely legacy at the database level, even though its Express API and authenticated pages remain a separate, secondary path.

## 1. Guest Workflow (Live System)

1. Guest lands on the single-page homepage (`app/page.tsx`).
2. Guest browses room showcase, video tour, amenities, café, and nearby-attractions sections.
3. Guest either:
   - Opens the AI chat widget (bottom-right) and asks questions or starts a booking, or
   - Scrolls to the "Direct Booking" section and fills out the booking form, or
   - Clicks "Book Now" in the navbar, which opens the same booking form in a full-screen modal on mobile.
4. **Homepage booking form path (updated — now database-backed, see section 19):** the same validate-dates → check-availability → calculate-price → create-booking → send-confirmation pipeline the AI chat path uses, just triggered by a single form submission instead of a conversation. This creates a real `PENDING` `Booking` row (`channel: "website"`), the guest gets a real confirmation email and a WhatsApp link, and the team is still notified via Formspree (now sent server-side, alongside the real booking, rather than being the only thing that happened). If the form's live room lookup is ever unreachable, it falls back to the original email-only-via-Formspree-plus-WhatsApp behavior rather than failing outright — see section 19.
5. **AI chat booking path:** if the guest asks the AI receptionist to book a room, the booking assistant (section 5) collects details conversationally, checks real availability in the database, calculates the price, and creates an actual `PENDING` `Booking` row — see below. Staff still manually verify the advance payment and move the booking to `CONFIRMED` (and later `CHECKED_IN`/`CHECKED_OUT`) via the admin dashboard; the AI never changes a booking's status itself.
6. **Either path lands in the exact same place:** both the AI chat and homepage form bookings are rows in the same `Booking` table the Express admin API and `/admin`/`/admin/calendar` dashboards read from — a booking made through the public website is visible to staff immediately, not on a delay and not through a different system.

## 2. AI Chat Decision Logic (`app/api/chat/route.ts`)

**Updated:** the live chat route now sources all apartment facts from this knowledge base (`/ai-knowledge-base`) instead of a separately maintained, hardcoded prompt string. See `lib/knowledgeBase.ts` and `scripts/generate-knowledge-base.js` for the loader/build system.

When a guest sends a chat message, the backend processes it through this decision order:

1. **Reject empty messages** — if no message text is present, return a 400 error.
2. **Check if it's a "source of truth" question** (`isSourceOfTruthQuestion`) — this checks whether the message matches any of these intents: availability, pricing, laundry, contact, discount, booking, room details, rules, facilities, or location (using keyword-matching functions like `isPriceQuestion`, `isAvailabilityQuestion`, etc.).
   - **If yes:** the reply is generated entirely from the deterministic, hardcoded `localReceptionistReply()` function — never from an AI language model. This guarantees pricing, availability, and policy answers are always exactly correct and never hallucinated. The response is tagged `source: "jikmis_source_of_truth"`. These deterministic replies mirror the facts in `02_Room_Types.md`, `03_Pricing.md`, and `06_House_Rules.md` — if those files change, the matching functions should be updated to match.
   - **Updated:** `localReceptionistReply()`, `isSourceOfTruthQuestion()`, and the keyword-matching functions now live in `lib/receptionistReplies.ts` (moved out of `route.ts` itself) and are language-aware — see section 20 for the full multi-language write-up and `16_Multilanguage_Support.md` for the deeper technical detail. `localReceptionistReply()` now returns `{ reply, lang }` rather than a plain string.
3. **If not a source-of-truth question, and no `OPENAI_API_KEY` is configured:** fall back to the same `localReceptionistReply()` logic, tagged `source: "local_fallback"`.
4. **If not a source-of-truth question, and an API key is configured:** the message (plus up to the last 8 turns of conversation history) is sent to OpenAI's Chat Completions API (`gpt-4o-mini` by default, `temperature: 0.3`, `max_tokens: 220`) along with a system prompt built from two parts: a condensed `BASE_INSTRUCTIONS` block (tone, formatting, "never invent" rules — condensed from `10_AI_Guidelines.md`) plus a dynamically injected `KNOWLEDGE BASE` block containing the markdown files relevant to the guest's question (via `buildKnowledgeContext()`).
5. **If the OpenAI call fails** (network error or non-OK response): fall back to `localReceptionistReply()` again, tagged `source: "local_fallback"`.
6. **If the OpenAI call succeeds:** return the model's reply text, or a hardcoded contact-info fallback line if the model returned nothing.

### Knowledge base topic routing (`lib/knowledgeBase.ts`)

For each guest message, `getRelevantKnowledge()` always includes `01_Apartment_Overview.md` and `10_AI_Guidelines.md`, then adds any topic files whose keywords match the message (rooms → `02_Room_Types.md`, pricing → `03_Pricing.md`, amenities → `04_Amenities.md`, booking/payment → `05_Booking_Policies.md`, rules → `06_House_Rules.md`, check-in/out → `07_Checkin_Checkout.md`, location → `11_Local_Guide.md`). If no topic keyword matches, `08_FAQ.md` is included as a broad fallback so open-ended questions are still grounded. Internal-only files (`09_Email_Templates.md`, `12_System_Logic.md`, `13_Database_Summary.md`, `14_API_Documentation.md`, `15_Admin_Guide.md`, `16_Multilanguage_Support.md`) are intentionally excluded from guest-facing chat context. `buildKnowledgeContext()` caps the assembled text at ~22,000 characters, dropping whole lowest-priority files (never truncating mid-file) if the cap would otherwise be exceeded.

### Knowledge base build pipeline

The markdown files in `/ai-knowledge-base` remain the single human-editable source of truth. `scripts/generate-knowledge-base.js` reads all 16 files and generates `lib/knowledgeBase.generated.ts` (plain TypeScript string constants) so the knowledge base is bundled safely regardless of deployment target (avoids relying on runtime `fs` reads, which aren't guaranteed to be included in a Next.js "standalone" or serverless build). This generation step runs automatically via `predev`/`prebuild` npm hooks, and can be run manually with `npm run knowledge:build` after editing any file in `/ai-knowledge-base`.

### Intent matching inside `localReceptionistReply()`

The rule engine checks (in priority order): combined price+availability, combined price+room-details, combined location+facilities, availability alone, greeting, laundry, contact, discount, booking (further split into payment vs. general booking), airport pickup (always redirected to direct contact, never confirmed), price alone, room details, generic room-type keywords, facilities, location, rules, stay-type keywords (student/long-term/short-term), human-assistance requests, and finally a generic fallback (now phrased to ask for confirmation rather than guess) if nothing matches.

## 3. Booking Form Logic (`app/page.tsx`, `handleBookingSubmit`) — Updated, now database-backed

1. Guest fills in Room Type, Guests, Check-in, Check-out, Full Name, Email, Phone.
2. Date inputs are constrained with HTML5 `min` attributes: check-in cannot be before today; check-out cannot be before the selected check-in date (or today if no check-in is set yet). If a guest changes check-in to a date on/after the current check-out, check-out is cleared.
3. Nights are calculated client-side via `calculateNights(checkIn, checkOut)` (from `lib/site.ts`) and shown live as a "X night(s) total" preview.
4. **Room resolution (new):** on mount, the page fetches the real `Room` rows from the database (`GET /rooms?available=true`, the same public Express endpoint the standalone `/rooms` page uses) into `dbRooms`. At submit time, the form's short display title (from the hardcoded `roomShowcase` marketing array — "Single Studio," "Double Studio," "Family Room") is matched to the corresponding real `Room.title` ("Single Studio Room," etc.) via `resolveDbRoom()` (a simple `startsWith` match — safe here since it's a small, fixed 3-item mapping, not guest-typed free text). `roomShowcase` itself (images, descriptions, amenities — none of which exist in the `Room` table) is untouched; only the booking form's submission needs a real room record.
5. **If a real room can't be resolved** (the `/rooms` fetch hasn't completed yet, or failed): falls back to exactly the form's original behavior — POST to Formspree, then always open a pre-filled WhatsApp deep link in a `finally` block — so a guest's request is never silently lost just because live room data wasn't available at that moment.
6. **If a real room is resolved:** the form POSTs to `POST /api/bookings` (a public, unauthenticated Next.js API route — see section 19) instead of Formspree directly. This runs the full validate → check availability → calculate price → create booking → send confirmation pipeline server-side and returns a booking reference, room title, nights, total price, and (if sending succeeded) a WhatsApp confirmation link, which the client opens automatically.
7. UI shows a real success message (booking reference + price) or a specific error message (e.g., "already booked for these dates") depending on the API's response — no longer a generic "email sent" message regardless of what actually happened.

## 4. Chat Auto-Notification Logic (`components/ApartmentChatbot.tsx`)

1. After every bot reply, the full conversation transcript (guest + bot messages) is scanned with regular expressions for an email address and a phone number.
2. **If both an email and a phone number are found in the transcript** (and this hasn't already been triggered once this session, tracked via `hasSentBookingInfoRef`):
   - A WhatsApp deep link is built containing the guest's email, phone, and full transcript.
   - The transcript is POSTed to the Formspree endpoint with subject `"New Jikmis Apartment chat booking inquiry"`.
   - The WhatsApp tab opens automatically.
   - A confirmation message is appended to the chat telling the guest their details were sent to the team (and to WhatsApp).
3. This only fires once per chat session, regardless of how many more messages follow.

## 5. AI Booking Assistant (`lib/bookingAssistant.ts`) — New

When a guest asks the AI receptionist to actually book a room (detected via `isStartBookingIntent()` — phrases like "book a room," "I want to reserve," "book now"), the chat route (`app/api/chat/route.ts`) hands off to a **separate, deterministic, database-backed booking flow** instead of the OpenAI/local-fallback reply engine described in section 2. This flow is never routed through an LLM, since creating a real booking is transactional and must never invent a date, price, or availability status.

### 5a. Conversation state

The chat API is stateless between requests (no server-side session store). Booking progress is carried in a `bookingState` object that the chat route returns to the client and the client (`components/ApartmentChatbot.tsx`, via `bookingStateRef`) stores and re-sends on every subsequent request. While `bookingState` is present, every guest message is routed to the booking assistant, with two exceptions: a "cancel"/"stop" message clears it entirely (section 5f), and — **new, see section 21** — an unrelated factual question at the phone/WhatsApp/email/special-requests steps is answered on the spot without disturbing `bookingState` at all, then the same question is re-asked.

`bookingState` also now carries a `lang` field, detected once from whichever message started the flow and kept for its entire duration — see section 20.

**New:** the client (`components/ApartmentChatbot.tsx`) also persists the visible transcript, `bookingState`, `conversationId`, and the recognized guest name to the browser's `sessionStorage` (cleared when the tab closes, not `localStorage`) after every turn, and restores them on mount. A page refresh mid-conversation no longer starts the guest over from scratch.

### 5b. Slot-filling order

The assistant asks for one field at a time, in this fixed order: room type → check-in date → check-out date → number of guests (availability is checked and price is calculated immediately after guests, before any personal details are collected) → full name → phone → WhatsApp number (guest can reply "same" to reuse their phone number) → email → special requests → a final yes/no confirmation showing the full summary and price.

### 5c. Real availability check

Once room type, check-in, and check-out are known, the assistant queries the actual `Room` and `Booking` tables (via `lib/prisma.ts`, the same database as the Express backend — see `13_Database_Summary.md`). It counts existing `PENDING`/`CONFIRMED`/`CHECKED_IN` bookings for that room whose dates overlap the requested range, and compares that count against the room's `totalUnits` (Jikmis Apartment has 2 Single Studio units, 2 Double Studio units, 1 Family Room unit). If the room is fully booked for those dates, the guest is told immediately and asked to try different dates or a different room type — before any contact details are collected. The check runs a second time immediately before the booking is actually written, to close the race-condition window where another guest could book the same unit while this guest was still filling in their details.

### 5d. Price calculation

Total price = nights × the room's `pricePerNight` (same nightly-rate-only calculation as the legacy backend's `calculatePrice()` — see 8c below). The assistant never applies a monthly rate or a negotiated discount automatically; those remain a staff/owner-approved manual process per `03_Pricing.md`.

### 5e. Booking creation

On guest confirmation, a real `Booking` row is created with `status: "PENDING"`, `channel: "ai_chat"`, `userId: null`, and the guest's details stored in the new `guestName`/`guestPhone`/`guestWhatsapp`/`guestEmail`/`specialRequests` fields (no fake user account is created). The team is notified via the same Formspree endpoint used elsewhere on the site, with the full booking details and the generated booking ID. The guest receives a confirmation reply with their booking reference, a summary, and the 50% advance payment instructions from `05_Booking_Policies.md`. If the database write fails for any reason, the assistant does not pretend the booking succeeded — it tells the guest it's having trouble saving and still notifies the team so the lead isn't lost.

### 5f. What the AI booking assistant does NOT do

It does not move a booking past `PENDING` (only a human admin does that, via the admin dashboard, after verifying the advance payment), does not process payment itself, does not touch `Room.isAvailable` (that remains a separate manual global toggle in the admin dashboard), and does not apply monthly/negotiated pricing automatically.

## 6. Availability Logic — General Chat Replies (Section 2's rule engine)

Outside of an active booking flow, general availability *questions* (e.g., "is the family room available?") are still answered by the deterministic rule engine in section 2 using the static three-line availability text in `02_Room_Types.md`, section 4 — this text must still be manually kept current by the property owner. Only the booking assistant (section 5) performs a real, live database availability check; the general Q&A rule engine does not query the database.

## 7. Room Status Logic (Live System)

There is no live "room status" field guests can query outside of a booking flow, beyond the three static availability lines referenced above. Room type marketing details (pricing, capacity, inclusions) shown in general chat replies are static content in the homepage and chatbot data, not pulled from the live database — only the booking assistant's real-time availability/price check reads the database.

## 8. Legacy Backend System (Express + Prisma) — Now Shares Its Database With the Live AI Booking Assistant

This system exists in the repository (`/server`, plus `/booking`, `/rooms`, `/rooms/[id]`, `/admin`, `/login`, `/register`, `/dashboard` pages) and is still **not wired into the live homepage's UI** — but as of the AI booking assistant (section 5), its **database** is no longer legacy-only, since both this Express API and the Next.js booking assistant now read/write the same `Room`/`Booking` tables.

### 8a. Room & Booking Data Model
See `13_Database_Summary.md` for full schema, including the new `totalUnits`, guest contact fields, optional `userId`, and `channel`.

### 8b. Real Availability Conflict Logic (legacy)
- `hasBookingConflict(roomId, checkIn, checkOut)` now counts existing bookings on the same room with status `PENDING`, `CONFIRMED`, or `CHECKED_IN` whose date range overlaps the requested range (`checkIn < requestedCheckOut AND checkOut > requestedCheckIn`), and compares the count against the room's `totalUnits` — **updated** to match the booking assistant's `countOverlappingBookings()` (section 5c) so both paths agree on availability for rooms with multiple physical units. `CHECKED_OUT` and `CANCELLED` bookings no longer block new bookings.
- `createBooking()` rejects the booking with a 404 if the room doesn't exist or `isAvailable` is false, and rejects with a 409 if the room is fully booked (overlapping count ≥ `totalUnits`).

### 8c. Pricing Calculation (legacy)
- `nightsBetween(checkIn, checkOut)` = `ceil((checkOut - checkIn) / 86,400,000 ms)`, floored at 0.
- `calculatePrice(room, checkIn, checkOut)` = `nights * room.pricePerNight`.
- The AI booking assistant (section 5d) uses the identical nights × nightly-rate formula, so pricing is consistent between the legacy API and the AI-created bookings. Neither applies monthly pricing or the monthly negotiation rules documented in `03_Pricing.md` automatically.

### 8d. Booking Status Workflow — **Updated lifecycle**
- New bookings default to `PENDING`, regardless of channel (legacy form or AI chat).
- An admin can move status through `PENDING` → `CONFIRMED` → `CHECKED_IN` → `CHECKED_OUT`, or to `CANCELLED` at any point, via `PATCH /bookings/:id/status`. This replaces the earlier simple `APPROVED`/`REJECTED` approval flow with a hospitality-style stay lifecycle — see `13_Database_Summary.md`.
- Payment is tracked separately via `PATCH /bookings/:id/payment` (`amountPaid`, optional `paymentMethod`) — see 8g below.
- A booking can be deleted by its owner (if it has one) or by an admin.

### 8e. Auth Workflow (legacy only) — **Updated for role management**
- Registration hashes the password with bcrypt (12 rounds) and creates a `User` record with role `USER` by default — the registration request body cannot set a role, so public sign-up can never create a staff account.
- Login verifies the password hash and issues a JWT (`signToken`) containing `sub` (user id), `role`, and `email`, expiring per `JWT_EXPIRES_IN` (default 7 days). Login also now rejects (401) if the account has been deactivated (`isActive: false`).
- `requireAuth` verifies the JWT, then (**new**) re-reads the account from the database on every request — rejecting it if it no longer exists or `isActive` is false, and using the freshly-read `role` rather than the token's, so a mid-session deactivation or role change takes effect on the very next request rather than waiting for the token to expire. It also now distinguishes an expired token from an invalid one in its error message.
- `requireRole(...roles)` (**new**, generalizes the old `requireAdmin`) gates a route to a specific set of roles; `requireAdmin = requireRole("ADMIN")` (Owner/Admin only) and `requireStaff = requireRole("ADMIN", "RECEPTION")` (either staff role) are the two gates used throughout the API — see section 15 below for the full role model.
- Guest bookings from the AI receptionist never go through this auth flow — they don't need an account.
- A self-service `PATCH /auth/password` endpoint (**new**) lets any authenticated account rotate its own password.
- `POST /auth/login` and `POST /auth/register` are now rate-limited per IP (in-memory, single-process — see `server/src/middleware/rateLimit.js`) to slow down brute-force/credential-stuffing and spam sign-ups.
- The server now refuses to start (`server/src/index.js`) if `JWT_SECRET` is unset or still equals the `.env.example` placeholder value, rather than silently signing every token with an unusable secret.

### 8f. Admin Dashboard Workflow — **Now live, not legacy-only**
`GET /admin/dashboard` aggregates: total bookings, counts per status (pending/confirmed/checked-in/checked-out/cancelled), total rooms, total users, total value of active (non-cancelled) bookings, total amount paid, and total outstanding balance — across ALL bookings regardless of channel, since AI-chat and legacy-form bookings share the same `Booking` table. `app/admin/page.tsx` (the actual admin UI) renders this alongside a per-booking list showing guest details, a channel badge, a status dropdown, and inline payment editing — see `15_Admin_Guide.md`, section 5, for the full guide.

### 8g. Payment Tracking — **New**
`PATCH /bookings/:id/payment` (admin-only) sets `Booking.amountPaid` (and optionally `paymentMethod`, one of `cash`/`bank_transfer`/`esewa`/`khalti`), validated to never exceed `totalPrice`. "Remaining balance" is always computed as `totalPrice - amountPaid` at read time rather than stored, so it can never drift out of sync. This is a manual record of payments staff have verified (e.g., from a WhatsApp screenshot) — there is still no automated payment gateway integration.

### 8h. Admin-Logged Manual Bookings — New
`POST /bookings/manual` (admin-only) lets staff log a booking on behalf of a guest with no account — a walk-in or phone reservation. It reuses the exact same `guestName`/`guestPhone`/`guestWhatsapp`/`guestEmail`/`specialRequests` fields the AI receptionist uses (`userId: null`), sets `channel: "admin_manual"`, and goes through the identical availability-conflict check, price calculation, and guest communication automation (section 11) as every other booking path — the only difference is a staff member typed the details instead of a guest typing them in chat, or the guest filling out the (database-less) homepage form. `createBooking()` in `server/src/services/bookingService.js` was extended to accept these guest fields for this purpose; when `userId` is set instead (the original authenticated `POST /bookings` flow), they're simply left unset as before. The admin UI form lives in `app/admin/page.tsx` ("Log a booking") — see `15_Admin_Guide.md`, section 5j.

## 9. Calendar/Date Logic Summary

| System | Logic |
|---|---|
| Live booking form | HTML5 date inputs with `min` constraints only (no conflict checking); nights computed client-side for display; no database write |
| Live chatbot — general Q&A | No date logic at all beyond referencing the 3 static availability lines |
| Live chatbot — AI booking assistant | Real overlapping-date-range conflict detection against the database, aware of `totalUnits` per room, re-checked immediately before writing the booking |
| Legacy backend API | Real overlapping-date-range conflict detection per room, `totalUnits`-aware (same logic as the AI booking assistant — see 8b), enforced server-side at booking creation |

## 10. Recommendation for the AI Reservations Manager

Outside of an active booking flow, the AI must never claim a date range is "confirmed available" from the static Q&A text — it should present that as provisional and defer to the booking assistant (section 5) or human staff for a real check, consistent with `10_AI_Guidelines.md`. Inside the booking assistant flow, availability responses ARE backed by a real database query and can be treated as accurate as of that moment — though a small race-condition window remains between checking and final confirmation, which the assistant re-checks for at write time.

## 11. Guest Communication Automation — New

Booking confirmation, pre-arrival reminder, and post-checkout thank-you/review messages are generated by one shared module, `lib/guestMessaging.js`, required by BOTH booking paths (`lib/bookingAssistant.ts` for AI-chat bookings, `server/src/services/bookingService.js` for legacy-form bookings) so message content and sending logic exist in exactly one place. This mirrors the "same database" requirement from section 8 — AI bookings and manual bookings now also get the same communication behavior. Message wording is sourced from `09_Email_Templates.md` (templates 2, 13, 14); see that file's "Live automation note" if editing copy.

### 11a. Email delivery (`lib/mailer.js`)
A thin `nodemailer` wrapper, configured via generic SMTP environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — see `.env.example`), so any standard SMTP relay (Gmail, Resend, SendGrid, etc.) works. If SMTP isn't configured, `sendMail()` logs a warning and resolves with `{ sent: false, reason: "not_configured" }` instead of throwing — missing email configuration never blocks booking creation or the cron job.

### 11b. WhatsApp — what is and isn't automated
There is no WhatsApp Business API (Meta) configured in this project, so a fully silent server-to-WhatsApp push is not possible. "WhatsApp confirmation/reminder/thank-you" in practice means a pre-filled `wa.me` deep link:
- **At booking time**, the chat client (`components/ApartmentChatbot.tsx`) auto-opens this link in a new browser tab for AI-chat guests, the same pattern already used for the existing team-notification WhatsApp hand-off. This still requires the guest to tap "send" themselves.
- **For the reminder and thank-you messages**, sent later by a cron job when the guest isn't on the site, there's no tab to auto-open — the link is instead embedded inside the automated email as a tap-to-message button.

### 11c. Booking creation: confirmation (immediate)
Right after a `Booking` row is created (both `lib/bookingAssistant.ts`'s `finalizeBooking()` and `bookingService.js`'s `createBooking()`), the system calls `sendBookingConfirmation(booking)`: sends the confirmation email (if the guest has an email on file) and builds the WhatsApp confirmation link. On success, `Booking.confirmationSentAt` is stamped with the current time. If messaging fails for any reason, the error is logged but the booking itself is never rolled back or hidden from the guest — a messaging failure must never look like a booking failure.

### 11d. Cron job: pre-arrival reminder and post-checkout thank-you (`app/api/cron/send-reminders/route.ts`)
A daily scheduled job (configured in `vercel.json`, `0 3 * * *` UTC) does two passes:
- **Pre-arrival reminders:** finds bookings with `checkIn` falling tomorrow, status still occupying the room (`PENDING`/`CONFIRMED`/`CHECKED_IN`), and `reminderSentAt` still null. Calls `sendPreCheckinReminder()`, then stamps `reminderSentAt`.
- **Post-checkout thank-you:** finds bookings with `checkOut` falling yesterday, status `CHECKED_OUT`, and `thankYouSentAt` still null. Calls `sendPostCheckoutThankYou()`, then stamps `thankYouSentAt`. **Note:** because this requires status `CHECKED_OUT` specifically (not just a past checkout date), the thank-you message only goes out once an admin has actually moved the booking to `CHECKED_OUT` in the dashboard — see `15_Admin_Guide.md`.
- Both passes gate purely on the relevant `*SentAt` field being null, so re-running the job (or Vercel retrying it) never double-sends a message for the same booking.
- The endpoint is protected by `CRON_SECRET` (checked as a `Bearer` token in the `Authorization` header) when that environment variable is set; Vercel Cron supplies this automatically. If `CRON_SECRET` is left unset, the endpoint runs unauthenticated — it should always be set in production.

### 11e. What this system does NOT do
It does not send SMS. It does not use a real WhatsApp Business API — every "WhatsApp send" is a link, not a push message, per 11b. It does not send a review-platform-specific link — there is no dedicated review link configured anywhere else in this project, so the thank-you message reuses the site's existing, already-verified Google Maps link rather than inventing a placeholder. It does not retry failed emails automatically — a failed send is logged and the `*SentAt` field stays null, so the next cron run (for reminders/thank-you) or a future manual resend would need to be triggered separately; booking confirmation failures are not automatically retried at all.

### 11f. Notification audit log — New
Every send attempt in 11c and 11d (both channels — `email` and `whatsapp_link` — separately) is also logged as its own `Notification` row (`prisma/schema.prisma`), via a small `logNotifications()` helper duplicated identically in `lib/bookingAssistant.ts`, `server/src/services/bookingService.js`, and the cron route — each writes through its own already-instantiated Prisma client rather than through `lib/guestMessaging.js` itself, since that file is shared across two runtimes that each need their own Prisma Client (see `13_Database_Summary.md`, section 15, for why). This is a full history including failures, distinct from the `*SentAt` fields' idempotency-only purpose. A logging failure here is caught and swallowed — it never masks that the underlying message was already sent/attempted.

## 12. Guest Identity Linking — New

`findOrCreateGuest()`, implemented identically in `lib/bookingAssistant.ts` and `server/src/services/bookingService.js`, runs during booking creation whenever there's no linked `User` account (`userId` is null) and a phone or email was collected. It matches an existing `Guest` record by phone (falling back to email), enriching any missing `whatsapp`/`email` field on a match but never overwriting existing data, or creates a new `Guest` if no match is found. The resulting `guestId` is stored on the `Booking` alongside its existing `guestName`/`guestPhone`/`guestWhatsapp`/`guestEmail` snapshot fields, which are completely unaffected by this — see `13_Database_Summary.md`, section 11, for the full rationale. A matching failure is logged and swallowed; the booking still records the guest* snapshot fields regardless of whether a `Guest` was successfully linked.

## 13. Payment Ledger and Invoicing — Updated (payment management)

`PATCH /bookings/:id/payment` (section 8g) does two things: it still updates `Booking.amountPaid`/`paymentMethod` exactly as before (nothing about that contract changed), and it additionally writes a `Payment` row recording the **delta** between the old and new `amountPaid`, tagged with the method and the recording staff member's user id. `PATCH /bookings/:id/status` (section 8d) also auto-creates an `Invoice` the first time a booking's status reaches `CONFIRMED`, with a sequential `JA-<year>-<0001>`-style invoice number, `subtotal`/`totalAmount` set from the booking's `totalPrice`, and `taxAmount` defaulted to 0 (no tax policy is documented in this project). **New — payment management (section 17) adds a second, incremental way to record payments and a full staff-facing invoice workflow on top of this.** See `13_Database_Summary.md`, sections 12–13, for the full field-level detail and known limitations (invoice numbering isn't atomically race-proof, but is safe in practice for this property's manual, staff-driven workflow).

## 14. AI Conversation Persistence — New

`POST /api/chat` now persists every turn to `AiConversation`/`AiMessage` (`prisma/schema.prisma`) via a `persistConversationTurn()` helper. The chat API itself remains stateless per-request — exactly the same pattern already used for `bookingState` (section 5a) is extended to a `conversationId`: the client sends whatever `conversationId` it has (`null` on the first message), the server resolves or creates the matching `AiConversation`, appends the user message and the assistant's reply (tagged with the same `source` value the response already includes), updates `lastMessageAt`, and returns the `conversationId` for the client to echo on the next turn — see `components/ApartmentChatbot.tsx`'s `conversationIdRef`. If the turn is the one that creates a booking (via the booking assistant, section 5), the conversation is retroactively linked to that `Booking` — and to its `Guest`, if one was matched (section 12) — so a transcript can always be traced back to the reservation it produced, if any. Persistence is best-effort: a database error here is logged and never blocks, delays, or alters the reply already sent to the guest. There is no admin UI to browse transcripts yet — see `13_Database_Summary.md`, section 14.

## 15. Role-Based Access Control — New

The auth system now distinguishes three `User.role` values (see `13_Database_Summary.md`, section 2) and gates every staff-facing route accordingly:

- **`USER`** — a guest's own self-service account (legacy authenticated booking flow, `/register`). Unrelated to staff; only sees/creates its own bookings via `GET`/`POST /bookings`.
- **`ADMIN` (Owner/Admin)** — full access. Only role that can reach: `POST/PUT/DELETE /rooms` (manage rooms/pricing), `GET /admin/dashboard` (view reports), `GET/POST/PATCH /admin/staff` (manage staff), and `DELETE /bookings/:id` (alongside the booking's own owning user).
- **`RECEPTION` (Reception Staff)** — day-to-day front desk operations: `POST /bookings/manual` (create bookings for walk-in/phone guests), `PATCH /bookings/:id/status` and `PATCH /bookings/:id/payment` (update payments, and cancel via status instead of hard-delete), `GET/PATCH /guests` (manage guests), and `GET /bookings` (view availability/all bookings, same as Owner). Cannot reach any Owner-only route above — gets a 403.

**Staff management (Owner-only, `server/src/controllers/staffController.js`):** create a staff account with a role, list all staff, and update a staff account's role/active-status/name/phone. Two guardrails prevent an Owner from locking every Owner out of the system: a caller can't deactivate or demote their own account, and the last remaining active `ADMIN` account can never be deactivated or demoted by anyone else.

**Guest management (Owner + Reception, `server/src/controllers/guestController.js`):** search/list `Guest` records, view a guest's full booking history, and edit their contact details/notes — the read/edit surface that was missing over the `Guest` table added in the earlier database-structure pass (`13_Database_Summary.md`, section 11). Guest records themselves are still only ever created implicitly during booking, not through this API.

**"Manage settings" — not implemented as a literal screen.** There is no dynamic settings table or page anywhere in this project for the AI/any role to read from. This capability is understood to map to the mutable configuration that already exists and is already Owner-only (room/pricing management, staff management) plus environment-variable-level configuration that only a developer touches — not a runtime "Settings" UI. This gap is flagged explicitly (see `15_Admin_Guide.md`, section 9) rather than inventing a settings screen that isn't in the code.

**Admin UI role-awareness (`app/admin/page.tsx`):** both `ADMIN` and `RECEPTION` log in and land on the same `/admin` dashboard (`app/login/page.tsx`'s post-login redirect now checks for either role). The page reads the logged-in user's role from `localStorage` (set at login) and conditionally hides the Owner-only sections — dashboard stats/reports, Staff management, Room management — from Reception Staff, rather than letting them hit a 403 from the API. The previously-flagged hardcoded demo login credentials pre-filled on `/login` have also been removed.

## 16. Booking Calendar (`/admin/calendar`) — New

A second, more visual staff UI over the exact same `Booking`/`Room` data as the `/admin` bookings list (section 8f) — no new database tables, no new API endpoints. Two files: `lib/calendarLogic.ts` (pure, framework-free scheduling/overlap math, independently unit-tested) and `app/admin/calendar/page.tsx` (the React page, staff-gated the same way as `/admin`).

**Unit-row assignment.** `Room` has no concept of individual physical unit records — a room *type* like "Single Studio Room" is one database row with `totalUnits: 2`. To display each physical unit as its own horizontal row (the way a real front-desk chart works), `assignRows()` in `lib/calendarLogic.ts` runs the classic "minimum meeting rooms" greedy interval-packing algorithm: bookings are sorted by check-in and each one is placed in the first row whose most recent booking doesn't overlap it, opening a new row only when none of the existing rows have space. `buildRoomTracks()` wraps this per room: real (non-cancelled) bookings are packed into at most `totalUnits` rows and flagged `overbooked` if that's ever exceeded (a genuine data-integrity signal — see below), while cancelled bookings get their own, separately-packed track underneath since a cancellation never actually occupies a unit.

**Overlap semantics match the rest of the system exactly.** The half-open range check (`checkIn < otherCheckOut && checkOut > otherCheckIn`, so a same-day checkout/check-in turnover never counts as a conflict) and the `OCCUPYING_STATUSES` list (`PENDING`/`CONFIRMED`/`CHECKED_IN`) are copied verbatim from `server/src/services/bookingService.js`'s `hasBookingConflict()` and `lib/bookingAssistant.ts`'s `countOverlappingBookings()` — all three must be kept in sync if the booking lifecycle ever changes; this is a known, pre-existing duplication pattern in this codebase (see `12_System_Logic.md`, section 8b), not something new introduced here.

**"Overbooked" flag.** If unit-row assignment for a room ever needs more rows than `Room.totalUnits`, the calendar shows a visible "Overbooked — check manually" banner rather than silently rendering extra rows. This should never happen if the server's own conflict check (on `POST /bookings/manual`, and the AI booking assistant) is working correctly — seeing it is a signal of either a genuine bug or manually-edited data bypassing the normal booking paths, not expected behavior.

**Quick-create overlap prevention.** The calendar's "click an empty date to log a booking" flow runs `hasClientSideConflict()` — the same overlap formula applied to whatever bookings are already loaded client-side — purely to warn the user before they submit. This is explicitly documented as a UX convenience only; the actual prevention is (and remains) the server's own `POST /bookings/manual` 409 response, since the client's view of the data can be up to one poll interval stale. The calendar never re-implements or forks the authoritative conflict logic — it borrows the same formula for an early warning and then defers entirely to the server's answer.

**Real-time updates: polling, not push.** This project has no WebSocket or Server-Sent-Events server anywhere (the live site is Next.js API routes plus a separate long-running Express process — see the top of this document) — building either for a single new page would be a disproportionate amount of new infrastructure. Instead, `app/admin/calendar/page.tsx` polls `GET /bookings`/`GET /rooms` every 15 seconds, refetches immediately on window `focus` and on `visibilitychange` (tab becoming active again), and pauses the interval entirely while `document.hidden` is true. Every local write (status change, payment update, new booking) also updates React state immediately rather than waiting for the next poll, and a small "Updated Xs ago" indicator with a manual Refresh button keeps staff informed of exactly how fresh the screen is. Two staff members using the calendar simultaneously will converge within one poll interval (~15s), not instantly — this is a deliberate, documented interpretation of "real time" given the project's actual infrastructure, not a silent limitation.

## 17. Payment Management — New

Adds an incremental way to record payments and a full staff-facing invoice workflow on top of the payment ledger/invoicing described in section 13, without changing either of that section's existing endpoints.

**Incremental payment recording (`POST /bookings/:id/payments`, `server/src/controllers/bookingController.js`'s `recordPayment()`).** Unlike `PATCH /bookings/:id/payment` (section 13), which takes an absolute new `amountPaid` total — the shape a "correct a mistake" UI needs — this endpoint takes an `amount` that's **added** to the existing `amountPaid`, plus a `type` (`advance`/`remaining`/`other`), which is how staff actually described the task ("the guest just paid me X"). Both endpoints write to the same `Booking.amountPaid` field and the same `Payment` table, so they stay in sync automatically; a client can freely mix using either one on the same booking. A payment that would push `amountPaid` above `totalPrice` is rejected with a 400 and never applied.

**Invoice get-or-create (`getOrCreateInvoice()`, shared by both `PATCH /bookings/:id/status` and the new invoice endpoints).** The auto-creation-on-`CONFIRMED` trigger from section 13 is unchanged, but invoice creation is now also reachable on demand — `GET /bookings/:id/invoice` and `POST /bookings/:id/invoice/send` both call the same `getOrCreateInvoice(booking)` function, so staff can generate/view/send an invoice for a booking that hasn't reached `CONFIRMED` yet, not only after. The function is idempotent (a booking can only ever have one `Invoice`, enforced by `bookingId`'s unique constraint) and additionally backfills a freshly generated `accessToken` onto any older invoice row that predates that column, so no pre-existing invoice is ever left inaccessible.

**Public invoice access (`GET /invoices/:token`, `server/src/controllers/invoiceController.js`).** The security boundary for this public, unauthenticated endpoint is `Invoice.accessToken` itself — a random UUID generated once per invoice — deliberately **not** `Invoice.invoiceNumber`, which is sequential (`JA-<year>-<0001>`) and would let anyone iterate it to view other guests' names, contact details, and payment amounts. An unknown token 404s with a generic message, revealing nothing about whether a booking/invoice exists for it.

**Invoice PDF: browser print, not a server-generated binary.** No PDF-generation library (pdfkit, puppeteer, jsPDF, pdf-lib) can be installed in this project's sandbox — confirmed by attempting a real `npm install pdfkit`, which failed with the exact same pre-existing `ENOTEMPTY` dependency-installation error documented elsewhere in this project (not a dry-run check; a genuine install attempt). Rather than silently drop the "generate invoice PDF" requirement or claim a capability that doesn't exist, `app/invoice/[token]/page.tsx` is a public, print-optimized page (`@media print` CSS hides the toolbar/back-link, leaving just the invoice) with a "Print / Save as PDF" button that calls `window.print()` — the browser's own native print-to-PDF is the actual PDF mechanism here. If a true server-generated PDF binary is ever required, it would need a developer to add a PDF library once the sandbox constraint is resolved (or build it in a different environment) — this is flagged explicitly as a real, current limitation rather than something silently worked around.

**Send invoice to guest (`POST /bookings/:id/invoice/send`).** Follows the exact same pattern as the confirmation/reminder/thank-you emails (section 11): requires the guest to have an email on file (400 if not, with a message directing staff to use the print/download path instead), calls `sendInvoiceEmail()` (a new function in `lib/guestMessaging.js`, following the same `bookingConfirmationContent()`-style structure as the other three senders), embeds both the invoice page link and a WhatsApp tap-to-message fallback, and logs a `Notification` row (`type: "invoice_email"`) regardless of whether the send succeeded — same audit-log pattern as section 11f.

**UI: a shared `PaymentInvoicePanel` component (`components/PaymentInvoicePanel.tsx`).** Rather than duplicate the payment-recording/history/invoice UI in both `app/admin/page.tsx` and `app/admin/calendar/page.tsx`, one client component is used in both places (the same precedent as the already-existing shared `components/ApartmentChatbot.tsx`), each supplying its own `booking` and an `onUpdated` callback to sync that page's own state. It is additive alongside each page's pre-existing quick "set total paid" correction input, not a replacement for it.

## 18. Analytics Dashboard — New

`GET /admin/analytics` (`server/src/controllers/adminController.js`'s `analytics()`) powers `app/admin/analytics/page.tsx`, a dedicated Owner-only reporting view alongside the existing `GET /admin/dashboard` stats panel — a separate endpoint rather than folding these fields into `dashboard()`, since it does meaningfully more computation (occupancy math, a 6-month bucketed trend, a channel `groupBy`) that not every caller of the simpler stats needs.

**Occupancy (`occupiedRooms`/`availableRooms`).** Reuses the exact same `OCCUPYING_STATUSES` (`PENDING`/`CONFIRMED`/`CHECKED_IN`) and half-open range convention (`checkIn < tomorrowStart && checkOut > todayStart`) as the booking calendar's `hasClientSideConflict()`/`assignRows()` (section 16) and `bookingService.js`'s `hasBookingConflict()` — a fourth place this exact logic now lives, following the same documented, deliberate duplication pattern already established across the other three (section 8b). Occupied units are capped per room at that room's `totalUnits`, mirroring the calendar's "Overbooked" safeguard (section 16) — an occupancy overcount from bad data is never allowed to report more rooms occupied than physically exist.

**Today's check-ins/check-outs.** Deliberately broader than "already checked in/out today" — any non-cancelled booking whose `checkIn`/`checkOut` date is today counts, including ones still `PENDING`/`CONFIRMED`, since the point of this card is "who is expected today," a front-desk arrivals/departures list, not a log of completed status changes.

**Revenue trend.** Buckets non-cancelled bookings into their `checkIn` month (the month of the stay, not the month the booking was made — the standard hospitality attribution, and the only one available since this project doesn't separately track a "booking made" vs. "stay" revenue distinction). Always returns exactly 6 buckets, oldest to current month, computed fresh from `Room`/`Booking` data on every request — there's no separate reporting/aggregation table, so this is a live query, acceptable at this property's scale (see `13_Database_Summary.md`'s repeated point about a single small property with a modest booking volume).

**Pending payments.** Sums `totalPrice - amountPaid` across every active (non-cancelled) booking that isn't yet fully paid — the same "remaining balance" definition used everywhere else in this project (section 13), just aggregated across all bookings instead of shown per-booking.

**Booking sources.** A `prisma.booking.groupBy(["channel"])` over every booking ever made (any status, including cancelled — this is a channel-attribution metric, not a revenue one, so a cancelled booking's source is still meaningful data). `channel` is a plain string (not an enum, `13_Database_Summary.md` section 5), so this automatically picks up any channel value in use rather than needing a hardcoded list kept in sync.

**Charts: hand-built SVG, not a charting library.** No charting package (recharts, Chart.js, etc.) can be reliably added to this project's dependencies — the same sandbox constraint documented for PDF generation in section 17: a real `npm install` attempt fails with the pre-existing `ENOTEMPTY` error. (A `chart.js` folder exists in `node_modules` from an earlier partial install attempt, but it's absent from both `package.json` and `package-lock.json`, so it's dead weight, not a usable dependency — relying on it would break on any clean `npm install`.) `app/admin/analytics/page.tsx` instead defines two small SVG-rendering components directly: a gridlined, labeled bar chart for the revenue trend (`stroke`/`rect` elements scaled against the data's own max value) and a ring/donut chart for booking sources (concentric `<circle>` elements using the standard `stroke-dasharray`/`stroke-dashoffset` segment technique), styled with the site's existing CSS custom properties rather than a new palette. This is a deliberate, documented substitution for the same reason the invoice PDF is a print page rather than a generated binary — not a silently degraded version of "professional charts," but a real charting implementation built without an external dependency.

**Refresh behavior.** Refetches on window `focus` (switching back to the browser tab) plus a manual Refresh button — lighter than the booking calendar's continuous 15-second poll (section 16), since analytics figures are inherently a look-back/summary view that doesn't need second-by-second freshness the way live booking status does.

## 19. Public Website Booking — Connected to the Database

The homepage "Book Now" form (`app/page.tsx`, section 3) now runs the same real pipeline the AI chat booking assistant does — validate dates, check availability, calculate price, create a `Booking` row, send a confirmation — instead of only emailing the team and hoping a human follows up. Before this, it was the one guest-facing booking surface that didn't touch the database at all; now every path that lets a guest book (AI chat, homepage form, the authenticated `/booking` page, and staff logging a walk-in via `/admin`) writes to the exact same `Booking` table, which is what makes "the website and admin dashboard use the same database" true in practice, not just architecturally possible.

**`createDirectBooking()` (`lib/bookingAssistant.ts`) — the shared logic.** Rather than duplicate `finalizeBooking()`'s availability-check/guest-linking/confirmation-sending logic a second time, this new exported function reuses the same private helpers already in that file (`checkRoomAvailability`, `findOrCreateGuest`, `logNotifications`, `notifyTeam`, `nightsBetween`, `EMAIL_REGEX`, and `sendBookingConfirmation` from `lib/guestMessaging.js`) — there's no cross-runtime boundary between this and the AI chat flow (both run in the Next.js runtime against the same `lib/prisma.ts` client), so duplicating would only add risk, unlike the documented, deliberate duplication between the Next.js and Express sides elsewhere (section 8b). The five steps:

1. **Validate dates and fields** — check-in can't be in the past, check-out must be after check-in, dates must parse, guest count 1–20, name/phone/email format-checked — all before any database read, so a bad submission never even reaches an availability check.
2. **Check availability** — the exact same `OCCUPYING_STATUSES`/overlap-counting logic against `Room.totalUnits` used everywhere else (sections 8b, 16, 18) — a room the public form can book is provably the same room the calendar and admin dashboard agree is free. A non-existent or currently-unavailable room 404s; a real scheduling conflict 409s with a message naming the room and dates.
3. **Calculate price** — nights × the room's `pricePerNight`, identical to every other booking path. If the submitted guest count exceeds the room's `maxGuests`, the booking still proceeds (not a hard block) with a `capacityNote` in the response, mirroring the AI chat flow's non-blocking capacity handling.
4. **Create the booking** — `userId: null`, guest fields (name/phone/whatsapp/email) recorded as a snapshot on the `Booking` row, linked to a deduplicated `Guest` record via the same `findOrCreateGuest()` matching logic (section 12), and tagged `channel: "website"` — a value `CHANNEL_LABELS` in `app/admin/page.tsx` already had a label for, now finally written by something. Status starts `PENDING`, exactly like every other channel; staff still manually verify payment and move it to `CONFIRMED`.
5. **Send confirmation** — the guest's confirmation email and WhatsApp link (`sendBookingConfirmation`, shared with the legacy Express path), plus a server-side Formspree notification to the team (`notifyTeam` — the same call the AI chat path already made) so the team is still alerted by email the same way they always were, just alongside a real database row now instead of in place of one.

**`POST /api/bookings` (`app/api/bookings/route.ts`) — the public endpoint.** A thin, unauthenticated Next.js API route wrapping `createDirectBooking()` — parses the JSON body, maps missing/invalid input to a 400, and otherwise passes through whatever status `createDirectBooking()` returned (400/404/409/503/500) with its message. On success (201): `{ bookingId, whatsappUrl, roomTitle, nights, totalPrice, capacityNote }`.

**Frontend wiring (`app/page.tsx`).** The page now fetches real `Room` rows (`GET /rooms?available=true`) on mount and resolves the booking form's marketing-copy room title to a real `Room.id` at submit time (`resolveDbRoom()`, section 3, step 4) before calling `POST /api/bookings`. If that resolution fails for any reason (rooms haven't loaded yet, the fetch failed), the form falls back to exactly its original Formspree-plus-WhatsApp-only behavior rather than showing a dead end — the guest's request is still captured one way or another, just not always as a real `Booking` row. Step 6 (show a success message) reflects whichever path actually ran: a real booking reference and price for the database-backed path, or the original generic "request sent" message for the fallback path.

## 20. Multi-Language AI Receptionist — New

The deterministic reply engine (section 2) and the conversational booking assistant (section 5) both now support English, Nepali, and Tibetan — see `16_Multilanguage_Support.md` for the full technical write-up and `10_AI_Guidelines.md` sections 2/15/16 for the guest-facing summary. In short:

- **Detection** (`lib/language.ts`): script-based only (Devanagari → Nepali, Tibetan script → Tibetan, else English) — no ML, no guessing.
- **`lib/receptionistReplies.ts`** replaces the English-only reply logic that used to live inline in `route.ts`: the SAME priority-ordered decision tree runs regardless of language, with per-language keyword lists and reply text swapped in, so the logic itself can't drift out of sync between languages the way three separately-maintained copies could.
- **`lib/bookingAssistant.ts`** detects language once, from the message that starts a booking, and stores it on `BookingState.lang` for the rest of that flow.
- Room names, NPR amounts, and dates are identical across all three languages — only the surrounding sentence is translated — so no factual drift is possible regardless of translation quality.
- Tibetan is explicitly flagged as needing native-speaker review; Romanized Nepali (very common in real guest chat) is only partially covered by a best-effort keyword list, not fully solved.

## 21. Conversation Memory During Booking — New

**The problem this solves:** before this change, once `bookingState` was present, literally every guest message was fed into whichever step's parser was currently active (section 5a). A guest who asked an unrelated question mid-flow — "wait, what time is checkout?" while being asked for their phone number — would have that question misread as an invalid phone number ("That doesn't look like a valid phone number — could you share it again?"), silently losing their actual question and feeling like the assistant wasn't listening.

**The fix (`app/api/chat/route.ts`):** before routing a message to `handleBookingTurn()`, the route checks whether the booking is currently on one of the `phone`/`whatsapp`/`email`/`specialRequests` steps AND the message matches `isSourceOfTruthQuestion()` AND it does **not** already look like a valid answer for that step (a real phone number, the word "same", or a real email address — checked with the same lightweight regexes/word-list used elsewhere in this project, not shared as a single source since they're simple one-line patterns already duplicated a couple of places, e.g. `ApartmentChatbot.tsx`). If all of that holds, the route answers the question via `localReceptionistReply()`, re-asks the exact same step's prompt (`getCurrentBookingPrompt()`, a read-only wrapper around `bookingAssistant.ts`'s internal `questionFor()`), and returns `bookingState` completely unchanged — nothing about the in-progress booking is lost. The response is tagged `source: "booking_assistant_interrupted"`.

**Why NOT every step:** `roomType`/`checkIn`/`checkOut`/`guests` were deliberately left out — those need permissive, free-form parsing ("double", "next Friday", "2") where a false-positive interception is more likely to annoy a guest than a missed one would be. `fullName` was also left out: a real name is short free text with no reliable validator, and a name can innocently contain an ordinary word that happens to be a keyword (a guest literally named or nicknamed "Guest" would collide with the room-details keyword list) — this was caught during testing. `confirm` was also left out: its own yes/no parser needs to see the word "cancel" to let a guest decline, and "cancel"/"refund" are also policy/rules keywords, so intercepting there first would break declining a booking at the final step — also caught during testing.

**A second collision caught during testing:** a real Gmail address contains the substring "gmail", which is itself a contact-question keyword ("what's your Gmail?"). Without the "does this already look like a valid answer" check described above, every guest with a `@gmail.com` address — extremely common in this region — would have their email answer misread as a question. This is exactly why the check validates against the step's real answer format first, before ever checking whether the message looks like a question.

## 22. Guest Name Recognition — New

Same client-carried, stateless pattern as `conversationId`/`bookingState` (section 5a): the chat route accepts an optional `guestName` in the request body and always returns the resolved value in the response, and the client (`components/ApartmentChatbot.tsx`, via `guestNameRef`) stores and re-sends it on every subsequent turn.

**How a name is first recognized (`extractGuestName()` in `lib/receptionistReplies.ts`):** a small set of explicit self-introduction patterns per language ("my name is X", "I'm X", "this is X" in English; equivalent patterns in Nepali and Tibetan). This is deliberately conservative, not a general-purpose name-entity model: for English, the captured text after "I'm"/"this is" must start with a capital letter and isn't allowed to be a common non-name word (a hardcoded blacklist — "fine", "interested", "sure", etc.) — both checks exist specifically because "I'm fine, thanks" and "I'm interested in the family room" are exactly the kind of sentence that would otherwise be misread as an introduction. A false-positive name is worse than no name at all (it puts a wrong word in the guest's mouth for the rest of the conversation), so recognition is tuned to under-fire rather than over-fire.

**What happens once a name is recognized:** the guest gets a short, one-time warm acknowledgment ("Nice to meet you, Pema!") prepended to whatever the normal reply would have been, for every reply path except the LLM path (which instead receives a "Known guest name: X — they just introduced themselves, acknowledge warmly" line in its system prompt, letting the model phrase its own acknowledgment naturally rather than have two acknowledgments stitched together). On later turns, the name is NOT re-acknowledged — it's used naturally and occasionally, e.g. a greeting becomes "Hello, Pema! Welcome back..." instead of the generic greeting.

**Scope boundary:** this is same-session recognition only. There's no login or persistent identity for anonymous chat visitors, so a guest who introduced themselves in a previous, separate visit is not recognized automatically — they'd need to introduce themselves again (or the booking flow's own `fullName` step, unaffected by this feature, will ask for it anyway once a booking starts). A phone-number-first returning-guest lookup against the existing `Guest` table (section 12) would be a reasonable future enhancement but is not implemented here.

# Jikmis Apartment — Database Summary

## 1. Database Availability Note

This project defines a Prisma/PostgreSQL schema (`prisma/schema.prisma`). **Updated:** the database is no longer legacy-only — the live AI receptionist's booking assistant (`lib/bookingAssistant.ts`, called from `app/api/chat/route.ts`) now reads and writes to this same database directly to check real availability and create real booking records. A connection to the configured database (`DATABASE_URL`, pointing to `postgresql://...@localhost:5432/...`) has never been reachable from the environment this project has been built in, so:

- **The schema structure below is fully confirmed** (read directly from `prisma/schema.prisma`).
- **No live/populated data has ever been accessible or inspected.** Three migration files now exist under `prisma/migrations/`: `20260713000000_init/migration.sql` (the project's first-ever migration, covering the complete schema as it stood at that point, including the Guest/Payment/Invoice/Notification/AiConversation/AiMessage tables in sections 11–15), `20260713010000_add_reception_role_and_user_isactive/migration.sql` (adds the `RECEPTION` role and `User.isActive`, section 3, for role management — see `15_Admin_Guide.md`), and, **new**, `20260714000000_add_payment_type_and_invoice_token/migration.sql` (adds `Payment.type` and `Invoice.accessToken`, sections 12–13, for payment management — see `15_Admin_Guide.md`). All three have been validated to apply cleanly, in sequence, against a real Postgres-compatible engine (schema creation, all foreign keys, all cascade/set-null behaviors, all unique constraints, and the new enum value/column defaults were exercised and confirmed correct with real inserts/deletes) but **none has ever been run against the project's actual production database**, since that database has never been reachable from this environment. Before anything in this document works end-to-end, the project owner/developer needs to run `npx prisma migrate deploy` (or `npx prisma migrate dev`) against a reachable Postgres instance, then `npm run db:seed` to load the corrected room data (see section 4a). **If your database already has the `User`/`Room`/`Booking` tables from an earlier `prisma db push` or manual setup**, read the comment block at the top of the init migration file first — it explains how to baseline instead of re-running the whole thing.
- The database is used by: the legacy `/booking`, `/rooms`, `/admin`, `/login`, `/register`, `/dashboard` pages (via the Express API in `/server`), and now also the live AI receptionist's booking assistant (via `lib/prisma.ts`, a separate Prisma Client instance pointed at the same database from the Next.js process).

## 2. Enums

| Enum | Values |
|---|---|
| `Role` | `USER`, `ADMIN`, `RECEPTION` (**updated** — `RECEPTION` is new, added for role management; see section 3 and `15_Admin_Guide.md`. `USER` = guest self-service account; `ADMIN` = Owner/Admin, full access; `RECEPTION` = Reception Staff, front-desk operations only) |
| `RoomType` | `STUDIO`, `SINGLE`, `DOUBLE`, `FAMILY` |
| `BookingStatus` | `PENDING`, `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED` (**updated** — replaces the earlier simple `APPROVED`/`REJECTED` approval flow with a hospitality-style stay lifecycle) |

## 3. Table: `User`

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key, `cuid()` default |
| `name` | String | Required |
| `email` | String | Required, unique |
| `phone` | String? | Optional |
| `passwordHash` | String | bcrypt hash (12 rounds), never stores plaintext password |
| `role` | Role | Default `USER` — `USER`/`ADMIN`/`RECEPTION`, see section 2 |
| `isActive` | Boolean | **New.** Default `true`. Staff deactivation switch (the "Manage staff" capability) — set `false` to revoke a staff account's access without deleting it or its historical relations (`bookings`, `paymentsRecorded`). `requireAuth` re-checks this on every request, so deactivation takes effect immediately, not just at the account's next login. See `15_Admin_Guide.md`, section 5g, and `14_API_Documentation.md`'s `PATCH /admin/staff/:id`. |
| `bookings` | Booking[] | Relation — one user can have many bookings |
| `paymentsRecorded` | Payment[] | Relation — payments this staff member personally recorded via `PATCH /bookings/:id/payment` (section 12) |
| `createdAt` | DateTime | Default `now()` |
| `updatedAt` | DateTime | Auto-updated |

## 4. Table: `Room`

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key, `cuid()` default (seed data uses readable slugs like `single-studio-room` instead) |
| `title` | String | Required |
| `type` | RoomType | One of STUDIO/SINGLE/DOUBLE/FAMILY |
| `pricePerNight` | Int | Required |
| `pricePerMonth` | Int | Required |
| `description` | String | Required |
| `facilities` | String[] | List of facility strings |
| `rules` | String[] | List of rule strings |
| `images` | String[] | List of image URLs |
| `isAvailable` | Boolean | Default `true` |
| `maxGuests` | Int | Default `2` |
| `totalUnits` | Int | **New.** Default `1`. Number of physical units of this room type (Jikmis Apartment has 2 Single Studio units and 2 Double Studio units sharing one `Room` row each, and 1 Family Room unit). Availability checks allow up to `totalUnits` overlapping bookings before rejecting a new one. |
| `bookings` | Booking[] | Relation — one room can have many bookings |
| `createdAt` | DateTime | Default `now()` |
| `updatedAt` | DateTime | Auto-updated |

### 4a. Seed Data Correction

The original `prisma/seed.js` seeded fictional placeholder rooms left over from the project's original portfolio template ("Boudha View Studio" at NPR 3,200/night, "Single Room Retreat," "Double Comfort Apartment," "Family Stay Suite" — none matching the real property). This has been corrected to seed the 3 real room types with the real pricing and unit counts from `02_Room_Types.md`/`03_Pricing.md`: Single Studio Room (NPR 1,500/night, 2 units), Double Studio Room (NPR 2,500/night, 2 units), Family Room (NPR 4,000/night, 1 unit). Run `npm run db:seed` after migrating to load this corrected data.

## 5. Table: `Booking`

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key, `cuid()` default |
| `userId` | String? | **Changed from required to optional.** Foreign key → User, only set for bookings made through the legacy authenticated flow. |
| `guestId` | String? | **New.** Foreign key → `Guest` (section 11). Set by the booking-creation code whenever there's no `userId` and a phone or email was provided — see section 11 for the matching logic. `onDelete: SetNull`, so deleting a `Guest` record never deletes its bookings, it just unlinks them (the `guest*` snapshot fields below are untouched either way). |
| `roomId` | String | Foreign key → Room |
| `guestName` | String? | **New.** Guest's full name, for bookings without a user account (e.g. AI receptionist bookings) |
| `guestPhone` | String? | **New.** |
| `guestWhatsapp` | String? | **New.** |
| `guestEmail` | String? | **New.** |
| `specialRequests` | String? | **New.** Free-text special requests collected by the AI receptionist |
| `channel` | String | Default `"legacy_form"`. Where the booking originated: `"ai_chat"` (AI receptionist), `"legacy_form"` (authenticated `POST /bookings`), `"admin_manual"` (staff logging a walk-in/phone booking via `POST /bookings/manual`, see `15_Admin_Guide.md`), or `"website"` (**new, now actually in use** — the public homepage "Book Now" form, `POST /api/bookings`, see `12_System_Logic.md` section 19; this value was anticipated in `CHANNEL_LABELS` well before anything wrote it). Plain string (not an enum) so new channels don't require a migration. |
| `checkIn` | DateTime | Required |
| `checkOut` | DateTime | Required |
| `totalPrice` | Int | Computed at booking time as `nights * pricePerNight` |
| `status` | BookingStatus | Default `PENDING` |
| `guestCount` | Int | Default `1` |
| `note` | String? | Optional (legacy field, distinct from `specialRequests`) |
| `confirmationSentAt` | DateTime? | **New.** Timestamp of when the booking-confirmation email/WhatsApp link were sent (`lib/guestMessaging.js`). Null until sent — used purely for idempotency, never as a boolean flag, so it doubles as an audit trail of when it went out. |
| `reminderSentAt` | DateTime? | **New.** Timestamp of when the pre-arrival reminder was sent by the daily cron job. Null until sent. |
| `thankYouSentAt` | DateTime? | **New.** Timestamp of when the post-checkout thank-you/review-request message was sent by the daily cron job. Null until sent. |
| `user` | User? | **Changed from required to optional.** Relation, cascade delete on user removal |
| `room` | Room | Relation, cascade delete on room removal |
| `createdAt` | DateTime | Default `now()` |
| `updatedAt` | DateTime | Auto-updated |

Indexes: `[roomId, checkIn, checkOut]` (supports availability conflict lookups), `[userId]`, and `[guestId]` (**new**).

Guest bookings created by the AI receptionist deliberately do **not** create a `User` record — there is no login/account system for chat guests, so `userId` is left `null` and the guest's contact details are stored directly on the `Booking` row via the `guest*` fields instead.

## 6. Relationships

- One `User` → many `Booking`s (optional — guest bookings have no `User`)
- One `Room` → many `Booking`s
- One `Guest` → many `Booking`s (**new** — optional, parallel to `User`, for bookings with no account)
- Each `Booking` belongs to exactly one `Room`, and optionally one `User` and/or one `Guest`
- Deleting a `User` or `Room` cascades and deletes their associated `Booking`s
- Deleting a `Guest` does **not** delete its `Booking`s — it just sets their `guestId` to null (see section 11)
- One `Booking` → many `Payment`s, one optional `Invoice`, many `Notification`s, many `AiConversation`s (all **new**, see sections 12–15)

## 7. Booking Status Lifecycle — **Updated**

`PENDING` (default on creation, regardless of channel) → `CONFIRMED` (staff verified the advance payment) → `CHECKED_IN` → `CHECKED_OUT`, or `CANCELLED` at any point. Status changes are set only by an admin via `/admin` (`PATCH /bookings/:id/status`) — the AI receptionist never moves a booking past `PENDING` itself, since every later stage requires a human staff decision (payment verification, physical check-in/out, or cancellation).

For availability/conflict-checking purposes, `PENDING`, `CONFIRMED`, and `CHECKED_IN` bookings are treated as "occupying" the room; `CHECKED_OUT` and `CANCELLED` free it up for new bookings.

## 8. Payment Tracking in the Database — **Updated, partially resolved**

`Booking.amountPaid` (Int, default 0) and `Booking.paymentMethod` (String, optional — one of `cash`/`bank_transfer`/`esewa`/`khalti`) now exist. There is still no `paymentStatus` enum field — "unpaid / partially paid / fully paid" is a derived label (compare `amountPaid` to `totalPrice`), not stored. **"Remaining balance" is always computed as `totalPrice - amountPaid`, never stored separately**, so the two numbers can't drift out of sync. The 50%-advance/50%-remaining workflow in `05_Booking_Policies.md` is still a manual process — staff record `amountPaid` themselves via `/admin` after verifying a payment (e.g., a WhatsApp screenshot); there is no automated payment gateway integration.

## 8a. Communication Automation Tracking — New

The three `*SentAt` fields above back the guest communication automation described in `12_System_Logic.md`, section 11. All three are nullable `DateTime` fields rather than booleans, specifically so a null check can serve as the idempotency gate (never send the same automated message twice) while the actual value still records exactly when each message went out, which is useful for support/debugging ("did the guest actually get a reminder?"). None of these fields are set by a migration or seed script — they start `null` for every booking and only become non-null once the corresponding message actually sends successfully.

## 9. Discrepancy Note: `RoomType` Enum vs. Live Room Types

**Partially resolved.** The schema's `RoomType` enum still has four values (`STUDIO`, `SINGLE`, `DOUBLE`, `FAMILY`); the corrected seed data (section 4a) now uses `SINGLE` → Single Studio Room, `DOUBLE` → Double Studio Room, `FAMILY` → Family Room. `STUDIO` remains an unused enum value (left in place rather than removed, to avoid a breaking schema change) — it isn't used by any seeded room and shouldn't be selected for new Jikmis rooms.

## 10. Database Structure Review — New Tables (Guest, Payment, Invoice, Notification, AI Conversations)

A full review against a 10-item checklist (rooms, room types, room availability, guests, bookings, payments, invoices, users/staff, AI conversations, notifications) found: rooms, room types (via the `RoomType` enum), room availability, bookings, and users/staff were already well covered. Guests, itemized payments, invoices, AI conversation history, and a notification log were **not** — this pass adds five new tables to close those gaps. All five are purely additive: nothing existing was renamed, removed, or had its meaning changed, and every new foreign key back to `Booking`/`User` is nullable or cascades in a way that can never destroy pre-existing data (see the migration file's own header comment for the exact guarantees).

### 11. Table: `Guest` — New

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key, `cuid()` default |
| `name` | String | Required |
| `phone` | String? | Indexed — primary match key when linking a booking to a guest |
| `whatsapp` | String? | |
| `email` | String? | Indexed — fallback match key if no phone was given |
| `notes` | String? | Free-text, for staff use (not guest-facing) |
| `bookings` | Booking[] | Relation — one guest can have many bookings across multiple stays |
| `aiConversations` | AiConversation[] | Relation (see section 14) |
| `createdAt` / `updatedAt` | DateTime | |

**Why this exists alongside `Booking.guestName`/`guestPhone`/`guestWhatsapp`/`guestEmail`:** those fields are a point-in-time **snapshot** of what a guest provided for one specific stay, and are never rewritten after the fact — that behavior is unchanged. `Guest` is a separate, deduplicated, editable identity that lets the same person's booking history be tracked across multiple stays (repeat-guest recognition, a stable contact record staff can correct without touching old bookings). `Booking.guestId` links the two, but is optional — a booking with no matched `Guest` still works exactly as it always has via the snapshot fields.

**Matching logic:** implemented identically in `lib/bookingAssistant.ts` (AI chat) and `server/src/services/bookingService.js` (legacy authenticated and admin-manual paths, the latter via `POST /bookings/manual`) as a `findOrCreateGuest()` function — kept in sync manually across the two files, the same pattern already used for `OCCUPYING_STATUSES`/`countOverlappingBookings`. It matches an existing `Guest` by phone first, falling back to email if no phone was given; if found, it only **fills in** a missing `whatsapp`/`email` on that record, never overwriting a value that's already there, and never touches the name. If no match is found, a new `Guest` is created. Only runs when there's no linked `User` (`userId` is null) — an authenticated booking's identity is the `User` record itself, so a parallel `Guest` would just be a duplicate. A `Guest` lookup/create failure is logged and swallowed — it never blocks the booking itself.

### 12. Table: `Payment` — Updated (payment management)

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `bookingId` | String | Foreign key → `Booking`, cascade delete |
| `amount` | Int | The payment recorded in this row — always positive for rows written by the newer `POST /bookings/:id/payments` endpoint (see below); can still be negative for older rows written via `PATCH /bookings/:id/payment`'s delta logic (a correction) |
| `method` | String? | `cash` / `bank_transfer` / `esewa` / `khalti` — plain string, not an enum, matching `Booking.channel`'s existing pattern |
| `type` | String | **New.** `advance` / `remaining` / `other` — which stage of the 50/50 payment policy (`05_Booking_Policies.md`) this payment represents. Defaults to `"other"`, so pre-existing rows (and the older `PATCH /bookings/:id/payment` absolute-correction path, which doesn't collect a type) remain valid without a backfill. |
| `note` | String? | |
| `recordedByUserId` | String? | Foreign key → `User`, `SetNull` on delete — which staff member recorded it, if known |
| `recordedAt` | DateTime | Default `now()` |

`Booking.amountPaid` remains the single fast-read running total used by every existing "remaining balance = totalPrice − amountPaid" calculation across the admin UI and API — nothing about that changed. `Payment` is the itemized audit trail on top of it, written from two places:

- `PATCH /bookings/:id/payment` (unchanged) — sets an **absolute** new `amountPaid`, and logs the **delta** (new value minus old) as its own `Payment` row, `type` defaulting to `"other"`. Still used by both admin UIs' quick "set total paid" correction input.
- `POST /bookings/:id/payments` (**new** — payment management's "Record advance payment" / "Record remaining balance" / "Record other payment") — **incremental**: takes an `amount` that's *added* to the existing `amountPaid`, plus an explicit `type`. Rejected with a 400 if the new total would exceed `totalPrice`. This is the endpoint behind `GET /bookings/:id/payments`'s "Payment history" list and the payment method selector.

Both endpoints keep `Booking.amountPaid` and the `Payment` ledger in sync; they coexist rather than one replacing the other, so neither admin UI's existing behavior changed. A logging failure in either path never blocks the actual payment update.

### 13. Table: `Invoice` — Updated (payment management)

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `bookingId` | String | Foreign key → `Booking`, cascade delete, **`@unique`** — one invoice per booking |
| `invoiceNumber` | String | `@unique`, format `JA-<year>-<0001>`, per-year running count — human-readable label |
| `subtotal` | Int | Set to the booking's `totalPrice` at issue time |
| `taxAmount` | Int | Default `0` — no tax/VAT policy is documented anywhere in this project, so this is never guessed at; staff can adjust it manually if a real tax requirement applies |
| `totalAmount` | Int | `subtotal + taxAmount` |
| `accessToken` | String? | **New.** `@unique`. A random (`crypto.randomUUID()`), unguessable lookup key for the public invoice page (`GET /invoices/:token`, `app/invoice/[token]/page.tsx`) and the "send invoice to guest" email link — deliberately **not** `invoiceNumber`, which is sequential and could be iterated to view other guests' invoices. Nullable only so the column could be added without a data backfill migration; every invoice created or touched going forward always has one (see below). |
| `issuedAt` / `createdAt` / `updatedAt` | DateTime | |

Created (or fetched, if it already exists) by a shared `getOrCreateInvoice(booking)` function in `server/src/controllers/bookingController.js`, called from two places:

1. Automatically, the first time a booking's status reaches `CONFIRMED` (unchanged trigger — the point where staff have verified the advance payment, see section 7).
2. On demand, from payment management's `GET /bookings/:id/invoice` (view/download), `POST /bookings/:id/invoice/send` (email to guest), and the shared `PaymentInvoicePanel` UI component — since staff may want to generate or view an invoice before a booking reaches `CONFIRMED`.

Both paths are idempotent — calling `getOrCreateInvoice` again for a booking that already has an invoice returns the same row rather than creating a duplicate (enforced by `bookingId`'s `@unique` constraint too). If an existing invoice predates the `accessToken` column (`accessToken` is `null`), it's backfilled with a freshly generated token in place, rather than left inaccessible.

**Known limitation (unchanged):** invoice numbering is a simple count-per-year, not an atomically-guaranteed sequence — safe in practice for a single small property with manual, staff-driven actions, but two bookings needing an invoice in the exact same instant could theoretically collide; if that happens, the unique constraint on `invoiceNumber` rejects the second write and invoice creation is skipped for it (logged, not thrown) rather than blocking the caller. **PDF generation:** there is no PDF-generation library installable in this project's environment (confirmed by a real `npm install` failure — see `15_Admin_Guide.md`'s payment management section for the full explanation), so "Generate invoice PDF" / "Download invoice" is implemented as a public, print-optimized page (`app/invoice/[token]/page.tsx`) using the browser's native "Print > Save as PDF," not a server-generated binary file.

### 14. Table: `AiConversation` / `AiMessage` — New

`AiConversation`: `id`, `channel` (default `"website"`, plain string for future channels like an eventual WhatsApp-integrated AI chat), `guestId` (optional FK → `Guest`), `bookingId` (optional FK → `Booking`, `SetNull` on delete), `startedAt`, `lastMessageAt`, and a `messages` relation.

`AiMessage`: `id`, `conversationId` (FK → `AiConversation`, cascade delete), `role` (`"user"` or `"assistant"`), `content`, `source` (optional — mirrors `app/api/chat/route.ts`'s response `source` field: `jikmis_source_of_truth`, `local_fallback`, `booking_assistant`, or absent for a successful OpenAI reply), `createdAt`.

**Why this exists:** the live AI chat (`POST /api/chat`) was previously entirely stateless server-side — no transcript was ever persisted, only the in-progress `bookingState` was carried client-side and discarded once a conversation finished. `AiConversation`/`AiMessage` now persist every turn, using the exact same stateless, client-carried-state pattern already established for `bookingState`: the client sends a `conversationId` (initially `null`), the server creates or resumes the matching `AiConversation`, appends the turn, and returns the (possibly new) `conversationId` for the client to echo on the next request — see `components/ApartmentChatbot.tsx`'s `conversationIdRef`. If a booking is created during the conversation, the `AiConversation` is linked to that `Booking` (and its `Guest`, if one was matched) on that turn. Persistence is best-effort — a database failure here is logged and never blocks or alters the guest-facing reply. There is no admin UI to browse conversation transcripts yet — only the database record.

### 15. Table: `Notification` — New

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `bookingId` | String? | Foreign key → `Booking`, cascade delete |
| `type` | String | `booking_confirmation` / `precheckin_reminder` / `postcheckout_thankyou` — plain string, matching the `channel`/`method` pattern used elsewhere |
| `channel` | String | `email` or `whatsapp_link` |
| `recipient` | String? | |
| `status` | String | `sent` / `failed` / `skipped_not_configured` / `skipped_no_recipient` — mirrors the `{sent, reason}` shape `lib/mailer.js` and `lib/guestMessaging.js` already return |
| `errorMessage` | String? | |
| `sentAt` | DateTime | Default `now()` |

Distinct from `Booking.confirmationSentAt`/`reminderSentAt`/`thankYouSentAt`, which only ever record the timestamp of the **most recent successful** send of each type (their sole purpose is the idempotency check that prevents double-sending). `Notification` is an **append-only history**, including failed and skipped attempts, across both the `email` and `whatsapp_link` channel for every send — useful for a "why didn't this guest get their confirmation" support question. Logged from all three places messaging is sent (`lib/bookingAssistant.ts`, `server/src/services/bookingService.js`, and `app/api/cron/send-reminders/route.ts`), each writing directly via its own already-instantiated Prisma client rather than through `lib/guestMessaging.js` itself — that file is shared across the Next.js and Express runtimes (see its own header comment), and each runtime has its own separately-configured Prisma Client instance, so keeping the actual database write in the caller avoids a cross-runtime import problem.

## 16a. Role Management — New

`Role` gained a third value, `RECEPTION`, and `User` gained an `isActive` flag (section 3) to support the Owner/Admin vs. Reception Staff permission model described in `15_Admin_Guide.md` and `14_API_Documentation.md`. This was a deliberately additive, non-breaking change: the existing `ADMIN` enum value was kept as-is rather than renamed to something like `OWNER`, so every pre-existing `role === "ADMIN"` check, seed row, and hardcoded demo login kept working without modification — `ADMIN` is simply documented as meaning "Owner/Admin" in the new role vocabulary. `RECEPTION` and `isActive` are additive via a second migration file (section 1) on top of the original schema; no existing table, column, or enum value was removed or renamed.

## 16. Summary of What Is and Isn't Confirmed

| Item | Status |
|---|---|
| Table/field structure | Confirmed (from `schema.prisma`, including the new `totalUnits`/guest fields/`channel`, the `Guest`/`Payment`/`Invoice`/`Notification`/`AiConversation`/`AiMessage` tables, and the newest `RECEPTION` role/`isActive` staff-management fields) |
| Enum values | Confirmed |
| Relationships and cascade behavior | Confirmed, and additionally verified by actually running both migration files, in sequence, against a real Postgres-compatible engine and exercising every foreign key, cascade, `SetNull`, unique constraint, and the new enum value/column default with real inserts/deletes |
| Indexes | Confirmed |
| Actual row data (real bookings, users, rooms in production) | Not found in current project — database unreachable during analysis, and the schema/migration changes above have not yet been run against a live database |
| Payment status tracking | `amountPaid`/`paymentMethod` fields exist and are editable via the admin dashboard, both as an absolute correction (`PATCH /bookings/:id/payment`) and, **new**, an incremental "record advance/remaining/other payment" action (`POST /bookings/:id/payments`), both backed by an itemized `Payment` ledger with a `type` tag (section 12); a derived "paid/partial/unpaid" label is not stored (computed from `amountPaid` vs. `totalPrice`); there is still no automated payment gateway |
| Invoicing | `Invoice` table (section 13) exists, auto-populates on booking confirmation, and can now also be generated on demand; **new** — an unguessable `accessToken` per invoice powers a public, printable invoice page (`app/invoice/[token]/page.tsx`) and a "send invoice to guest" email; PDF generation uses the browser's native print-to-PDF, not a server-generated file (no PDF library is installable in this project's environment) |
| Guest history/CRM | `Guest` table (section 11) exists and is populated by all three booking-creation paths; no dedicated admin UI to browse it yet — direct database access only |
| AI conversation history | `AiConversation`/`AiMessage` tables (section 14) exist and are populated on every chat turn; no dedicated admin UI to browse transcripts yet — direct database access only |
| Notification audit log | `Notification` table (section 15) exists and is populated by all three messaging-sending code paths |
| Whether this database is actively used in production today | The AI receptionist's booking assistant is now wired to use it (see `12_System_Logic.md`), but this requires the project owner/developer to run the pending migration and seed script against a real, reachable Postgres database first |

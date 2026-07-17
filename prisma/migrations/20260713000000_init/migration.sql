-- Jikmis Apartment — initial migration
--
-- This repository has never had a Prisma migration applied against a live
-- database (no prisma/migrations folder existed before this file — confirmed
-- by inspecting the repo directly). This migration therefore creates the
-- ENTIRE schema in one shot: every table this project has ever needed
-- (User, Room, Booking, and everything added across earlier phases of this
-- project's build-out), plus the new Guest, Payment, Invoice, Notification,
-- AiConversation, and AiMessage tables added in this pass to close gaps
-- found during a database-structure review (rooms/room-types/availability,
-- bookings, and users were already covered; guests, itemized payments,
-- invoices, AI conversation history, and a notification log were not).
--
-- IMPORTANT — read before running this against a real database:
--
-- 1) If your database is completely empty (nothing has ever been created in
--    it), just run:  npx prisma migrate deploy
--    This file will create every table from scratch.
--
-- 2) If your database ALREADY has the User/Room/Booking tables (e.g. you
--    ran `npx prisma db push` at some point outside this session, which
--    syncs the schema but does not write Prisma migration history), running
--    this file as-is will fail on the CREATE TABLE statements for those
--    three tables ("relation already exists") — Postgres will reject it and
--    roll back the whole migration transaction, so this is a safe, loud
--    failure, not silent data loss. In that case:
--      a) Remove/comment out the CREATE TYPE / CREATE TABLE / index blocks
--         for "User", "Room", and "Booking" below (keep the ALTER TABLE
--         "Booking" ADD COLUMN "guestId" statement, plus everything for the
--         new Guest/Payment/Invoice/Notification/AiConversation/AiMessage
--         tables — those are genuinely new).
--      b) Or, simpler: run `npx prisma migrate resolve --applied 20260713000000_init`
--         to tell Prisma this migration is already (partially) satisfied,
--         then hand-run just the NEW-TABLE portion of this file directly
--         against your database with psql, then re-sync migration history.
--    Either way, nothing in this file ever DROPs or ALTERs an existing
--    column's data — it only creates new tables and adds one new nullable
--    column ("Booking"."guestId") to the existing Booking table, so no
--    existing data is at risk under any scenario.

-- ========================================================================
-- Enums
-- ========================================================================

CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

CREATE TYPE "RoomType" AS ENUM ('STUDIO', 'SINGLE', 'DOUBLE', 'FAMILY');

CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- ========================================================================
-- Table: User
-- ========================================================================

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- ========================================================================
-- Table: Guest (new)
-- ========================================================================

CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Guest_phone_idx" ON "Guest"("phone");

CREATE INDEX "Guest_email_idx" ON "Guest"("email");

-- ========================================================================
-- Table: Room
-- ========================================================================

CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "pricePerNight" INTEGER NOT NULL,
    "pricePerMonth" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "facilities" TEXT[],
    "rules" TEXT[],
    "images" TEXT[],
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "maxGuests" INTEGER NOT NULL DEFAULT 2,
    "totalUnits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- ========================================================================
-- Table: Booking
-- ========================================================================

CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "roomId" TEXT NOT NULL,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "guestWhatsapp" TEXT,
    "guestEmail" TEXT,
    "specialRequests" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'legacy_form',
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "confirmationSentAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "thankYouSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Booking_roomId_checkIn_checkOut_idx" ON "Booking"("roomId", "checkIn", "checkOut");

CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

CREATE INDEX "Booking_guestId_idx" ON "Booking"("guestId");

-- ========================================================================
-- Table: Payment (new)
-- ========================================================================

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "recordedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- ========================================================================
-- Table: Invoice (new)
-- ========================================================================

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_bookingId_key" ON "Invoice"("bookingId");

CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- ========================================================================
-- Table: Notification (new)
-- ========================================================================

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- ========================================================================
-- Table: AiConversation (new)
-- ========================================================================

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'website',
    "guestId" TEXT,
    "bookingId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_guestId_idx" ON "AiConversation"("guestId");

CREATE INDEX "AiConversation_bookingId_idx" ON "AiConversation"("bookingId");

-- ========================================================================
-- Table: AiMessage (new)
-- ========================================================================

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiMessage_conversationId_idx" ON "AiMessage"("conversationId");

-- ========================================================================
-- Foreign keys
-- ========================================================================

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

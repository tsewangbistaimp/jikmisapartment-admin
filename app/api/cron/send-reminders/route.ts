import { NextRequest, NextResponse } from "next/server";
import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
// Plain CommonJS module shared with the legacy Express booking path — see
// lib/guestMessaging.js for why it isn't TypeScript.
import { sendPreCheckinReminder, sendPostCheckoutThankYou } from "@/lib/guestMessaging";

/**
 * Daily cron job (see vercel.json) that sends the two async guest messages
 * the AI receptionist and the manual admin booking flow can't send at
 * booking-creation time because they depend on the calendar, not the
 * booking event itself:
 *
 *  - Pre-arrival reminder: sent once, the day before check-in, for any
 *    booking that still occupies a room (PENDING/CONFIRMED/CHECKED_IN) and
 *    hasn't already received one (reminderSentAt is null).
 *  - Post-checkout thank-you + review request: sent once, the day after
 *    checkout, for any booking whose stay actually happened (CHECKED_OUT)
 *    and hasn't already received one (thankYouSentAt is null).
 *
 * Idempotency is enforced purely by the *SentAt null-check, so running this
 * more than once on the same day (or re-triggering it manually) never
 * double-sends. See lib/guestMessaging.js for the WhatsApp-link limitation
 * (there is no WhatsApp Business API in this project — the "message" is a
 * pre-filled wa.me link included in the automated email).
 *
 * Protected by CRON_SECRET so this endpoint can't be triggered by anyone
 * who finds the URL — Vercel Cron sends this automatically as a Bearer
 * token when CRON_SECRET is set in the project's environment variables.
 *
 * SECURITY: this fails CLOSED, not open. An earlier version only checked the
 * Bearer token `if (cronSecret)` was set at all — meaning a deployment that
 * forgot to configure CRON_SECRET (easy to do; nothing else breaks if it's
 * missing) left this endpoint fully public. Anyone who found the URL could
 * repeatedly trigger real guest-facing emails and consume the mail-sending
 * budget. Matches the same fail-fast philosophy already used for JWT_SECRET
 * in server/src/index.js: a required secret that isn't set must block the
 * feature, not silently downgrade it to "no auth."
 */

const OCCUPYING_STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Logs one Notification row per channel for a guest messaging attempt — see
// prisma/schema.prisma's Notification model comment and the identical
// helper in lib/bookingAssistant.ts / server/src/services/bookingService.js.
async function logNotifications(
  bookingId: string,
  type: string,
  messageResult: { emailResult: { sent: boolean; reason?: string }; whatsappUrl: string | null; contact: { email: string | null; whatsapp: string | null } }
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        bookingId,
        type,
        channel: "email",
        recipient: messageResult.contact.email,
        status: messageResult.emailResult.sent ? "sent" : messageResult.emailResult.reason ?? "failed"
      }
    });
    if (messageResult.contact.whatsapp) {
      await prisma.notification.create({
        data: {
          bookingId,
          type,
          channel: "whatsapp_link",
          recipient: messageResult.contact.whatsapp,
          status: messageResult.whatsappUrl ? "sent" : "failed"
        }
      });
    }
  } catch (error) {
    console.error(`[cron/send-reminders] Failed to log "${type}" notification:`, error);
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      "[cron/send-reminders] CRON_SECRET is not set — refusing to run rather than executing unauthenticated. Set CRON_SECRET in the project's environment variables."
    );
    return NextResponse.json({ error: "Server misconfigured: CRON_SECRET is not set." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfDay(new Date());
  const tomorrowStart = addDays(today, 1);
  const tomorrowEnd = addDays(today, 2);
  const yesterdayStart = addDays(today, -1);

  const results = {
    remindersSent: [] as string[],
    remindersFailed: [] as string[],
    thankYousSent: [] as string[],
    thankYousFailed: [] as string[]
  };

  // --- Pre-arrival reminders: check-in falls tomorrow ------------------
  const bookingsNeedingReminder = await prisma.booking.findMany({
    where: {
      status: { in: OCCUPYING_STATUSES },
      reminderSentAt: null,
      checkIn: { gte: tomorrowStart, lt: tomorrowEnd }
    },
    include: { room: true, user: { select: { id: true, name: true, email: true, phone: true } } }
  });

  for (const booking of bookingsNeedingReminder) {
    try {
      const messageResult = await sendPreCheckinReminder(booking);
      await prisma.booking.update({ where: { id: booking.id }, data: { reminderSentAt: new Date() } });
      await logNotifications(booking.id, "precheckin_reminder", messageResult);
      results.remindersSent.push(booking.id);
    } catch (error) {
      console.error(`[cron/send-reminders] Reminder failed for booking ${booking.id}:`, error);
      results.remindersFailed.push(booking.id);
    }
  }

  // --- Post-checkout thank-you: checkout was yesterday ------------------
  const bookingsNeedingThankYou = await prisma.booking.findMany({
    where: {
      status: "CHECKED_OUT",
      thankYouSentAt: null,
      checkOut: { gte: yesterdayStart, lt: today }
    },
    include: { room: true, user: { select: { id: true, name: true, email: true, phone: true } } }
  });

  for (const booking of bookingsNeedingThankYou) {
    try {
      const messageResult = await sendPostCheckoutThankYou(booking);
      await prisma.booking.update({ where: { id: booking.id }, data: { thankYouSentAt: new Date() } });
      await logNotifications(booking.id, "postcheckout_thankyou", messageResult);
      results.thankYousSent.push(booking.id);
    } catch (error) {
      console.error(`[cron/send-reminders] Thank-you failed for booking ${booking.id}:`, error);
      results.thankYousFailed.push(booking.id);
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

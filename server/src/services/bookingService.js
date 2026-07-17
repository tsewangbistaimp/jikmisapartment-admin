const prisma = require("../utils/prisma");
const { calculatePrice } = require("../utils/pricing");
// Shared with the AI booking assistant (lib/bookingAssistant.ts) — same
// implementation, required from both runtimes. See lib/guestMessaging.js.
const { sendBookingConfirmation } = require("../../../lib/guestMessaging");

// Statuses that still "occupy" a room for conflict-checking purposes.
// CHECKED_OUT and CANCELLED bookings free up the room for new bookings.
const OCCUPYING_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"];

// Counts overlapping occupying bookings against the room's totalUnits,
// matching the logic in lib/bookingAssistant.ts (the AI receptionist's
// booking flow) so both paths agree on what "available" means for
// properties with multiple physical units of the same room type.
async function countOverlappingBookings(roomId, checkIn, checkOut, excludeBookingId) {
  return prisma.booking.count({
    where: {
      roomId,
      id: excludeBookingId ? { not: excludeBookingId } : undefined,
      status: { in: OCCUPYING_STATUSES },
      checkIn: { lt: new Date(checkOut) },
      checkOut: { gt: new Date(checkIn) }
    }
  });
}

async function hasBookingConflict(roomId, checkIn, checkOut, excludeBookingId) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  const totalUnits = room?.totalUnits ?? 1;
  const overlapping = await countOverlappingBookings(roomId, checkIn, checkOut, excludeBookingId);
  return overlapping >= totalUnits;
}

// Finds an existing Guest record to link this booking to (matched by phone,
// falling back to email), or creates a new one. Only called when there's no
// linked User account (userId is null) — an authenticated booking's contact
// identity is the User record itself, so creating a parallel Guest for it
// would just duplicate that identity. Mirrors
// lib/bookingAssistant.ts's findOrCreateGuest — kept in sync manually, same
// pattern as OCCUPYING_STATUSES/countOverlappingBookings above.
async function findOrCreateGuest({ name, phone, whatsapp, email }) {
  if (!phone && !email) return null;
  try {
    const existing = await prisma.guest.findFirst({ where: phone ? { phone } : { email } });
    if (existing) {
      const updates = {};
      if (!existing.whatsapp && whatsapp) updates.whatsapp = whatsapp;
      if (!existing.email && email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await prisma.guest.update({ where: { id: existing.id }, data: updates });
      }
      return existing.id;
    }
    const created = await prisma.guest.create({ data: { name: name || "Guest", phone, whatsapp, email } });
    return created.id;
  } catch (error) {
    console.error("[bookingService] Guest lookup/create failed (booking still proceeds without a linked Guest):", error);
    return null;
  }
}

// Logs one Notification row per channel for a guest messaging attempt — see
// prisma/schema.prisma's Notification model comment and the identical
// helper in lib/bookingAssistant.ts.
async function logNotifications(bookingId, type, messageResult) {
  try {
    await prisma.notification.create({
      data: {
        bookingId,
        type,
        channel: "email",
        recipient: messageResult.contact.email,
        status: messageResult.emailResult.sent ? "sent" : messageResult.emailResult.reason || "failed"
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
    console.error(`[bookingService] Failed to log "${type}" notification:`, error);
  }
}

// guestName/guestPhone/guestWhatsapp/guestEmail/specialRequests are optional
// and only meaningful when userId is null (no linked account) — e.g. an
// admin logging a walk-in/phone booking (channel "admin_manual") or, in
// principle, any future guest-facing flow through this same service. When
// userId IS set, guest* fields are simply left unset and contact details
// come from the linked User record instead, exactly as before.
async function createBooking({
  userId,
  roomId,
  checkIn,
  checkOut,
  guestCount,
  note,
  channel,
  guestName,
  guestPhone,
  guestWhatsapp,
  guestEmail,
  specialRequests
}) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || !room.isAvailable) {
    const error = new Error("Room is not available.");
    error.status = 404;
    throw error;
  }

  if (await hasBookingConflict(roomId, checkIn, checkOut)) {
    const error = new Error("This room is already booked for the selected dates.");
    error.status = 409;
    throw error;
  }

  const guestId = userId ? null : await findOrCreateGuest({ name: guestName, phone: guestPhone, whatsapp: guestWhatsapp, email: guestEmail });

  const booking = await prisma.booking.create({
    data: {
      userId,
      guestId,
      roomId,
      channel: channel || "legacy_form",
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      guestCount,
      note,
      guestName,
      guestPhone,
      guestWhatsapp,
      guestEmail,
      specialRequests,
      totalPrice: calculatePrice(room, checkIn, checkOut)
    },
    include: { room: true, user: { select: { id: true, name: true, email: true, phone: true } } }
  });

  // Same confirmation email + WhatsApp link generation as the AI booking
  // path. Never let a messaging failure fail the booking request itself —
  // the booking is already committed at this point. The WhatsApp link is
  // attached to the returned object (not persisted) so callers — like the
  // admin-manual booking endpoint — can hand it to whichever staff member
  // is logging the booking, the same way the AI chat path hands it to the
  // guest's own browser.
  let whatsappUrl = null;
  try {
    const messageResult = await sendBookingConfirmation(booking);
    whatsappUrl = messageResult.whatsappUrl ?? null;
    await prisma.booking.update({ where: { id: booking.id }, data: { confirmationSentAt: new Date() } });
    await logNotifications(booking.id, "booking_confirmation", messageResult);
  } catch (messagingError) {
    console.error("[bookingService] Confirmation messaging failed (booking still created):", messagingError);
  }

  booking.whatsappUrl = whatsappUrl;
  return booking;
}

module.exports = { countOverlappingBookings, createBooking, hasBookingConflict };

const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { createBooking } = require("../services/bookingService");
const { sendInvoiceEmail: sendInvoiceEmailMessage } = require("../../../lib/guestMessaging");

const bookingSchema = z.object({
  body: z.object({
    roomId: z.string().min(1),
    checkIn: z.coerce.date(),
    checkOut: z.coerce.date(),
    guestCount: z.coerce.number().int().positive().default(1),
    note: z.string().optional()
  }).refine((value) => value.checkOut > value.checkIn, {
    message: "Check-out must be after check-in.",
    path: ["checkOut"]
  })
});

// For staff logging a walk-in or phone booking on behalf of a guest who has
// no account — same guest* fields the AI receptionist already uses, so a
// manually-logged booking looks and behaves identically to an AI-chat one
// everywhere else in the system (admin list, payment tracking, guest
// communication automation). guestName is required since, unlike the
// authenticated flow, there's no linked User to fall back to for a display
// name.
const manualBookingSchema = z.object({
  body: z.object({
    roomId: z.string().min(1),
    checkIn: z.coerce.date(),
    checkOut: z.coerce.date(),
    guestCount: z.coerce.number().int().positive().default(1),
    note: z.string().optional(),
    guestName: z.string().min(2),
    guestPhone: z.string().min(7),
    guestWhatsapp: z.string().optional(),
    guestEmail: z.string().email().optional(),
    specialRequests: z.string().optional()
  }).refine((value) => value.checkOut > value.checkIn, {
    message: "Check-out must be after check-in.",
    path: ["checkOut"]
  })
});

// Hospitality-style lifecycle: PENDING -> CONFIRMED (staff verified the
// advance payment) -> CHECKED_IN -> CHECKED_OUT, or CANCELLED at any point.
const statusSchema = z.object({
  body: z.object({
    status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"])
  })
});

// "Remaining balance" is always derived as totalPrice - amountPaid, never
// stored, so it can't drift out of sync with the two numbers that are.
// Kept exactly as-is (an absolute-value correction) for backward
// compatibility with the two existing admin UIs — see recordPaymentSchema
// below for the newer, incremental "record a payment" endpoint that payment
// management (advance/remaining) actually uses.
const paymentSchema = z.object({
  body: z.object({
    amountPaid: z.coerce.number().int().min(0),
    paymentMethod: z.enum(["cash", "bank_transfer", "esewa", "khalti"]).optional()
  })
});

// POST /bookings/:id/payments — "record a payment that just came in" rather
// than "set the new total," which is how staff actually think about this
// (see paymentSchema's comment). advance/remaining mirror the 50/50 policy
// in 05_Booking_Policies.md; "other" covers anything else (a discount
// adjustment, a partial extra payment, etc.).
const recordPaymentSchema = z.object({
  body: z.object({
    amount: z.coerce.number().int().positive(),
    method: z.enum(["cash", "bank_transfer", "esewa", "khalti"]).optional(),
    type: z.enum(["advance", "remaining", "other"]).default("other"),
    note: z.string().optional()
  })
});

const bookingInclude = {
  room: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
  // Included so staff-facing UIs (app/admin/page.tsx, app/admin/calendar)
  // can read invoice.accessToken directly off a booking's own GET /bookings
  // response, without a second round-trip, to build the public invoice link
  // — see getOrCreateInvoice() below.
  invoice: true
};

async function listBookings(req, res) {
  // Owner/Admin and Reception Staff both see every booking ("view
  // availability" / manage the front desk); any other authenticated role
  // (a logged-in guest, USER) only sees their own.
  const where = ["ADMIN", "RECEPTION"].includes(req.user.role) ? {} : { userId: req.user.sub };
  const bookings = await prisma.booking.findMany({
    where,
    include: bookingInclude,
    orderBy: { createdAt: "desc" }
  });
  res.json({ bookings });
}

async function bookRoom(req, res) {
  const booking = await createBooking({ userId: req.user.sub, channel: "legacy_form", ...req.validated.body });
  res.status(201).json({ booking, whatsappUrl: booking.whatsappUrl ?? null });
}

// Admin-only: log a booking for a guest without an account (walk-in or
// phone reservation). Mirrors the AI receptionist's booking creation
// (userId: null, guest* fields, channel "admin_manual") so it shares every
// downstream behavior — availability conflict checks, payment tracking, and
// guest communication automation (12_System_Logic.md, section 11) — with
// the AI-chat and legacy-authenticated paths, all against the same table.
async function createManualBooking(req, res) {
  const booking = await createBooking({
    userId: null,
    channel: "admin_manual",
    ...req.validated.body
  });
  res.status(201).json({ booking, whatsappUrl: booking.whatsappUrl ?? null });
}

// Gets a booking's Invoice, creating it if it doesn't exist yet — used both
// automatically (the first time a booking reaches CONFIRMED, the point
// where staff have verified the advance payment — unchanged behavior) and
// on-demand (payment management's "generate/view/send invoice" actions,
// which should work at any point, not only after CONFIRMED). Invoice
// numbering is a simple per-year running count (JA-<year>-<0001>); this
// isn't atomic under true concurrent writes, but two bookings needing an
// invoice in the exact same instant is not a realistic scenario for a
// single small property with manual, staff-driven actions. accessToken is
// the unguessable lookup key for the public invoice page/email link (see
// prisma/schema.prisma's Invoice.accessToken comment) — generated here too,
// and also backfilled onto any older invoice that predates this field.
async function getOrCreateInvoice(booking) {
  const existing = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
  if (existing) {
    if (existing.accessToken) return existing;
    return prisma.invoice.update({ where: { id: existing.id }, data: { accessToken: crypto.randomUUID() } });
  }
  const year = new Date().getFullYear();
  const countThisYear = await prisma.invoice.count({ where: { invoiceNumber: { startsWith: `JA-${year}-` } } });
  const invoiceNumber = `JA-${year}-${String(countThisYear + 1).padStart(4, "0")}`;
  return prisma.invoice.create({
    data: {
      bookingId: booking.id,
      invoiceNumber,
      subtotal: booking.totalPrice,
      taxAmount: 0,
      totalAmount: booking.totalPrice,
      accessToken: crypto.randomUUID()
    }
  });
}

async function updateBookingStatus(req, res) {
  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: { status: req.validated.body.status },
    include: bookingInclude
  });
  if (booking.status === "CONFIRMED") {
    try {
      // Attach the (possibly just-created) invoice to the response so the
      // caller sees it immediately, instead of only on the next GET.
      booking.invoice = await getOrCreateInvoice(booking);
    } catch (error) {
      // Invoicing is never allowed to block the status update itself.
      console.error("[bookingController] Invoice auto-creation failed (status update still applied):", error);
    }
  }
  res.json({ booking });
}

async function updateBookingPayment(req, res) {
  const { amountPaid, paymentMethod } = req.validated.body;
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Booking not found." });
  if (amountPaid > existing.totalPrice) {
    return res.status(400).json({ message: "Paid amount cannot exceed the total price." });
  }

  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: { amountPaid, ...(paymentMethod ? { paymentMethod } : {}) },
    include: bookingInclude
  });

  // Itemized payment history — see prisma/schema.prisma's Payment model.
  // Booking.amountPaid (above) remains the fast-read running total used
  // everywhere else; this just records the delta as its own auditable row.
  // A logging failure never blocks the payment update itself.
  const delta = amountPaid - existing.amountPaid;
  if (delta !== 0) {
    try {
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          amount: delta,
          method: paymentMethod || null,
          recordedByUserId: req.user?.sub || null,
          note: delta < 0 ? "Correction (reduced recorded amount)" : null
        }
      });
    } catch (error) {
      console.error("[bookingController] Failed to log Payment ledger row (amountPaid still updated):", error);
    }
  }

  res.json({ booking });
}

// GET /bookings/:id/payments — the itemized payment history behind
// "Payment history" in payment management. Newest first.
async function listPayments(req, res) {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  const payments = await prisma.payment.findMany({
    where: { bookingId: req.params.id },
    include: { recordedByUser: { select: { id: true, name: true } } },
    orderBy: { recordedAt: "desc" }
  });
  res.json({ payments });
}

// POST /bookings/:id/payments — "record advance payment" / "record
// remaining balance" / "record other payment". Incremental (an amount that
// just came in), unlike PATCH /bookings/:id/payment above which sets an
// absolute total. Both endpoints keep Booking.amountPaid and the Payment
// ledger in sync; they're just two different ways of expressing the same
// underlying update; see recordPaymentSchema's comment for why this one
// exists alongside the older one.
async function recordPayment(req, res) {
  const { amount, method, type, note } = req.validated.body;
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Booking not found." });

  const newAmountPaid = existing.amountPaid + amount;
  if (newAmountPaid > existing.totalPrice) {
    const remaining = existing.totalPrice - existing.amountPaid;
    return res.status(400).json({
      message: `This payment would exceed the total price. Remaining balance is ${remaining}.`
    });
  }

  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: { amountPaid: newAmountPaid, ...(method ? { paymentMethod: method } : {}) },
    include: bookingInclude
  });

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount,
      method: method || null,
      type,
      note: note || null,
      recordedByUserId: req.user?.sub || null
    }
  });

  res.status(201).json({ booking, payment });
}

// GET /bookings/:id/invoice — get-or-create the booking's invoice (see
// getOrCreateInvoice above) and return it, including accessToken so the
// caller can build the public invoice page URL
// (NEXT_PUBLIC_APP_URL + "/invoice/" + accessToken) for "Generate invoice
// PDF" / "Download invoice".
async function getBookingInvoice(req, res) {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: bookingInclude });
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  const invoice = await getOrCreateInvoice(booking);
  res.json({ invoice });
}

// POST /bookings/:id/invoice/send — "Send invoice to guest". Requires the
// guest to have an email on file (same requirement as every other automated
// email in this system — see 15_Admin_Guide.md). Logs a Notification row
// the same way booking confirmation/reminder/thank-you emails already do.
async function sendBookingInvoice(req, res) {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: bookingInclude });
  if (!booking) return res.status(404).json({ message: "Booking not found." });

  const recipient = booking.user?.email || booking.guestEmail || null;
  if (!recipient) {
    return res.status(400).json({ message: "This guest has no email on file — cannot send an invoice." });
  }

  const invoice = await getOrCreateInvoice(booking);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.CLIENT_URL || "http://localhost:3000";
  const invoiceUrl = `${appUrl.replace(/\/$/, "")}/invoice/${invoice.accessToken}`;

  const { emailResult } = await sendInvoiceEmailMessage(booking, invoice, invoiceUrl);

  try {
    await prisma.notification.create({
      data: {
        bookingId: booking.id,
        type: "invoice_email",
        channel: "email",
        recipient,
        status: emailResult.sent ? "sent" : emailResult.reason === "no_recipient" ? "skipped_no_recipient" : emailResult.reason === "not_configured" ? "skipped_not_configured" : "failed",
        errorMessage: emailResult.error || null
      }
    });
  } catch (error) {
    console.error("[bookingController] Failed to log invoice-email Notification (send result still returned):", error);
  }

  res.json({ sent: emailResult.sent, reason: emailResult.reason || null, invoiceUrl });
}

async function deleteBooking(req, res) {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  // Deliberately Owner-or-owning-guest only — RECEPTION is not included.
  // Reception's "Create bookings"/"Update payments" capabilities don't cover
  // permanently destroying a booking record; cancel via PATCH /:id/status
  // (status: CANCELLED) instead, which RECEPTION can already do.
  if (req.user.role !== "ADMIN" && booking.userId !== req.user.sub) {
    return res.status(403).json({ message: "You cannot delete this booking." });
  }
  await prisma.booking.delete({ where: { id: req.params.id } });
  res.status(204).end();
}

module.exports = {
  bookingSchema,
  bookRoom,
  createManualBooking,
  deleteBooking,
  getBookingInvoice,
  listBookings,
  listPayments,
  manualBookingSchema,
  paymentSchema,
  recordPayment,
  recordPaymentSchema,
  sendBookingInvoice,
  statusSchema,
  updateBookingPayment,
  updateBookingStatus
};

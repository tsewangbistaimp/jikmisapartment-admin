const prisma = require("../utils/prisma");

// Public — no auth. The Invoice.accessToken itself (a random UUID, not the
// sequential invoiceNumber) is the security boundary: see
// prisma/schema.prisma's Invoice.accessToken comment for why invoiceNumber
// alone would be guessable/iterable. Powers the printable invoice page
// (app/invoice/[token]/page.tsx) that both staff ("Generate/Download
// invoice PDF") and guests (via the "Send invoice to guest" email link) use
// — see 15_Admin_Guide.md's payment management section.
async function getInvoiceByToken(req, res) {
  const invoice = await prisma.invoice.findUnique({
    where: { accessToken: req.params.token },
    include: {
      booking: {
        include: {
          room: { select: { id: true, title: true, type: true, pricePerNight: true } },
          user: { select: { name: true, email: true, phone: true } }
        }
      }
    }
  });
  if (!invoice) return res.status(404).json({ message: "Invoice not found." });

  const booking = invoice.booking;
  const payments = await prisma.payment.findMany({
    where: { bookingId: booking.id },
    orderBy: { recordedAt: "asc" },
    select: { id: true, amount: true, method: true, type: true, recordedAt: true }
  });

  const remaining = Math.max(0, booking.totalPrice - booking.amountPaid);
  const paymentStatus = booking.amountPaid <= 0 ? "unpaid" : remaining > 0 ? "partially_paid" : "fully_paid";

  // Deliberately sanitized — only what belongs on this one guest's own
  // invoice. Never echoes accessToken back, and never includes anything
  // about any other booking/guest.
  res.json({
    apartmentName: "Jikmis Apartment",
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    guest: {
      name: booking.user?.name || booking.guestName || "Guest",
      email: booking.user?.email || booking.guestEmail || null,
      phone: booking.user?.phone || booking.guestPhone || null
    },
    room: {
      title: booking.room.title,
      type: booking.room.type,
      pricePerNight: booking.room.pricePerNight
    },
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guestCount: booking.guestCount,
    totalAmount: invoice.totalAmount,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    amountPaid: booking.amountPaid,
    remaining,
    paymentStatus,
    bookingStatus: booking.status,
    payments
  });
}

module.exports = { getInvoiceByToken };

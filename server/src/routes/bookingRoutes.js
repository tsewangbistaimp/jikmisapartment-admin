const router = require("express").Router();
const validate = require("../middleware/validate");
const { requireAuth, requireStaff } = require("../middleware/auth");
const {
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
} = require("../controllers/bookingController");

// GET/POST / stay open to any authenticated role (not just staff) — a
// logged-in guest (USER) self-booking or viewing their own bookings via the
// legacy authenticated flow is an existing feature, unrelated to staff role
// management. listBookings scopes what a non-staff caller sees; see
// bookingController.js.
router.get("/", requireAuth, listBookings);
router.post("/", requireAuth, validate(bookingSchema), bookRoom);
// Owner/Admin or Reception Staff: log a walk-in/phone booking for a guest
// without an account ("Create bookings").
router.post("/manual", requireAuth, requireStaff, validate(manualBookingSchema), createManualBooking);
router.patch("/:id/status", requireAuth, requireStaff, validate(statusSchema), updateBookingStatus);
// "Update payments" is an explicit Reception capability.
router.patch("/:id/payment", requireAuth, requireStaff, validate(paymentSchema), updateBookingPayment);
// Payment management: itemized history, and recording an incoming advance/
// remaining/other payment (see recordPaymentSchema's comment for how this
// differs from the absolute-value PATCH above).
router.get("/:id/payments", requireAuth, requireStaff, listPayments);
router.post("/:id/payments", requireAuth, requireStaff, validate(recordPaymentSchema), recordPayment);
// Invoice: get-or-create (for viewing/downloading the printable invoice
// page) and emailing it to the guest.
router.get("/:id/invoice", requireAuth, requireStaff, getBookingInvoice);
router.post("/:id/invoice/send", requireAuth, requireStaff, sendBookingInvoice);
// Hard delete stays Owner-or-the-booking's-own-user only (see deleteBooking).
// Reception cancels a booking via PATCH /:id/status -> CANCELLED instead.
router.delete("/:id", requireAuth, deleteBooking);

module.exports = router;

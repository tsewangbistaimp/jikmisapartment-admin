/**
 * Guest communication automation — booking confirmation, pre-arrival
 * reminder, and post-checkout thank-you/review request.
 *
 * Plain CommonJS on purpose (see lib/mailer.js): this file is required both
 * by the Next.js AI booking assistant (lib/bookingAssistant.ts) and by the
 * legacy Express booking service (server/src/services/bookingService.js),
 * so the message content and sending logic exist in exactly one place for
 * both booking paths, per "AI bookings and manual admin bookings use the
 * same database" — they now also use the same communication system.
 *
 * Message copy is sourced from ai-knowledge-base/09_Email_Templates.md
 * (templates 2, 13, 14). If you edit the wording there, update the
 * functions below to match — see that file's "Live automation note".
 *
 * WhatsApp limitation (read before assuming this sends silently): there is
 * no WhatsApp Business API configured in this project (that requires a
 * verified Meta business account + access token, not present in .env).
 * "WhatsApp confirmation" here means generating a pre-filled wa.me link:
 *  - At booking time, the chat client auto-opens it in a new tab for the
 *    guest (components/ApartmentChatbot.tsx), so it's effectively one less
 *    click than the site's existing inquiry flow, but still requires the
 *    guest to hit "send" in WhatsApp themselves.
 *  - For the async reminder/thank-you messages (sent by a cron job when the
 *    guest isn't on the site), there's no tab to auto-open, so the link is
 *    included in the automated EMAIL instead as a tap-to-message button.
 * True silent server-to-WhatsApp push is not possible without that API.
 */
const { sendMail } = require("./mailer");

// Mirrors lib/site.ts. Duplicated as plain constants (not imported) because
// this file must also load under plain Node in the Express server, which
// cannot parse lib/site.ts's TypeScript syntax. Keep these in sync.
const WHATSAPP_NUMBER = "9779708538395";
const INQUIRY_EMAIL = "jikmisdonkhang@gmail.com";
const GOOGLE_MAPS_URL = "https://maps.app.goo.gl/aRgUNak3RATee21c8";
const CONTACT_LINE = "WhatsApp/Call: 9708538395 / 9869035191\nEmail: jikmisdonkhang@gmail.com";

function formatCurrency(amount) {
  return `NPR ${Number(amount || 0).toLocaleString("en-US")}`;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function nightsBetween(checkIn, checkOut) {
  const start = checkIn instanceof Date ? checkIn : new Date(checkIn);
  const end = checkOut instanceof Date ? checkOut : new Date(checkOut);
  return Math.max(Math.ceil((end.getTime() - start.getTime()) / 86400000), 0);
}

/** Same guest-details fallback precedence used in app/admin/page.tsx. */
function resolveContact(booking) {
  return {
    name: booking.user?.name || booking.guestName || "Guest",
    email: booking.user?.email || booking.guestEmail || null,
    phone: booking.user?.phone || booking.guestPhone || null,
    whatsapp: booking.guestWhatsapp || booking.user?.phone || booking.guestPhone || null
  };
}

function buildWhatsappLink(phone, message) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// SECURITY: invoiceEmailContent() below is the one template in this file
// that builds an `html` body (the other three are plain text only, which
// can't execute markup regardless). Every value interpolated into that HTML
// — guest name, room title, invoice URL — ultimately traces back to
// guest-submitted booking data (guestName from the public booking form, AI
// chat, or admin manual entry), so it must be escaped before going into
// markup, the same as any other user input rendered as HTML. Plain string
// replacement (not a library) is enough for the 5 characters that matter in
// HTML text/attribute contexts.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Template 2: Booking Confirmation --------------------------------------

function bookingConfirmationContent(booking) {
  const contact = resolveContact(booking);
  const roomTitle = booking.room?.title || "your room";
  const nights = nightsBetween(booking.checkIn, booking.checkOut);

  // Built before the email text so the link can be embedded in the email
  // itself (see the module-level "WhatsApp limitation" note above) — this
  // is the ONLY way a guest booked through a path other than live AI chat
  // (admin-logged, legacy authenticated) ever sees this link at all, since
  // there's no browser tab to auto-open for them.
  const whatsappMessage = `Hello ${contact.name}, this is Jikmis Apartment confirming your booking (Ref: ${booking.id}). ${roomTitle}, ${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)} (${nights} night${nights === 1 ? "" : "s"}), total ${formatCurrency(booking.totalPrice)}. A 50% advance payment secures your room — cash, bank transfer, eSewa, or Khalti. Please send your payment screenshot here on WhatsApp once paid.`;
  const whatsappUrl = buildWhatsappLink(contact.whatsapp, whatsappMessage);

  const text = `Dear ${contact.name},

We're happy to confirm your booking at Jikmis Apartment:

- Room type: ${roomTitle}
- Check-in: ${formatDate(booking.checkIn)}, from 2:00 PM onwards
- Check-out: ${formatDate(booking.checkOut)}, before 12:00 PM (noon)
- Nights: ${nights}
- Guests: ${booking.guestCount || 1}
- Total price: ${formatCurrency(booking.totalPrice)}
- Booking reference: ${booking.id}
${booking.specialRequests ? `- Special request noted: ${booking.specialRequests}\n` : ""}
Booking terms:
- A 50% advance payment secures this booking.
- The remaining 50% is due within 2 days of check-in.
- Accepted payment methods: cash, bank transfer, eSewa, Khalti.
- Please bring a valid government ID, citizenship, or passport at check-in.
- After paying, please share your payment screenshot with us on WhatsApp so we can confirm receipt.
${whatsappUrl ? `\nTap to message us on WhatsApp about this booking: ${whatsappUrl}\n` : ""}
We look forward to hosting you. If you have any questions before your stay, reach us anytime.

Warm regards,
Jikmis Apartment Team
${CONTACT_LINE}`;

  return { subject: "Your Jikmis Apartment booking is confirmed", text, contact, roomTitle, nights, whatsappUrl };
}

async function sendBookingConfirmation(booking) {
  const { subject, text, contact, whatsappUrl } = bookingConfirmationContent(booking);
  const emailResult = contact.email ? await sendMail({ to: contact.email, subject, text }) : { sent: false, reason: "no_recipient" };
  return { emailResult, whatsappUrl, contact };
}

// --- Template 13: Pre-Arrival / Check-in Reminder ---------------------------

function preCheckinReminderContent(booking) {
  const contact = resolveContact(booking);
  const roomTitle = booking.room?.title || "your room";

  // Built before the email text so it can be embedded below — this cron-
  // triggered message has no browser tab to auto-open for the guest, so the
  // email is the only place this link can actually reach them (see the
  // module-level "WhatsApp limitation" note above).
  const whatsappUrl = buildWhatsappLink(
    contact.whatsapp,
    `Hello ${contact.name}, this is a reminder from Jikmis Apartment — your check-in is tomorrow from 2:00 PM. Please bring a valid ID/citizenship/passport. See you soon!`
  );

  const text = `Dear ${contact.name},

We're looking forward to welcoming you to Jikmis Apartment tomorrow! Here's a quick reminder for your arrival:

- Room: ${roomTitle}
- Check-in: ${formatDate(booking.checkIn)}, from 2:00 PM onwards
- Please bring a valid government ID, citizenship, or passport.
- If you haven't yet sent your advance payment, please do so via cash, bank transfer, eSewa, or Khalti, and share the screenshot with us on WhatsApp so we can confirm everything is ready.
${whatsappUrl ? `\nTap to message us on WhatsApp: ${whatsappUrl}\n` : ""}
If your arrival time or travel plans have changed, just let us know. Safe travels, and see you soon!

Warm regards,
Jikmis Apartment Team
${CONTACT_LINE}`;

  return { subject: "Your stay at Jikmis Apartment starts tomorrow", text, contact, roomTitle, whatsappUrl };
}

async function sendPreCheckinReminder(booking) {
  const { subject, text, contact, whatsappUrl } = preCheckinReminderContent(booking);
  const emailResult = contact.email ? await sendMail({ to: contact.email, subject, text }) : { sent: false, reason: "no_recipient" };
  return { emailResult, whatsappUrl, contact };
}

// --- Template 14: Post-Checkout Thank You & Review Request ------------------

function postCheckoutThankYouContent(booking) {
  const contact = resolveContact(booking);
  const roomTitle = booking.room?.title || "your room";

  const whatsappUrl = buildWhatsappLink(
    contact.whatsapp,
    `Hello ${contact.name}, thank you for staying at Jikmis Apartment! We'd love a quick Google review if you have a moment: ${GOOGLE_MAPS_URL}`
  );

  const text = `Dear ${contact.name},

Thank you for staying with us! We hope your time in Boudha, and your ${roomTitle}, was everything you needed.

If you have a moment, we'd really appreciate a quick review on Google — it helps other travelers find us and means a lot to our small team:
${GOOGLE_MAPS_URL}

And if you're ever back in Kathmandu, whether for a short stay or a longer monthly stay, we'd love to host you again${whatsappUrl ? ` — just message us on WhatsApp: ${whatsappUrl}` : ""}.

Warm regards,
Jikmis Apartment Team
${CONTACT_LINE}`;

  return { subject: "Thank you for staying with Jikmis Apartment", text, contact, roomTitle, whatsappUrl };
}

async function sendPostCheckoutThankYou(booking) {
  const { subject, text, contact, whatsappUrl } = postCheckoutThankYouContent(booking);
  const emailResult = contact.email ? await sendMail({ to: contact.email, subject, text }) : { sent: false, reason: "no_recipient" };
  return { emailResult, whatsappUrl, contact };
}

// --- Invoice email (payment management) ------------------------------------
//
// Unlike the three templates above, this one carries a LINK rather than
// embedding everything inline — the public, printable invoice page
// (app/invoice/[token]/page.tsx) is the actual "PDF" (see its own header
// comment for why: no PDF-generation library is installable in this
// project's environment, so the browser's own print-to-PDF is the invoice
// download/print mechanism). This email's job is just to get the guest a
// working link plus a quick text summary in case they don't click through.

function invoiceEmailContent(booking, invoice, invoiceUrl) {
  const contact = resolveContact(booking);
  const roomTitle = booking.room?.title || "your room";
  const remaining = Math.max(0, booking.totalPrice - booking.amountPaid);
  const paymentStatus = booking.amountPaid <= 0 ? "Unpaid" : remaining > 0 ? "Partially paid" : "Fully paid";

  const whatsappUrl = buildWhatsappLink(
    contact.whatsapp,
    `Hello ${contact.name}, here is your Jikmis Apartment invoice ${invoice.invoiceNumber}: ${invoiceUrl}`
  );

  const text = `Dear ${contact.name},

Here is your invoice for your stay at Jikmis Apartment.

- Invoice number: ${invoice.invoiceNumber}
- Room: ${roomTitle}
- Check-in: ${formatDate(booking.checkIn)}
- Check-out: ${formatDate(booking.checkOut)}
- Total amount: ${formatCurrency(invoice.totalAmount)}
- Paid: ${formatCurrency(booking.amountPaid)}
- Remaining: ${formatCurrency(remaining)}
- Payment status: ${paymentStatus}

View, print, or save this invoice as a PDF here:
${invoiceUrl}
${whatsappUrl ? `\nTap to message us on WhatsApp about this invoice: ${whatsappUrl}\n` : ""}
Thank you for staying with us.

Warm regards,
Jikmis Apartment Team
${CONTACT_LINE}`;

  const html = `<p>Dear ${escapeHtml(contact.name)},</p>
<p>Here is your invoice for your stay at Jikmis Apartment.</p>
<ul>
<li><strong>Invoice number:</strong> ${escapeHtml(invoice.invoiceNumber)}</li>
<li><strong>Room:</strong> ${escapeHtml(roomTitle)}</li>
<li><strong>Check-in:</strong> ${escapeHtml(formatDate(booking.checkIn))}</li>
<li><strong>Check-out:</strong> ${escapeHtml(formatDate(booking.checkOut))}</li>
<li><strong>Total amount:</strong> ${escapeHtml(formatCurrency(invoice.totalAmount))}</li>
<li><strong>Paid:</strong> ${escapeHtml(formatCurrency(booking.amountPaid))}</li>
<li><strong>Remaining:</strong> ${escapeHtml(formatCurrency(remaining))}</li>
<li><strong>Payment status:</strong> ${escapeHtml(paymentStatus)}</li>
</ul>
<p><a href="${encodeURI(invoiceUrl)}">View, print, or save this invoice as a PDF</a></p>
<p>Thank you for staying with us.<br />Warm regards,<br />Jikmis Apartment Team<br />${escapeHtml(CONTACT_LINE).replace(/\n/g, "<br />")}</p>`;

  return { subject: `Your Jikmis Apartment invoice ${invoice.invoiceNumber}`, text, html, contact, whatsappUrl };
}

async function sendInvoiceEmail(booking, invoice, invoiceUrl) {
  const { subject, text, html, contact, whatsappUrl } = invoiceEmailContent(booking, invoice, invoiceUrl);
  const emailResult = contact.email ? await sendMail({ to: contact.email, subject, text, html }) : { sent: false, reason: "no_recipient" };
  return { emailResult, whatsappUrl, contact };
}

module.exports = {
  buildWhatsappLink,
  formatCurrency,
  formatDate,
  nightsBetween,
  resolveContact,
  bookingConfirmationContent,
  preCheckinReminderContent,
  postCheckoutThankYouContent,
  invoiceEmailContent,
  sendBookingConfirmation,
  sendPreCheckinReminder,
  sendPostCheckoutThankYou,
  sendInvoiceEmail
};

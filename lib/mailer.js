/**
 * Thin nodemailer wrapper for guest communication automation
 * (lib/guestMessaging.js). Plain CommonJS (not TypeScript) on purpose: both
 * the Next.js app (via the "@/lib/*" path alias) and the legacy Express API
 * (server/src/services/bookingService.js, via a relative path) import this
 * SAME file, so email-sending logic exists in exactly one place rather than
 * being duplicated per runtime.
 *
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in the
 * environment (see .env.example). If they aren't set, sendMail() logs a
 * warning and resolves with { sent: false, reason: "not_configured" }
 * instead of throwing — a missing SMTP setup must never break booking
 * creation itself.
 */
const nodemailer = require("nodemailer");

let cachedTransporter = null;
let warnedOnce = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return cachedTransporter;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 * @returns {Promise<{ sent: boolean, reason?: string, error?: string }>}
 */
async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();

  if (!transporter) {
    if (!warnedOnce) {
      console.warn(
        "[mailer] SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) — skipping guest email. Set these in .env to enable automated confirmation/reminder/thank-you emails."
      );
      warnedOnce = true;
    }
    return { sent: false, reason: "not_configured" };
  }

  if (!to) {
    return { sent: false, reason: "no_recipient" };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Jikmis Apartment <jikmisdonkhang@gmail.com>",
      to,
      subject,
      text,
      html: html || undefined
    });
    return { sent: true };
  } catch (error) {
    console.error("[mailer] Failed to send email:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "send_error", error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { isConfigured, sendMail };

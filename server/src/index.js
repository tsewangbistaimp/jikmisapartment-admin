require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const cors = require("cors");
const express = require("express");
const adminRoutes = require("./routes/adminRoutes");
const authRoutes = require("./routes/authRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const chatRoutes = require("./routes/chatRoutes");
const guestRoutes = require("./routes/guestRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const roomRoutes = require("./routes/roomRoutes");
const staffRoutes = require("./routes/staffRoutes");
const { errorHandler, notFound } = require("./middleware/error");

// Fail fast rather than silently signing/verifying every auth token with
// undefined (or the .env.example placeholder) as the JWT secret — that would
// make every login/session either non-functional or, worse, forgeable.
const PLACEHOLDER_JWT_SECRET = "replace-with-a-long-random-secret";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === PLACEHOLDER_JWT_SECRET) {
  console.error(
    "[startup] JWT_SECRET is not set (or is still the .env.example placeholder). " +
      "Set a long, random JWT_SECRET in your environment before starting the server."
  );
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 4000;
const host = process.env.HOST || "127.0.0.1";

// SECURITY: hand-rolled security headers (no `helmet` dependency — same
// "can't reliably install new npm packages in this sandbox" constraint
// documented for the rate limiter, see middleware/rateLimit.js). This API
// only ever serves JSON, never renders HTML, so `default-src 'none'` is
// correct here — there's nothing on this origin a CSP needs to permit.
// Added because this API previously sent no security headers at all.
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true, service: "jikmis-apartment-api" }));
app.use("/auth", authRoutes);
app.use("/rooms", roomRoutes);
app.use("/bookings", bookingRoutes);
app.use("/admin", adminRoutes);
app.use("/admin/staff", staffRoutes);
app.use("/guests", guestRoutes);
// Public — no auth (see invoiceController.js). The unguessable accessToken
// in the URL is the security boundary, not a JWT.
app.use("/invoices", invoiceRoutes);
app.use("/chat", chatRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(port, host, () => {
  console.log(`Jikmis Apartment API running on http://${host}:${port}`);
});

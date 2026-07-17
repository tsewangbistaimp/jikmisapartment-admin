const jwt = require("jsonwebtoken");
const prisma = require("../utils/prisma");

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// Verifies the JWT, then re-checks the account against the database on every
// request. A JWT alone can't reflect a staff account being deactivated
// mid-session (see User.isActive) or deleted after the token was issued —
// this trades one extra indexed lookup per request for that guarantee, which
// matters for a hotel front desk where a departing staff member's access
// needs to end immediately, not up to 7 days later when their token expires.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    return res.status(401).json({ message: "Invalid authentication token." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "This account no longer has access. Contact an administrator." });
    }
    // Use the freshly-read role, not the token's — if an Owner changes a
    // staff member's role mid-session, that change takes effect on their
    // very next request instead of waiting for the old token to expire.
    req.user = { ...payload, role: user.role };
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Could not verify account status." });
  }
}

// requireRole("ADMIN") / requireRole("ADMIN", "RECEPTION") — must run after
// requireAuth, which populates req.user.
function requireRole(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    return next();
  };
}

// Owner/Admin only — full access (staff, rooms, pricing, reports, settings).
const requireAdmin = requireRole("ADMIN");

// Owner/Admin or Reception Staff — day-to-day front-desk operations
// (bookings, guests, payments, availability). See requireAdmin above for the
// Owner-only surface these deliberately exclude.
const requireStaff = requireRole("ADMIN", "RECEPTION");

module.exports = { requireAdmin, requireStaff, requireRole, requireAuth, signToken };

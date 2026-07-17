const router = require("express").Router();
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const {
  changePassword,
  login,
  loginSchema,
  passwordSchema,
  register,
  registerSchema
} = require("../controllers/authController");

// Login/register are the classic brute-force/credential-stuffing/spam-signup
// targets — throttle both per-IP. See middleware/rateLimit.js for the
// single-instance limitation.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many login attempts. Please try again in a few minutes." });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many accounts created from this location. Please try again later." });

router.post("/register", registerLimiter, validate(registerSchema), register);
router.post("/login", loginLimiter, validate(loginSchema), login);
router.patch("/password", requireAuth, validate(passwordSchema), changePassword);

module.exports = router;

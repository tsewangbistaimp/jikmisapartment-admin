const router = require("express").Router();
const { analytics, dashboard, users } = require("../controllers/adminController");
const { requireAdmin, requireAuth } = require("../middleware/auth");

router.get("/dashboard", requireAuth, requireAdmin, dashboard);
router.get("/analytics", requireAuth, requireAdmin, analytics);
router.get("/users", requireAuth, requireAdmin, users);

module.exports = router;

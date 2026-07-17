const router = require("express").Router();
const validate = require("../middleware/validate");
const { requireAdmin, requireAuth } = require("../middleware/auth");
const {
  createStaff,
  createStaffSchema,
  listStaff,
  updateStaff,
  updateStaffSchema
} = require("../controllers/staffController");

// Owner/Admin only — "Manage staff". Mounted at /admin/staff in index.js.
router.get("/", requireAuth, requireAdmin, listStaff);
router.post("/", requireAuth, requireAdmin, validate(createStaffSchema), createStaff);
router.patch("/:id", requireAuth, requireAdmin, validate(updateStaffSchema), updateStaff);

module.exports = router;

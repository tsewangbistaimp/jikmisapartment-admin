const router = require("express").Router();
const validate = require("../middleware/validate");
const { requireAuth, requireStaff } = require("../middleware/auth");
const { getGuest, listGuests, updateGuest, updateGuestSchema } = require("../controllers/guestController");

// Owner/Admin or Reception Staff — "Manage guests".
router.get("/", requireAuth, requireStaff, listGuests);
router.get("/:id", requireAuth, requireStaff, getGuest);
router.patch("/:id", requireAuth, requireStaff, validate(updateGuestSchema), updateGuest);

module.exports = router;

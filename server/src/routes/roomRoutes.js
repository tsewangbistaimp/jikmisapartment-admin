const router = require("express").Router();
const validate = require("../middleware/validate");
const { requireAdmin, requireAuth } = require("../middleware/auth");
const { createRoom, deleteRoom, getRoom, listRooms, roomSchema, updateRoom } = require("../controllers/roomController");

router.get("/", listRooms);
router.get("/:id", getRoom);
router.post("/", requireAuth, requireAdmin, validate(roomSchema), createRoom);
router.put("/:id", requireAuth, requireAdmin, validate(roomSchema), updateRoom);
router.delete("/:id", requireAuth, requireAdmin, deleteRoom);

module.exports = router;

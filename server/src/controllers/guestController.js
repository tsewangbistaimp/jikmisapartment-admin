const { z } = require("zod");
const prisma = require("../utils/prisma");

// "Manage guests" (Reception Staff capability). Guest here is the
// deduplicated identity record from prisma/schema.prisma's Guest model —
// distinct from User (login accounts) and from the point-in-time guest*
// snapshot fields stored directly on each Booking. Guest records are
// currently only ever created implicitly during booking (AI chat, admin
// manual entry, guest matching — see lib/bookingAssistant.ts and
// bookingController.js); this controller adds the missing read/search/edit
// surface for staff, without changing how Guest rows get created.
const updateGuestSchema = z.object({
  body: z
    .object({
      name: z.string().min(2).optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      email: z.string().email().optional(),
      notes: z.string().optional()
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "Provide at least one field to update."
    })
});

async function listGuests(req, res) {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { whatsapp: { contains: search } },
          { email: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};

  const guests = await prisma.guest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { bookings: true } } }
  });
  res.json({ guests });
}

async function getGuest(req, res) {
  const guest = await prisma.guest.findUnique({
    where: { id: req.params.id },
    include: {
      bookings: {
        orderBy: { createdAt: "desc" },
        include: { room: { select: { id: true, title: true, type: true } } }
      }
    }
  });
  if (!guest) return res.status(404).json({ message: "Guest not found." });
  res.json({ guest });
}

async function updateGuest(req, res) {
  const existing = await prisma.guest.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Guest not found." });

  const guest = await prisma.guest.update({
    where: { id: req.params.id },
    data: req.validated.body
  });
  res.json({ guest });
}

module.exports = { getGuest, listGuests, updateGuest, updateGuestSchema };

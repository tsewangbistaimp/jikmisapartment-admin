const { z } = require("zod");
const prisma = require("../utils/prisma");

const roomBody = z.object({
  title: z.string().min(2),
  type: z.enum(["STUDIO", "SINGLE", "DOUBLE", "FAMILY"]),
  pricePerNight: z.coerce.number().int().positive(),
  pricePerMonth: z.coerce.number().int().positive(),
  description: z.string().min(10),
  facilities: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  images: z.array(z.string().url()).default([]),
  isAvailable: z.boolean().default(true),
  maxGuests: z.coerce.number().int().positive().default(2),
  totalUnits: z.coerce.number().int().positive().default(1)
});

const roomSchema = z.object({ body: roomBody });

const ROOM_TYPES = ["STUDIO", "SINGLE", "DOUBLE", "FAMILY"];

// GET /rooms is public and its query params (?type=, ?maxPrice=, ?available=)
// come straight from the URL — validated here rather than trusting them
// directly into the Prisma filter. This was never a SQL-injection risk
// (Prisma parameterizes everything and would reject an invalid enum value
// outright), but an unvalidated ?type=whatever or a non-numeric ?maxPrice=
// previously fell through to an unhandled Prisma error and a raw 500 —
// cheap to validate properly instead of leaking that internal detail.
function listRoomsQuerySchema() {
  return z.object({
    type: z.enum(ROOM_TYPES).optional(),
    maxPrice: z.coerce.number().positive().optional(),
    available: z.enum(["true", "false"]).optional()
  });
}

async function listRooms(req, res) {
  const parsed = listRoomsQuerySchema().safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid query parameters.", errors: parsed.error.flatten() });
  }
  const { type, maxPrice, available } = parsed.data;
  const rooms = await prisma.room.findMany({
    where: {
      type: type || undefined,
      pricePerNight: maxPrice ? { lte: maxPrice } : undefined,
      isAvailable: available === "true" ? true : undefined
    },
    orderBy: { pricePerNight: "asc" }
  });
  res.json({ rooms });
}

async function getRoom(req, res) {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    include: { bookings: { select: { checkIn: true, checkOut: true, status: true } } }
  });
  if (!room) return res.status(404).json({ message: "Room not found." });
  res.json({ room });
}

async function createRoom(req, res) {
  const room = await prisma.room.create({ data: req.validated.body });
  res.status(201).json({ room });
}

async function updateRoom(req, res) {
  const room = await prisma.room.update({ where: { id: req.params.id }, data: req.validated.body });
  res.json({ room });
}

async function deleteRoom(req, res) {
  await prisma.room.delete({ where: { id: req.params.id } });
  res.status(204).end();
}

module.exports = { createRoom, deleteRoom, getRoom, listRooms, roomSchema, updateRoom };

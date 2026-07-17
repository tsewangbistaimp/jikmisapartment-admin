const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../utils/prisma");

// Staff accounts are User rows with role ADMIN ("Owner/Admin") or RECEPTION
// ("Reception Staff") — see prisma/schema.prisma's Role enum comment. This
// controller is the Owner-only "Manage staff" capability from the role spec;
// plain guest (USER) accounts are managed via public /auth/register instead
// and never appear here.
const STAFF_ROLES = ["ADMIN", "RECEPTION"];

const createStaffSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    password: z.string().min(8),
    role: z.enum(STAFF_ROLES)
  })
});

const updateStaffSchema = z.object({
  body: z
    .object({
      role: z.enum(STAFF_ROLES).optional(),
      isActive: z.boolean().optional(),
      name: z.string().min(2).optional(),
      phone: z.string().optional()
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "Provide at least one field to update."
    })
});

const staffSelect = { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true };

async function listStaff(req, res) {
  const staff = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    select: staffSelect,
    orderBy: { createdAt: "desc" }
  });
  res.json({ staff });
}

async function createStaff(req, res) {
  const { name, email, phone, password, role } = req.validated.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ message: "Email is already registered." });

  const user = await prisma.user.create({
    data: { name, email, phone, role, passwordHash: await bcrypt.hash(password, 12) },
    select: staffSelect
  });
  res.status(201).json({ user });
}

async function updateStaff(req, res) {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target || !STAFF_ROLES.includes(target.role)) {
    return res.status(404).json({ message: "Staff account not found." });
  }

  const { role, isActive, name, phone } = req.validated.body;
  const isSelf = target.id === req.user.sub;
  const isDeactivating = isActive === false;
  const isDemoting = role && role !== target.role && target.role === "ADMIN";

  // Self-lockout guard: an Owner/Admin can't deactivate or demote their own
  // account — otherwise a single careless click could lock every Owner out
  // of staff management with no way back in.
  if (isSelf && (isDeactivating || isDemoting)) {
    return res.status(400).json({ message: "You cannot deactivate or demote your own account." });
  }

  // Last-Owner guard: never allow the only remaining active ADMIN to be
  // demoted or deactivated by someone else, either — the property must
  // always have at least one active Owner/Admin account.
  if (target.role === "ADMIN" && target.isActive && (isDeactivating || isDemoting)) {
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (activeAdmins <= 1) {
      return res.status(400).json({ message: "Cannot remove the last active Owner/Admin account." });
    }
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(role ? { role } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(name ? { name } : {}),
      ...(phone !== undefined ? { phone } : {})
    },
    select: staffSelect
  });
  res.json({ user });
}

module.exports = { createStaff, createStaffSchema, listStaff, updateStaff, updateStaffSchema };

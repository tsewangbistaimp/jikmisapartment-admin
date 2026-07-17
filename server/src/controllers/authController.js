const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { signToken } = require("../middleware/auth");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    password: z.string().min(8)
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
});

// Self-service password change (requireAuth) — lets any account, including
// the seeded default Owner/Admin, rotate its own password without staff
// management access. See staffController.js for an Owner resetting/managing
// OTHER accounts.
const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
  })
});

async function register(req, res) {
  const { name, email, phone, password } = req.validated.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ message: "Email is already registered." });

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 12)
    },
    select: { id: true, name: true, email: true, phone: true, role: true }
  });

  res.status(201).json({ user, token: signToken(user) });
}

async function login(req, res) {
  const { email, password } = req.validated.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }
  if (!user.isActive) {
    return res.status(401).json({ message: "This account no longer has access. Contact an administrator." });
  }

  const safeUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
  res.json({ user: safeUser, token: signToken(user) });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.validated.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) }
  });
  res.json({ message: "Password updated." });
}

module.exports = { changePassword, login, loginSchema, passwordSchema, register, registerSchema };

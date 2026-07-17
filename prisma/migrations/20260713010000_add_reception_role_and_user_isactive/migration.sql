-- Additive migration on top of 20260713000000_init. Do not edit the init
-- migration — see prisma/schema.prisma for the Role enum / User.isActive
-- comments explaining why these exist (Owner/Admin + Reception Staff role
-- management, PATCH /admin/staff/:id staff deactivation).

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RECEPTION';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

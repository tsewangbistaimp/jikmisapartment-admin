-- Additive migration on top of 20260713000000_init and
-- 20260713010000_add_reception_role_and_user_isactive. Do not edit either
-- earlier migration — see prisma/schema.prisma for the Payment.type /
-- Invoice.accessToken comments explaining why these exist (payment
-- management: advance/remaining payment tagging, and an unguessable public
-- invoice link).

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'other';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "accessToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_accessToken_key" ON "Invoice"("accessToken");

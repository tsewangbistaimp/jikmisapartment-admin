/**
 * Prisma client for the Next.js side of the app (used by the AI booking
 * assistant in app/api/chat/route.ts). This connects to the SAME database
 * and uses the SAME generated Prisma Client / schema as the legacy Express
 * backend (server/src/utils/prisma.js) — it is a second client instance
 * because Next.js and the Express API run as separate Node processes, not a
 * second database or a duplicated schema.
 *
 * Cached on globalThis so Next.js dev-mode hot reloads don't open a new
 * Postgres connection pool on every file change.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var __jikmisPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__jikmisPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__jikmisPrisma = prisma;
}

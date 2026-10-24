/**
 * Set or reset the PIN of an existing account in both Postgres and Firestore.
 * Run: npx tsx scripts/set-pin.ts <email> <pin>
 * Needs DATABASE_URL and FIREBASE_SERVICE_ACCOUNT (from .env or the shell).
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig();
import { createHash } from "crypto";
import { db, ensureSchema } from "../lib/db";
import { getUserById, saveUser } from "../lib/firestore";

async function main() {
  const [rawEmail, pin] = process.argv.slice(2);
  if (!rawEmail || !pin || !/^\d{4,6}$/.test(pin)) throw new Error("Usage: npx tsx scripts/set-pin.ts <email> <4-6 digit pin>");
  const userId = rawEmail.toLowerCase().trim();
  const pinHash = createHash("sha256").update(pin).digest("hex");

  const existing = await getUserById(userId).catch(() => null);
  const [row] = await db.$queryRaw<{ firstName: string; lastName: string }[]>`SELECT "firstName", "lastName" FROM "UserPin" WHERE "userId" = ${userId} LIMIT 1`.catch(() => []);
  const firstName = row?.firstName ?? existing?.firstName ?? "User";
  const lastName = row?.lastName ?? existing?.lastName ?? "";

  await ensureSchema();
  const taken = await db.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "UserPin" WHERE "pinHash" = ${pinHash} AND "userId" <> ${userId} LIMIT 1`;
  if (taken.length) throw new Error("That PIN belongs to a different account.");

  await db.$executeRaw`INSERT INTO "User" ("id", "email", "createdAt") VALUES (${userId}, ${userId}, NOW()) ON CONFLICT ("id") DO NOTHING`;
  await db.$executeRaw`DELETE FROM "UserPin" WHERE "userId" = ${userId}`;
  await db.$executeRaw`
    INSERT INTO "UserPin" ("pinHash", "userId", "firstName", "lastName", "email", "createdAt")
    VALUES (${pinHash}, ${userId}, ${firstName}, ${lastName}, ${userId}, NOW())
  `;
  await saveUser({ userId, firstName, lastName, email: userId, pinHash });
  console.log(`PIN updated for ${userId} (Postgres and Firestore).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { db, ensureSchema } from "../../../../lib/db";
import { saveUser, getUserByPinHash } from "../../../../lib/firestore";

const Schema = z.object({
  pin: z.string().min(4).max(6).regex(/^\d+$/, "PIN must be digits only"),
});

function hashPin(pin: string) {
  return createHash("sha256").update(pin).digest("hex");
}

type UserPinRow = { userId: string; firstName: string; lastName: string; email: string };

export async function POST(req: NextRequest) {
  try {
    const { pin } = Schema.parse(await req.json());
    const pinHash = hashPin(pin);

    let userId: string, firstName: string, lastName: string, email: string;

    // Postgres first. An empty result is not conclusive (the table may have been reset or rebuilt), so a miss
    // or an outage both fall through to the Firestore copy of the account.
    let found: UserPinRow | null = null;
    let pgUp = false;
    try {
      await ensureSchema();
      const rows = await db.$queryRaw<UserPinRow[]>`
        SELECT "userId", "firstName", "lastName", "email"
        FROM "UserPin"
        WHERE "pinHash" = ${pinHash}
        LIMIT 1
      `;
      pgUp = true;
      found = rows[0] ?? null;
    } catch {
      // Postgres unavailable
    }

    if (!found) {
      const fsUser = await getUserByPinHash(pinHash).catch(() => null);
      if (!fsUser) return NextResponse.json({ error: "Incorrect PIN. Try again." }, { status: 401 });
      found = fsUser;
      if (pgUp) {
        // Restore the missing Postgres rows so the rest of the app finds this account again.
        await db.$executeRaw`INSERT INTO "User" ("id", "email", "createdAt") VALUES (${fsUser.userId}, ${fsUser.email}, NOW()) ON CONFLICT ("id") DO NOTHING`.catch(() => {});
        await db.$executeRaw`
          INSERT INTO "UserPin" ("pinHash", "userId", "firstName", "lastName", "email", "createdAt")
          VALUES (${pinHash}, ${fsUser.userId}, ${fsUser.firstName}, ${fsUser.lastName}, ${fsUser.email}, NOW())
          ON CONFLICT DO NOTHING
        `.catch(() => {});
      }
    }
    ({ userId, firstName, lastName, email } = found);

    const user = { firstName, lastName, email };

    // Refresh Firestore copy but omit createdAt so the original signup timestamp is preserved
    saveUser({ userId, firstName, lastName, email, pinHash }).catch(() => {});

    const res = NextResponse.json({ ok: true, user });
    res.cookies.set("pin_uid", userId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 * 10 });
    return res;
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}

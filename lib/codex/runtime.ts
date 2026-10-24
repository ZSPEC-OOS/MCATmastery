// Wiring for the Codex API routes: Mastery's PIN session, Firestore store, and the models set in Admin → Settings.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getStore } from "./store";
import { createModelCaller } from "./model";
import type { Deps } from "./engine";

/** Codex sits behind the same PIN login as the rest of Mastery (the `pin_uid` cookie). */
export async function requireCodexUser(): Promise<{ id: string } | NextResponse> {
  const uid = (await cookies()).get("pin_uid")?.value;
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return { id: decodeURIComponent(uid) };
}

export const isDenied = (v: { id: string } | NextResponse): v is NextResponse => v instanceof NextResponse;

export function getDeps(): Deps {
  return { store: getStore(), model: createModelCaller() };
}

export function errorResponse(e: unknown, status = 500) {
  return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status });
}

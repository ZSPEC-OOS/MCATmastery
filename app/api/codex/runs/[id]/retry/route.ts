import { NextRequest, NextResponse } from "next/server";
import { retryFailed } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    return NextResponse.json({ requeued: await retryFailed(getDeps().store, id, new Date()) });
  } catch (e) {
    return errorResponse(e);
  }
}

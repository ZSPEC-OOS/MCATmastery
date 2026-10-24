import { NextRequest, NextResponse } from "next/server";
import { advance } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// One call = one task (one or two model calls). The Codex page calls this in a loop while a run is active.
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    return NextResponse.json(await advance(getDeps(), id));
  } catch (e) {
    return errorResponse(e);
  }
}

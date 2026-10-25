import { NextRequest, NextResponse } from "next/server";
import { saveTopicsToBank } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// POST: permanently save a finished Topics-only run's sections and split topics to the shared topic database.
// There is deliberately no DELETE: saved topics are never removed or re-run.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const r = await saveTopicsToBank(getDeps(), id, new Date());
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return errorResponse(e);
  }
}

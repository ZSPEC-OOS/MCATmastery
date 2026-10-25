import { NextRequest, NextResponse } from "next/server";
import { bankRun, unbankRun } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// POST: save a finished run's approved questions to the Codex database and lock the run.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const r = await bankRun(getDeps().store, id, new Date());
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE: remove the run's questions from the database and unlock it.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const r = await unbankRun(getDeps().store, id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return errorResponse(e);
  }
}

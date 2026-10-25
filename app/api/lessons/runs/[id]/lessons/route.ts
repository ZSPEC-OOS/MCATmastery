import { NextRequest, NextResponse } from "next/server";
import { confirmAiApproved, controlRun, decideLesson, queueLessons, startRun } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// "start": release the hold and get every pending lesson ready (the page then runs it). "pause" holds all work.
// "stop" drops everything still queued. "queue" (with subsectionIds) adds lessons to the run or rewrites ones already
// there; it never starts anything. "approve" / "reject" (with subsectionId) are the optional human decisions, and
// "approve_all" confirms every lesson the AI has already passed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; subsectionId?: string; subsectionIds?: unknown };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "start") {
      const r = await startRun(store, id, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "queue") {
      const subsectionIds = Array.isArray(body.subsectionIds) ? body.subsectionIds.filter((x): x is string => typeof x === "string") : [];
      const r = await queueLessons(store, id, now, subsectionIds);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "pause" || body.action === "stop") {
      const r = await controlRun(store, id, body.action);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "approve_all") return NextResponse.json({ approved: await confirmAiApproved(store, id, now) });
    if ((body.action === "approve" || body.action === "reject") && typeof body.subsectionId === "string") {
      const r = await decideLesson(store, id, body.subsectionId, body.action, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

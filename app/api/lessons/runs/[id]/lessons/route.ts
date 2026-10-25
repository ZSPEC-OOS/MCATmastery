import { NextRequest, NextResponse } from "next/server";
import { approveAllLessons, controlLessons, decideLesson, startLessons } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// "start": develop every lesson of the run (switches automatic lessons on) or, with subsectionIds, just those lessons.
// "pause" / "resume" / "stop" control lesson work only. "approve" / "reject" (with subsectionId) and "approve_all"
// are the human review decisions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; subsectionId?: string; subsectionIds?: unknown };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "start") {
      const subsectionIds = Array.isArray(body.subsectionIds) ? body.subsectionIds.filter((x): x is string => typeof x === "string") : undefined;
      const r = await startLessons(store, id, now, subsectionIds);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "pause" || body.action === "resume" || body.action === "stop") {
      const r = await controlLessons(store, id, body.action);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "approve_all") return NextResponse.json({ approved: await approveAllLessons(store, id, now) });
    if ((body.action === "approve" || body.action === "reject") && typeof body.subsectionId === "string") {
      const r = await decideLesson(store, id, body.subsectionId, body.action, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

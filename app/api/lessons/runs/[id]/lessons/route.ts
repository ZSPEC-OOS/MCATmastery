import { NextRequest, NextResponse } from "next/server";
import { approveAllLessons, controlLessons, decideLesson, startLessons } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// "start": develop lessons for the whole run (switches automatic lessons on) or, with topicIds, just those topics.
// "pause" / "resume" / "stop" control lesson work only. "approve" / "reject" (with topicId) and "approve_all"
// are the human review decisions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; topicId?: string; topicIds?: unknown };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "start") {
      const topicIds = Array.isArray(body.topicIds) ? body.topicIds.filter((x): x is string => typeof x === "string") : undefined;
      const r = await startLessons(store, id, now, topicIds);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "pause" || body.action === "resume" || body.action === "stop") {
      const r = await controlLessons(store, id, body.action);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "approve_all") return NextResponse.json({ approved: await approveAllLessons(store, id, now) });
    if ((body.action === "approve" || body.action === "reject") && typeof body.topicId === "string") {
      const r = await decideLesson(store, id, body.topicId, body.action, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getProgress } from "../../../../../lib/lessons/engine";
import { assembleLessons, isLessonStage } from "../../../../../lib/lessons/types";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../lib/lessons/runtime";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const { store } = getDeps();
    const run = await store.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const [topics, tasks, parts, reviews, aiReviews, progress] = await Promise.all([store.listTopics(id), store.listTasks(id), store.listParts(id), store.listReviews(id), store.listAiReviews(id), getProgress(store, id)]);
    return NextResponse.json({
      run: { ...run, sourceText: undefined },
      topics: topics.sort((a, b) => a.number - b.number),
      lessons: assembleLessons(run, topics, parts, reviews, tasks, aiReviews),
      failedTasks: tasks.filter((t) => t.status === "failed" && isLessonStage(t.stage)).map((t) => ({ id: t.id, stage: t.stage, targetId: t.targetId, error: t.error })),
      // Steps that failed and are waiting to be retried: their latest error, so the page can say what is going wrong.
      retrying: tasks.filter((t) => t.status === "queued" && t.error && isLessonStage(t.stage)).slice(0, 3).map((t) => ({ id: t.id, stage: t.stage, targetId: t.targetId, error: t.error })),
      progress,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    await getDeps().store.deleteRun(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

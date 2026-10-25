import { NextRequest, NextResponse } from "next/server";
import { bankBlockers, getProgress, topicSaveBlockers } from "../../../../../lib/codex/engine";
import { isCodexStage } from "../../../../../lib/codex/types";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../lib/codex/runtime";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const { store } = getDeps();
    const run = await store.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const [topics, questions, tasks, progress] = await Promise.all([store.listTopics(id), store.listQuestions(id), store.listTasks(id), getProgress(store, id)]);
    return NextResponse.json({
      run: { ...run, sourceText: undefined },
      topics: topics.sort((a, b) => a.number - b.number),
      questions: questions.filter((q) => q.current),
      failedTasks: tasks.filter((t) => t.status === "failed" && isCodexStage(t.stage)).map((t) => ({ id: t.id, stage: t.stage, targetId: t.targetId, error: t.error })),
      progress,
      bankBlockers: bankBlockers(run, progress),
      topicSaveBlockers: topicSaveBlockers(run, progress),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const { store } = getDeps();
    if ((await store.getRun(id))?.banked) return NextResponse.json({ error: "This run is saved to the database. Remove it from the database first." }, { status: 409 });
    await store.deleteRun(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

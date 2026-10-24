import { NextRequest, NextResponse } from "next/server";
import { buildCatalogRun, buildStudyQueue } from "../../../../lib/codex/study";
import type { StudyFocus, StudyMode } from "../../../../lib/codex/study";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../lib/codex/runtime";

// GET: which runs and sections have approved questions to study, with the learner's mastery so far.
export async function GET() {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { store } = getDeps();
    const runs = (await store.listRuns()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const catalog = [];
    for (const run of runs) {
      const [topics, questions, progress] = await Promise.all([store.listTopics(run.id), store.listQuestions(run.id), store.listProgress(user.id, run.id)]);
      const entry = buildCatalogRun(run, topics, questions, progress);
      if (entry) catalog.push(entry);
    }
    return NextResponse.json({ runs: catalog });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST: build a study session (approved questions only).
export async function POST(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const b = (await req.json()) as { runId?: string; sectionIds?: string[]; mode?: string; focus?: string; count?: number; shuffle?: boolean };
    if (!b.runId || !Array.isArray(b.sectionIds) || b.sectionIds.length === 0) return NextResponse.json({ error: "Choose a run and at least one section." }, { status: 400 });
    const mode: StudyMode = b.mode === "parents" || b.mode === "foundations" ? b.mode : "teach";
    const focus: StudyFocus = b.focus === "unmastered" || b.focus === "missed" ? b.focus : "all";
    const { store } = getDeps();
    const run = await store.getRun(b.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const [topics, questions, progress] = await Promise.all([store.listTopics(run.id), store.listQuestions(run.id), store.listProgress(user.id, run.id)]);
    const items = buildStudyQueue(run, topics, questions, progress, {
      sectionIds: b.sectionIds, mode, focus, count: Math.min(Math.max(Number(b.count) || 10, 1), 50), shuffle: b.shuffle === true,
    });
    return NextResponse.json({ subject: run.subject, items });
  } catch (e) {
    return errorResponse(e);
  }
}

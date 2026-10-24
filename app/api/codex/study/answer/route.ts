import { NextRequest, NextResponse } from "next/server";
import { gradeAndRecord } from "../../../../../lib/codex/study";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../lib/codex/runtime";

// Grades an answer on the server and updates the learner's progress (streak, mastery).
export async function POST(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const b = (await req.json()) as { runId?: string; questionId?: string; answer?: string };
    if (!b.runId || !b.questionId || !b.answer) return NextResponse.json({ error: "runId, questionId and answer are required" }, { status: 400 });
    const r = await gradeAndRecord(getDeps().store, { userId: user.id, runId: b.runId, questionId: b.questionId, answer: b.answer, now: new Date() });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

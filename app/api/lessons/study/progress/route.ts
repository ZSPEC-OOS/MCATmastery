import { NextRequest, NextResponse } from "next/server";
import { readingId } from "../../../../../lib/lessons/types";
import { getStudyLesson } from "../../../../../lib/lessons/study";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../lib/lessons/runtime";

// POST {runId, subsectionId, readParts?, lastPart?} → saves this learner's place and which parts they have read.
export async function POST(req: NextRequest) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const body = (await req.json()) as { runId?: string; subsectionId?: string; readParts?: unknown; lastPart?: unknown };
    if (typeof body.runId !== "string" || typeof body.subsectionId !== "string") return NextResponse.json({ error: "runId and subsectionId are required" }, { status: 400 });
    const { store } = getDeps();
    const study = await getStudyLesson(store, user.id, body.runId, body.subsectionId);
    if (!study) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    const valid = new Set(study.lesson.topicIds);
    const readParts = Array.isArray(body.readParts) ? [...new Set(body.readParts.filter((x): x is string => typeof x === "string" && valid.has(x)))] : (study.reading?.readParts ?? []);
    const lastPart = typeof body.lastPart === "string" && valid.has(body.lastPart) ? body.lastPart : study.reading?.lastPart;
    await store.putReading({
      id: readingId(user.id, body.runId, body.subsectionId), userId: user.id, runId: body.runId, subsectionId: body.subsectionId,
      readParts, ...(lastPart ? { lastPart } : {}), updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, readParts: readParts.length });
  } catch (e) {
    return errorResponse(e);
  }
}

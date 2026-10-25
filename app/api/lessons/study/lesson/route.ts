import { NextRequest, NextResponse } from "next/server";
import { getStudyLesson } from "../../../../../lib/lessons/study";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../lib/lessons/runtime";

// GET ?runId=&subsectionId= → one approved lesson for the reader, with this learner's progress.
export async function GET(req: NextRequest) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const runId = req.nextUrl.searchParams.get("runId");
    const subsectionId = req.nextUrl.searchParams.get("subsectionId");
    if (!runId || !subsectionId) return NextResponse.json({ error: "runId and subsectionId are required" }, { status: 400 });
    const lesson = await getStudyLesson(getDeps().store, user.id, runId, subsectionId);
    if (!lesson) return NextResponse.json({ error: "This lesson is not available to study. It must be approved." }, { status: 404 });
    return NextResponse.json(lesson);
  } catch (e) {
    return errorResponse(e);
  }
}

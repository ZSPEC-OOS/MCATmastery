import { NextResponse } from "next/server";
import { buildLibrary } from "../../../../lib/lessons/study";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../lib/lessons/runtime";

// The study library: every approved lesson, with this learner's reading progress.
export async function GET() {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    return NextResponse.json(await buildLibrary(getDeps().store, user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

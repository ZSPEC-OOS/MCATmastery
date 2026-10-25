import { NextRequest, NextResponse } from "next/server";
import { advance } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// One call = one task (one or a few model calls). The Lessons page calls this in a loop while a run is active.
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    return NextResponse.json(await advance(getDeps(), id));
  } catch (e) {
    return errorResponse(e);
  }
}

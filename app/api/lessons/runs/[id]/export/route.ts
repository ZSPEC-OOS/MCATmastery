import { NextRequest, NextResponse } from "next/server";
import { buildExport } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// GET ?approved=1 → only approved lessons (a person approved, or the AI passed). ?lessons=MS-1-SS-1,MS-1-SS-2 → just those.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const { store } = getDeps();
    const run = await store.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const approvedOnly = req.nextUrl.searchParams.get("approved") === "1";
    const now = new Date();
    const picked = req.nextUrl.searchParams.get("lessons");   // comma-separated lesson (subsection) ids; absent = all
    const only = picked ? picked.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const doc = buildExport(run, await store.listTopics(id), await store.listParts(id), await store.listReviews(id), await store.listAiReviews(id), { approvedOnly, now, only });
    const name = `${run.subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-lessons-${only ? "selected" : approvedOnly ? "approved" : "all"}-${now.toISOString().slice(0, 19).replace(/\D/g, "")}.json`;
    return new NextResponse(JSON.stringify(doc, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    return errorResponse(e);
  }
}

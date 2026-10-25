import { NextRequest, NextResponse } from "next/server";
import { buildExport } from "../../../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../../../lib/lessons/runtime";

// GET ?approved=1 → only human-approved lessons.
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
    const doc = buildExport(run, await store.listTopics(id), await store.listParts(id), await store.listReviews(id), await store.listAiReviews(id), { approvedOnly, now });
    const name = `${run.subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-lessons-${approvedOnly ? "approved" : "all"}-${now.toISOString().slice(0, 19).replace(/\D/g, "")}.json`;
    return new NextResponse(JSON.stringify(doc, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    return errorResponse(e);
  }
}

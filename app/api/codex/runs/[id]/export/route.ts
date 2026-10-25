import { NextRequest, NextResponse } from "next/server";
import { buildExport } from "../../../../../../lib/codex/engine";
import { saveExportToStorage } from "../../../../../../lib/codex/store";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// GET ?approved=1 → only human-approved questions.  GET ?save=1 → also store the file in Firebase Storage under codex/.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const { store } = getDeps();
    const run = await store.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const approvedOnly = req.nextUrl.searchParams.get("approved") === "1";
    const now = new Date();
    const doc = buildExport(run, await store.listTopics(id), await store.listQuestions(id), { approvedOnly, now });
    const json = JSON.stringify(doc, null, 2);
    const name = `${run.subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${approvedOnly ? "approved" : "all"}-${now.toISOString().slice(0, 19).replace(/\D/g, "")}.json`;

    if (req.nextUrl.searchParams.get("save") === "1") {
      const saved = await saveExportToStorage(`codex/exports/${id}/${name}`, json);
      return NextResponse.json({ saved });
    }
    return new NextResponse(json, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    return errorResponse(e);
  }
}

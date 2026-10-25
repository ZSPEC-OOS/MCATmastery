import { NextRequest, NextResponse } from "next/server";
import { decide } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// Human decisions. AI review is advisory: only a person moves a question to "approved".
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; questionId?: string; override?: boolean };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "approve_passed") {
      if ((await store.getRun(id))?.banked) return NextResponse.json({ error: "This run is saved to the database and locked." }, { status: 409 });
      const qs = (await store.listQuestions(id)).filter((q) => q.current && q.status === "auto_passed");
      for (const q of qs) await decide(store, id, q.id, "approve", { now });
      return NextResponse.json({ approved: qs.length });
    }
    if ((body.action === "approve" || body.action === "reject") && typeof body.questionId === "string") {
      const r = await decide(store, id, body.questionId, body.action, { override: body.override === true, now });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

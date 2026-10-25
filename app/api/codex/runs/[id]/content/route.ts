import { NextRequest, NextResponse } from "next/server";
import { decideContent, startContent } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// Reading lessons. action "start": switch lessons on for this run and queue every split topic.
// "approve" / "reject" (with topicId) and "approve_all" are the human review decisions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; topicId?: string };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "start") {
      const r = await startContent(store, id, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "approve_all") {
      const drafts = (await store.listContent(id)).filter((c) => c.status === "draft");
      let approved = 0;
      for (const c of drafts) if ((await decideContent(store, id, c.topicId, "approve", now)).ok) approved++;
      return NextResponse.json({ approved });
    }
    if ((body.action === "approve" || body.action === "reject") && typeof body.topicId === "string") {
      const r = await decideContent(store, id, body.topicId, body.action, now);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

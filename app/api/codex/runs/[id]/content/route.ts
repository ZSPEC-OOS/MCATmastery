import { NextRequest, NextResponse } from "next/server";
import { controlContent, decideContent, startContent } from "../../../../../../lib/codex/engine";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../../lib/codex/runtime";

// Reading lessons. "start": develop lessons for the whole run (switches them on) or, with topicIds, just those topics.
// "pause" / "resume" / "stop" control lesson work only.
// "approve" / "reject" (with topicId) and "approve_all" are the human review decisions.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { id } = await params;
    const body = (await req.json()) as { action?: string; topicId?: string; topicIds?: unknown };
    const { store } = getDeps();
    const now = new Date();

    if (body.action === "start") {
      const topicIds = Array.isArray(body.topicIds) ? body.topicIds.filter((x): x is string => typeof x === "string") : undefined;
      const r = await startContent(store, id, now, topicIds);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "pause" || body.action === "resume" || body.action === "stop") {
      const r = await controlContent(store, id, body.action);
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

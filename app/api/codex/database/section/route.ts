import { NextRequest, NextResponse } from "next/server";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../../lib/codex/runtime";
import { getStore as getLessonsStore } from "../../../../../lib/lessons/store";

// GET ?subject=Biology&number=1 → one saved major section: its subsections and every saved topic, with each
// subsection's lesson status. Read-only.
export async function GET(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const subject = req.nextUrl.searchParams.get("subject");
    const number = Number(req.nextUrl.searchParams.get("number"));
    if (!subject || !Number.isInteger(number)) return NextResponse.json({ error: "subject and number are required" }, { status: 400 });

    const { bank } = getDeps();
    const section = (await bank.listSections(subject)).find((s) => s.number === number);
    if (!section) return NextResponse.json({ error: "This section is not saved in the topic database." }, { status: 404 });
    const topics = await bank.listTopics(subject, [number]);

    const lessons = getLessonsStore();
    const approved = new Set<string>();
    for (const r of (await lessons.listRuns()).filter((x) => x.subject === subject)) {
      for (const rv of await lessons.listReviews(r.id)) if (rv.status === "approved") approved.add(rv.subsectionId);
    }

    return NextResponse.json({
      section: { id: section.sectionId, title: section.title, coverageSummary: section.coverageSummary, declaredGaps: section.declaredGaps, topicCount: section.topicCount, savedAt: section.savedAt },
      subsections: section.subsections.map((ss) => ({
        id: ss.id, title: ss.title, scope: ss.scope, lessonApproved: approved.has(ss.id),
        topics: topics.filter((t) => t.subsectionId === ss.id).map((t) => ({ id: t.topicId, title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, groupTitle: t.groupTitle ?? null })),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

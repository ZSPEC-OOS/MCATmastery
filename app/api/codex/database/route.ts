import { NextRequest, NextResponse } from "next/server";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../lib/codex/runtime";
import { SUBCODEX_PRESETS } from "../../../../lib/codex/presets";
import { getStore as getLessonsStore } from "../../../../lib/lessons/store";

// GET ?subject=Biology → per major section: topics saved, questions saved, lessons (subsections) approved, and whether it is complete.
// Read-only view across the topic database, the Codex question database and the Lessons app.
export async function GET(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const subject = req.nextUrl.searchParams.get("subject");
    const preset = SUBCODEX_PRESETS.find((p) => p.subject === subject);
    if (!preset) return NextResponse.json({ error: "Unknown subject" }, { status: 400 });

    const { store, bank } = getDeps();
    const [saved, codexRuns, lessonRuns] = await Promise.all([bank.listSections(preset.subject), store.listRuns(), getLessonsStore().listRuns()]);

    const topicCount = new Map(saved.map((s) => [s.number, s.topicCount]));
    const questionsSaved = new Set<number>();
    for (const r of codexRuns) if (r.banked && r.subject === preset.subject) for (const s of r.sections) if (s.selected) questionsSaved.add(s.number);

    // A lesson is a subsection (MS-1-SS-2); it counts once a person has approved the whole lesson in any lessons run.
    const approved = new Map<number, Set<string>>();   // section number → approved lesson (subsection) ids
    const lessons = getLessonsStore();
    for (const r of lessonRuns.filter((x) => x.subject === preset.subject)) {
      for (const rv of await lessons.listReviews(r.id)) {
        const n = Number(/^MS-(\d+)-SS-/.exec(rv.subsectionId)?.[1]);
        if (Number.isInteger(n) && rv.status === "approved") (approved.get(n) ?? approved.set(n, new Set()).get(n)!).add(rv.subsectionId);
      }
    }

    const lessonTotal = new Map(saved.map((s) => [s.number, s.subsections.length]));
    const sections = preset.sections.map((title, i) => {
      const number = i + 1;
      const topics = topicCount.get(number) ?? 0;
      const total = lessonTotal.get(number) ?? 0;
      const lessonsApproved = approved.get(number)?.size ?? 0;
      return {
        number, id: `MS-${number}`, title,
        topics, topicsSaved: topics > 0,
        questionsSaved: questionsSaved.has(number),
        lessonsTotal: total, lessonsApproved,
        complete: topics > 0 && questionsSaved.has(number) && total > 0 && lessonsApproved >= total,
      };
    });
    return NextResponse.json({ subject: preset.subject, sections, subjects: SUBCODEX_PRESETS.map((p) => p.subject) });
  } catch (e) {
    return errorResponse(e);
  }
}

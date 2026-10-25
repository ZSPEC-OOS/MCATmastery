import { NextRequest, NextResponse } from "next/server";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../lib/codex/runtime";
import { SUBCODEX_PRESETS } from "../../../../lib/codex/presets";
import { getStore as getLessonsStore } from "../../../../lib/lessons/store";

// GET ?subject=Biology → per major section: topics saved, questions saved, lessons approved, and whether it is complete.
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

    const approved = new Map<number, Set<string>>();   // section number → topic ids with an approved lesson
    const written = new Map<number, Set<string>>();
    const lessons = getLessonsStore();
    for (const r of lessonRuns.filter((x) => x.subject === preset.subject)) {
      for (const l of await lessons.listLessons(r.id)) {
        const n = Number(/^MS-(\d+)-/.exec(l.topicId)?.[1]);
        if (!Number.isInteger(n)) continue;
        if (l.status !== "rejected") (written.get(n) ?? written.set(n, new Set()).get(n)!).add(l.topicId);
        if (l.status === "approved") (approved.get(n) ?? approved.set(n, new Set()).get(n)!).add(l.topicId);
      }
    }

    const sections = preset.sections.map((title, i) => {
      const number = i + 1;
      const topics = topicCount.get(number) ?? 0;
      const lessonsApproved = approved.get(number)?.size ?? 0;
      return {
        number, id: `MS-${number}`, title,
        topics, topicsSaved: topics > 0,
        questionsSaved: questionsSaved.has(number),
        lessonsWritten: written.get(number)?.size ?? 0, lessonsApproved,
        complete: topics > 0 && questionsSaved.has(number) && lessonsApproved >= topics,
      };
    });
    return NextResponse.json({ subject: preset.subject, sections, subjects: SUBCODEX_PRESETS.map((p) => p.subject) });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createRun, getProgress } from "../../../../lib/lessons/engine";
import { errorResponse, getDeps, isDenied, requireLessonsUser } from "../../../../lib/lessons/runtime";

export async function GET() {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const { store } = getDeps();
    const runs = (await store.listRuns()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const withProgress = await Promise.all(
      runs.map(async (r) => ({
        id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt,
        sections: r.sections.filter((s) => s.selected).length,
        progress: await getProgress(store, r.id),
      })),
    );
    return NextResponse.json({ runs: withProgress });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireLessonsUser();
  if (isDenied(user)) return user;
  try {
    const body = (await req.json()) as { sourceText?: string; sectionNumbers?: number[]; autoLessons?: boolean; subsectionIds?: unknown };
    if (typeof body.sourceText !== "string" || !body.sourceText.trim()) return NextResponse.json({ error: "sourceText is required" }, { status: 400 });
    const sectionNumbers = Array.isArray(body.sectionNumbers) ? body.sectionNumbers.filter((n) => Number.isInteger(n)) : undefined;
    const result = await createRun(getDeps(), { sourceText: body.sourceText, sectionNumbers, autoLessons: body.autoLessons !== false, subsectionIds: Array.isArray(body.subsectionIds) ? body.subsectionIds.filter((x): x is string => typeof x === "string") : undefined, createdBy: user.id });
    if (!result.ok) return NextResponse.json({ error: "Invalid Sub-Codex", issues: result.errors }, { status: 400 });
    return NextResponse.json({ run: { id: result.run.id } });
  } catch (e) {
    return errorResponse(e);
  }
}

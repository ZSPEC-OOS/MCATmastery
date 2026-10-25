import { NextRequest, NextResponse } from "next/server";
import { createRun, getProgress } from "../../../../lib/codex/engine";
import type { CodexDepth } from "../../../../lib/codex/types";
import { errorResponse, getDeps, isDenied, requireCodexUser } from "../../../../lib/codex/runtime";

const DEPTHS: CodexDepth[] = ["topics", "parents", "atomics", "verified"];

export async function GET() {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const { store } = getDeps();
    const runs = (await store.listRuns()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const withProgress = await Promise.all(
      runs.map(async (r) => ({
        id: r.id, subject: r.subject, depth: r.depth, status: r.status, createdAt: r.createdAt,
        sections: r.sections.filter((s) => s.selected).length,
        banked: r.banked ?? null,
        topicsSaved: r.topicsSaved ?? null,
        bankedSections: r.banked ? r.sections.filter((s) => s.selected).map((s) => s.number) : [],
        progress: await getProgress(store, r.id),
      })),
    );
    return NextResponse.json({ runs: withProgress });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireCodexUser();
  if (isDenied(user)) return user;
  try {
    const body = (await req.json()) as { sourceText?: string; depth?: string; sectionNumbers?: number[] };
    if (typeof body.sourceText !== "string" || !body.sourceText.trim()) return NextResponse.json({ error: "sourceText is required" }, { status: 400 });
    const depth = DEPTHS.includes(body.depth as CodexDepth) ? (body.depth as CodexDepth) : "verified";
    const sectionNumbers = Array.isArray(body.sectionNumbers) ? body.sectionNumbers.filter((n) => Number.isInteger(n)) : undefined;
    const result = await createRun(getDeps(), { sourceText: body.sourceText, depth, sectionNumbers, createdBy: user.id });
    if (!result.ok) return NextResponse.json({ error: "Invalid Sub-Codex", issues: result.errors }, { status: 400 });
    return NextResponse.json({ run: { id: result.run.id } });
  } catch (e) {
    return errorResponse(e);
  }
}

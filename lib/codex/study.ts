// Codex study mode: turns approved questions into a teaching session. Only questions a person approved are
// ever shown. Progress (attempts, streak, mastery) is per learner and stored separately from the questions.

import type { CodexStore } from "./store";
import { MASTERY_STREAK } from "./types";
import type { CodexProgress, CodexQuestion, CodexRun, CodexTopic, Option } from "./types";

export type StudyMode = "teach" | "parents" | "foundations";
export type StudyFocus = "all" | "unmastered" | "missed";

/** A question as the study page needs it (the page grades locally; the server also grades and records). */
export interface StudyQuestion {
  id: string;               // question document id (qid + revision)
  qid: string;
  kind: "parent" | "atomic";
  passage?: string;
  stem: string;
  options: Option[];
  correctKey: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: string;
  purpose?: string;
}

export interface StudyTopic {
  topicId: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  subsectionTitle: string;
  parent: StudyQuestion | null;
  atoms: StudyQuestion[];
  mastered: boolean;
}

export const isMastered = (p: CodexProgress | undefined) => !!p && p.streak >= MASTERY_STREAK;

const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const view = (q: CodexQuestion): StudyQuestion => ({
  id: q.id, qid: q.qid, kind: q.kind, ...(q.content.passage ? { passage: q.content.passage } : {}),
  stem: q.content.stem, options: q.content.options, correctKey: q.content.correctKey,
  explanation: q.content.explanation, difficulty: q.content.difficulty, ...(q.content.purpose ? { purpose: q.content.purpose } : {}),
});

export interface CatalogRun {
  id: string;
  subject: string;
  createdAt: string;
  sections: { id: string; title: string; topics: number; approvedParents: number; approvedAtoms: number; masteredParents: number }[];
}

/** What can be studied in a run, and how far the learner has got. Runs with nothing approved are omitted. */
export function buildCatalogRun(run: CodexRun, topics: CodexTopic[], questions: CodexQuestion[], progress: CodexProgress[]): CatalogRun | null {
  const approved = questions.filter((q) => q.current && q.status === "approved");
  const byQid = new Map(progress.map((p) => [p.qid, p]));
  const sections = run.sections.filter((s) => s.selected).map((s) => {
    const mine = topics.filter((t) => t.sectionId === s.id);
    const parents = approved.filter((q) => q.kind === "parent" && mine.some((t) => t.id === q.qid));
    const atoms = approved.filter((q) => q.kind === "atomic" && mine.some((t) => t.id === q.parentId));
    return { id: s.id, title: s.title, topics: mine.length, approvedParents: parents.length, approvedAtoms: atoms.length, masteredParents: parents.filter((q) => isMastered(byQid.get(q.qid))).length };
  });
  if (!sections.some((s) => s.approvedParents + s.approvedAtoms > 0)) return null;
  return { id: run.id, subject: run.subject, createdAt: run.createdAt, sections };
}

export interface BuildOpts {
  sectionIds: string[];
  mode: StudyMode;
  focus: StudyFocus;
  count: number;            // topics per session
  shuffle: boolean;
  rand?: () => number;
}

/** Picks the topics for a session. Missed topics come first, then unseen, then already-mastered ones. */
export function buildStudyQueue(run: CodexRun, topics: CodexTopic[], questions: CodexQuestion[], progress: CodexProgress[], opts: BuildOpts): StudyTopic[] {
  const approved = questions.filter((q) => q.current && q.status === "approved");
  const byQid = new Map(progress.map((p) => [p.qid, p]));
  const sectionTitle = new Map(run.sections.map((s) => [s.id, s.title]));

  let items: (StudyTopic & { rank: number })[] = [];
  for (const t of topics.filter((x) => opts.sectionIds.includes(x.sectionId))) {
    const parent = approved.find((q) => q.kind === "parent" && q.qid === t.id) ?? null;
    const atoms = approved.filter((q) => q.kind === "atomic" && q.parentId === t.id).sort((a, b) => numeric(a.qid, b.qid));
    if (opts.mode === "foundations" ? atoms.length === 0 : !parent) continue;

    const pp = byQid.get(t.id);
    const missed = pp?.lastCorrect === false || atoms.some((a) => byQid.get(a.qid)?.lastCorrect === false);
    const mastered = isMastered(pp);
    if (opts.focus === "missed" && !missed) continue;
    if (opts.focus === "unmastered" && (mastered && !missed)) continue;

    items.push({
      topicId: t.id, title: t.title, sectionId: t.sectionId, sectionTitle: sectionTitle.get(t.sectionId) ?? t.sectionId, subsectionTitle: t.subsectionTitle,
      parent: parent && opts.mode !== "foundations" ? view(parent) : null,
      atoms: opts.mode === "parents" ? [] : atoms.map(view),
      mastered, rank: missed ? 0 : pp ? 2 : 1,
    });
  }

  const order = (a: { topicId: string }, b: { topicId: string }) => numeric(a.topicId, b.topicId);
  items.sort((a, b) => a.rank - b.rank || order(a, b));
  if (opts.shuffle) {
    const rand = opts.rand ?? Math.random;
    for (const rank of [0, 1, 2]) {
      const group = items.filter((i) => i.rank === rank);
      for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
      items = [...items.filter((i) => i.rank < rank), ...group, ...items.filter((i) => i.rank > rank)];
    }
  }
  return items.slice(0, Math.max(1, opts.count)).map(({ rank: _rank, ...t }) => { void _rank; return t; });
}

/** Grades on the server (the client is not trusted for what gets recorded) and updates the learner's progress. */
export async function gradeAndRecord(
  store: CodexStore, a: { userId: string; runId: string; questionId: string; answer: string; now: Date },
): Promise<{ ok: true; correct: boolean; streak: number; mastered: boolean } | { ok: false; error: string }> {
  const q = await store.getQuestion(a.runId, a.questionId);
  if (!q || q.status !== "approved") return { ok: false, error: "That question is not available for study." };
  const answer = a.answer.trim().toUpperCase();
  if (!["A", "B", "C", "D"].includes(answer)) return { ok: false, error: "Answer must be A, B, C or D." };
  const p = await store.recordAnswer({ userId: a.userId, runId: a.runId, qid: q.qid, correct: answer === q.content.correctKey, answer, now: a.now });
  return { ok: true, correct: p.lastCorrect, streak: p.streak, mastered: isMastered(p) };
}

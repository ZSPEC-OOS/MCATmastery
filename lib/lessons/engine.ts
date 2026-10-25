// MCAT Lessons pipeline engine.
//
//   Topic database (planned and split once, in Codex) → one lesson per subsection (MS-1-SS-2), written as one part per
//   split topic → AI check of each finished lesson, with parts sent back for correction when it finds errors →
//   optional human decision. Lessons only: no questions are ever written, and nothing here plans or splits.
//
// Nothing starts by itself. Creating a run (or adding lessons) only queues work; the Lessons page runs it when you
// press Start. There is no background worker: every unit of work is a persisted task, and `advance()` runs exactly
// one task per call. Everything is idempotent per task id. The Sub-Codex parser, the topic database and the model
// caller are borrowed from Codex; everything that writes or checks lessons lives here.

import type { LessonsStore } from "./store";
import { parseSubCodex } from "../codex/subcodex";
import { UnparseableOutput } from "../codex/engine";
import type { ModelCaller, ModelRole } from "../codex/engine";
import type { TopicBank } from "../topicbank";
import { checkLesson, checkLessonReview } from "./checks";
import { renderLessonPrompt, renderReviewPrompt } from "./prompts";
import { MAX_CORRECTION_ROUNDS, MAX_REPAIR_ROUNDS, MAX_TASK_ATTEMPTS, assembleLessons, docId, isApproved, isCarsSubject, isComplete, isLessonStage } from "./types";
import type { Finding, LessonAiReview, LessonPart, LessonReview, LessonStage, LessonTask, LessonTopic, LessonsRun, ReviewIssue } from "./types";

export interface Deps {
  store: LessonsStore;
  bank: TopicBank;
  model: ModelCaller;
  now?: () => Date;
}

/** The model kept producing output that failed validation; retrying the identical task would not help. */
export class ContentFailure extends Error {
  constructor(message: string, public findings: Finding[]) { super(message); }
}

const LEASE_MS = 6 * 60 * 1000;
const REVIEW_BATCH = 6;   // parts reviewed per AI call, so a long lesson never overruns one request
const iso = (d: Date) => d.toISOString();
const nowOf = (deps: Deps) => (deps.now ? deps.now() : new Date());

// ── Runs ────────────────────────────────────────────────────────────────────

export interface CreateRunInput {
  sourceText: string;
  /** Major-section numbers to include; empty or omitted = every saved section. */
  sectionNumbers?: number[];
  /** Lessons (subsections) to queue; omitted = every lesson of the chosen sections. Nothing runs until Start. */
  subsectionIds?: string[];
  createdBy: string;
}

/** A lessons run copies its sections and topics out of the topic database; only sections saved there can be built. */
export async function createRun(deps: Deps, input: CreateRunInput): Promise<{ ok: true; run: LessonsRun } | { ok: false; errors: ReturnType<typeof parseSubCodex>["errors"] }> {
  const parsed = parseSubCodex(input.sourceText);
  if (!parsed.ok || !parsed.subject) return { ok: false, errors: parsed.errors };
  const fail = (code: string, message: string) => ({ ok: false as const, errors: [{ line: null, code, message }] });

  const saved = new Map((await deps.bank.listSections(parsed.subject)).map((s) => [s.number, s]));
  const requested = input.sectionNumbers?.length ? input.sectionNumbers : [...saved.keys()];
  const missing = requested.filter((n) => !saved.has(n));
  if (missing.length > 0) return fail("NOT_SAVED", `MS-${missing.join(", MS-")} ${missing.length === 1 ? "is" : "are"} not in the topic database yet. In Codex, run Topics only for it and save it to the database first.`);
  if (requested.length === 0) return fail("NO_SELECTION", "No sections of this subject are saved in the topic database yet. In Codex, run Topics only and save it first.");

  const wanted = new Set(requested);
  const now = iso(nowOf(deps));
  const id = `run_${now.replace(/\D/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`;
  const run: LessonsRun = {
    id,
    subject: parsed.subject,
    sourceText: input.sourceText,
    status: "active",
    createdAt: now,
    createdBy: input.createdBy,
    sections: parsed.sections.map((s) => {
      const b = saved.get(s.number);
      return b && wanted.has(s.number)
        ? { number: s.number, id: s.id, title: s.title, selected: true, planned: true, coverageSummary: b.coverageSummary, declaredGaps: b.declaredGaps, subsections: b.subsections }
        : { number: s.number, id: s.id, title: s.title, selected: false, planned: false, subsections: [] };
    }),
  };

  const topics: LessonTopic[] = (await deps.bank.listTopics(parsed.subject, [...wanted])).map((t) => ({
    id: t.topicId, runId: run.id, sectionId: t.sectionId, subsectionId: t.subsectionId, subsectionTitle: t.subsectionTitle, number: t.number,
    title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, ...(t.groupTitle ? { groupTitle: t.groupTitle } : {}),
  }));
  const chosen = input.subsectionIds ? new Set(input.subsectionIds) : null;

  await deps.store.createRun(run);
  await deps.store.putTopics(topics);
  await deps.store.putTasks(topics.filter((t) => !chosen || chosen.has(t.subsectionId)).map((t) => partTask(run.id, t.id, now)));
  return { ok: true, run };
}

function partTask(runId: string, topicId: string, now: string, extra: Partial<LessonTask> = {}, suffix = ""): LessonTask {
  return { id: `lesson__${topicId}${suffix}`, runId, stage: "lesson", targetId: topicId, status: "queued", attempts: 0, createdAt: now, updatedAt: now, ...extra };
}

function reviewTask(runId: string, subsectionId: string, now: string, round: number): LessonTask {
  return { id: `review__${subsectionId}`, runId, stage: "review", targetId: subsectionId, status: "queued", attempts: 0, round, createdAt: now, updatedAt: now };
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface Progress {
  /** Tasks: one per part written, one per AI check. */
  tasks: Record<LessonStage, { queued: number; running: number; done: number; failed: number }>;
  active: boolean;       // work remains that advance() can do now (queued/running and not paused)
  held: number;          // queued tasks waiting because the run is paused
  failed: number;
  topics: number;
  /** Lessons are subsections. Counts cover only the lessons chosen for this run. */
  lessons: {
    inRun: number; complete: number; writing: number; checking: number;
    aiApproved: number; flagged: number; approved: number; rejected: number;
    partsDone: number; partsTotal: number;
  };
}

export async function getProgress(store: LessonsStore, runId: string): Promise<Progress> {
  const [allTasks, topics, parts, reviews, aiReviews, run] = await Promise.all([store.listTasks(runId), store.listTopics(runId), store.listParts(runId), store.listReviews(runId), store.listAiReviews(runId), store.getRun(runId)]);
  const tasks = allTasks.filter((t) => isLessonStage(t.stage));
  const empty = () => ({ queued: 0, running: 0, done: 0, failed: 0 });
  const byStage: Progress["tasks"] = { lesson: empty(), review: empty() };
  for (const t of tasks) byStage[t.stage][t.status]++;
  const paused = run?.lessonsPaused === true;
  const ready = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const lessons = (run ? assembleLessons(run, topics, parts, reviews, tasks, aiReviews) : []).filter((l) => l.inRun);
  const count = (f: (s: string) => boolean) => lessons.filter((l) => f(l.status)).length;
  return {
    tasks: byStage,
    active: ready.some((t) => !(paused && t.status === "queued")),
    held: paused ? ready.filter((t) => t.status === "queued").length : 0,
    failed: tasks.filter((t) => t.status === "failed").length,
    topics: topics.length,
    lessons: {
      inRun: lessons.length,
      complete: lessons.filter((l) => isComplete(l.status)).length,
      writing: count((s) => s === "writing"),
      checking: count((s) => s === "checking"),
      aiApproved: count((s) => s === "ai_approved"),
      flagged: count((s) => s === "flagged"),
      approved: count((s) => s === "approved"),
      rejected: count((s) => s === "rejected"),
      partsDone: lessons.reduce((n, l) => n + l.parts.filter((p) => p.part).length, 0),
      partsTotal: lessons.reduce((n, l) => n + l.parts.length, 0),
    },
  };
}

export async function retryFailed(store: LessonsStore, runId: string, now: Date): Promise<number> {
  const failed = (await store.listTasks(runId)).filter((t) => t.status === "failed" && isLessonStage(t.stage));
  for (const t of failed) await store.updateTask(runId, t.id, { status: "queued", attempts: 0, error: undefined, notBefore: undefined, leaseUntil: undefined, updatedAt: iso(now) });
  return failed.length;
}

// ── advance: run one task ───────────────────────────────────────────────────

export interface AdvanceResult {
  ran: { id: string; stage: LessonStage; targetId: string; outcome: "done" | "retry" | "failed" } | null;
  error?: string;
  progress: Progress;
}

export async function advance(deps: Deps, runId: string): Promise<AdvanceResult> {
  const { store } = deps;
  const run = await store.getRun(runId);
  if (!run) throw new Error("Run not found");
  if (run.status === "cancelled" || run.lessonsPaused) return { ran: null, progress: await getProgress(store, runId) };

  let task = await store.claimNextTask(runId, nowOf(deps), LEASE_MS);
  if (!task) {
    // Nothing queued: make sure every finished lesson has its AI check scheduled, then look once more.
    if ((await ensureChecks(store, run, nowOf(deps))) > 0) task = await store.claimNextTask(runId, nowOf(deps), LEASE_MS);
    if (!task) return { ran: null, progress: await getProgress(store, runId) };
  }

  try {
    if (task.stage === "lesson") await runPart(deps, run, task);
    else await runReview(deps, run, task);
    await store.updateTask(runId, task.id, { status: "done", error: undefined, leaseUntil: undefined, updatedAt: iso(nowOf(deps)) });
    // Marked done first, so when the last two parts of a lesson finish together, whichever finishes second sees both done.
    if (task.stage === "lesson") await maybeQueueCheck(store, runId, (await store.listTopics(runId)).find((t) => t.id === task.targetId)?.subsectionId, nowOf(deps));
    return { ran: { id: task.id, stage: task.stage, targetId: task.targetId, outcome: "done" }, progress: await getProgress(store, runId) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const permanent = e instanceof ContentFailure;
    const exhausted = task.attempts >= MAX_TASK_ATTEMPTS;
    const now = nowOf(deps);
    if (permanent || exhausted) {
      await store.updateTask(runId, task.id, { status: "failed", error: message.slice(0, 600), leaseUntil: undefined, updatedAt: iso(now) });
      return { ran: { id: task.id, stage: task.stage, targetId: task.targetId, outcome: "failed" }, error: message, progress: await getProgress(store, runId) };
    }
    const backoff = 20_000 * 2 ** (task.attempts - 1);
    await store.updateTask(runId, task.id, { status: "queued", error: message.slice(0, 600), leaseUntil: undefined, notBefore: iso(new Date(now.getTime() + backoff)), updatedAt: iso(now) });
    return { ran: { id: task.id, stage: task.stage, targetId: task.targetId, outcome: "retry" }, error: message, progress: await getProgress(store, runId) };
  }
}

// ── Model helper ────────────────────────────────────────────────────────────

interface Rendered { system: string; prompt: string }

/**
 * Generate → validate → on blocking findings return them to the model for up to MAX_REPAIR_ROUNDS rounds.
 * Nothing is returned (or stored) unless validation passes.
 */
async function generateValidated<T>(
  deps: Deps,
  opts: { role: ModelRole; maxTokens: number; render: (repair?: { round: number; previous: unknown; findings: Finding[] }) => Rendered; validate: (json: unknown) => { ok: boolean; value?: T; findings: Finding[] } },
): Promise<{ value: T; warnings: Finding[]; model: string }> {
  let repair: { round: number; previous: unknown; findings: Finding[] } | undefined;
  let last: Finding[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const r = opts.render(repair);
    let res: { json: unknown; model: string };
    try {
      res = await deps.model({ role: opts.role, system: r.system, prompt: r.prompt, maxTokens: opts.maxTokens });
    } catch (e) {
      if (!(e instanceof UnparseableOutput)) throw e;
      last = [{ code: "NOT_JSON", severity: "error", message: "The reply was not valid JSON. Return one JSON object only." }];
      repair = { round: round + 1, previous: "(unparseable output)", findings: last };
      continue;
    }
    const v = opts.validate(res.json);
    if (v.ok && v.value !== undefined) return { value: v.value, warnings: v.findings.filter((f) => f.severity === "warning"), model: res.model };
    last = v.findings.filter((f) => f.severity === "error");
    repair = { round: round + 1, previous: res.json, findings: last };
  }
  throw new ContentFailure(`Validation still failing after ${MAX_REPAIR_ROUNDS} repair rounds: ${last.slice(0, 3).map((f) => f.message).join(" | ")}`, last);
}

// ── Lesson parts ────────────────────────────────────────────────────────────

/** Writes (or, when the AI check sent it back, rewrites) one part of its subsection's lesson. */
async function runPart(deps: Deps, run: LessonsRun, task: LessonTask) {
  const topics = await deps.store.listTopics(run.id);
  const topic = topics.find((t) => t.id === task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const subsection = section.subsections.find((s) => s.id === topic.subsectionId);
  const inLesson = topics.filter((t) => t.subsectionId === topic.subsectionId).sort((a, b) => a.number - b.number);
  const siblingTitles = inLesson.filter((t) => t.id !== topic.id).map((t) => t.title);

  const { value, warnings, model } = await generateValidated(deps, {
    role: "generation",
    maxTokens: 8000,
    render: (repair) =>
      renderLessonPrompt({
        cars: isCarsSubject(run.subject),
        subject: run.subject,
        topic: { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget },
        siblingTitles,
        lesson: { title: `${topic.subsectionId} · ${subsection?.title ?? topic.subsectionTitle}`, scope: subsection?.scope ?? "", part: inLesson.findIndex((t) => t.id === topic.id) + 1, of: inLesson.length },
        ...(task.correction ? { correction: task.correction } : {}),
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkLesson(json),
  });

  const prior = (await deps.store.listParts(run.id)).find((p) => p.topicId === topic.id);
  await deps.store.putPart({
    id: docId(run.id, topic.id), runId: run.id, topicId: topic.id, subsectionId: topic.subsectionId,
    content: value, findings: warnings, model, createdAt: iso(nowOf(deps)),
    ...(task.correction ? { corrections: (prior?.corrections ?? 0) + 1 } : {}),
  });
  // A part that changed after a person decided on the lesson puts it back to "awaiting a decision".
  await deps.store.deleteReview(run.id, topic.subsectionId);
}

// ── AI check of a finished lesson ───────────────────────────────────────────

/** Queues the AI check of a lesson once every part exists and none is still being written. Never overwrites a check already scheduled. */
async function maybeQueueCheck(store: LessonsStore, runId: string, subsectionId: string | undefined, now: Date) {
  if (!subsectionId) return;
  const [topics, parts, tasks] = await Promise.all([store.listTopics(runId), store.listParts(runId), store.listTasks(runId)]);
  const mine = topics.filter((t) => t.subsectionId === subsectionId);
  if (mine.length === 0 || !mine.every((t) => parts.some((p) => p.topicId === t.id))) return;
  const ids = new Set(mine.map((t) => t.id));
  if (tasks.some((t) => t.stage === "lesson" && ids.has(t.targetId) && (t.status === "queued" || t.status === "running"))) return;
  const existing = tasks.find((t) => t.stage === "review" && t.targetId === subsectionId);
  if (existing && (existing.status === "queued" || existing.status === "running" || existing.status === "failed")) return;
  await store.putTasks([reviewTask(runId, subsectionId, iso(now), 0)]);
}

/** Schedules a check for every finished lesson that has none and no decision. Returns how many were queued. */
async function ensureChecks(store: LessonsStore, run: LessonsRun, now: Date): Promise<number> {
  const [topics, parts, tasks, reviews, aiReviews] = await Promise.all([store.listTopics(run.id), store.listParts(run.id), store.listTasks(run.id), store.listReviews(run.id), store.listAiReviews(run.id)]);
  let n = 0;
  for (const l of assembleLessons(run, topics, parts, reviews, tasks, aiReviews)) {
    if (l.status !== "checking") continue;
    const existing = tasks.find((t) => t.stage === "review" && t.targetId === l.subsectionId);
    if (existing && existing.status !== "done") continue;
    await store.putTasks([reviewTask(run.id, l.subsectionId, iso(now), 0)]);
    n++;
  }
  return n;
}

const flatten = (p: LessonPart) => p.content;

/** Checks a whole lesson. Passes it, or sends the parts with errors back for correction, or flags it for a person. */
async function runReview(deps: Deps, run: LessonsRun, task: LessonTask) {
  const { store } = deps;
  const subsectionId = task.targetId;
  const [topicsAll, parts] = await Promise.all([store.listTopics(run.id), store.listParts(run.id)]);
  const topics = topicsAll.filter((t) => t.subsectionId === subsectionId).sort((a, b) => a.number - b.number);
  const rows = topics.map((t) => ({ topic: t, part: parts.find((p) => p.topicId === t.id) }));
  if (rows.length === 0 || rows.some((r) => !r.part)) return; // not finished writing; a later part completion schedules the check again

  const section = run.sections.find((s) => s.id === topics[0].sectionId)!;
  const subsection = section.subsections.find((s) => s.id === subsectionId);
  const lesson = { title: `${subsectionId} · ${subsection?.title ?? topics[0].subsectionTitle}`, scope: subsection?.scope ?? "" };
  const allParts = rows.map((r) => ({ id: r.topic.id, topic: r.topic.title }));

  // Review in batches so a long lesson never overruns one request.
  const issues: ReviewIssue[] = [];
  let model: string | undefined;
  for (let i = 0; i < rows.length; i += REVIEW_BATCH) {
    const batch = rows.slice(i, i + REVIEW_BATCH);
    const r = await generateValidated(deps, {
      role: "audit",
      maxTokens: 6000,
      render: (repair) => {
        const base = renderReviewPrompt({
          subject: run.subject, lesson, allParts,
          review: batch.map((b) => ({ id: b.topic.id, topic: b.topic.title, scope: b.topic.scope, content: flatten(b.part!) })),
        });
        return repair ? { system: base.system, prompt: `${base.prompt}\nYour previous reply was invalid: ${repair.findings.map((f) => f.message).join("; ")}. Return the corrected JSON object only.` } : base;
      },
      validate: (json) => {
        const v = checkLessonReview(json, batch.map((b) => b.topic.id));
        return { ok: v.ok, value: v.value, findings: v.findings };
      },
    });
    issues.push(...r.value.issues);
    model = r.model;
  }

  const round = task.round ?? 0;
  const errors = issues.filter((i) => i.severity === "error");
  const at = iso(nowOf(deps));
  const record = (verdict: "pass" | "fail"): LessonAiReview => ({ id: docId(run.id, subsectionId), runId: run.id, subsectionId, verdict, issues, round, ...(model ? { model } : {}), at });

  if (errors.length === 0) { await store.setAiReview(record("pass")); return; }

  const fixable = errors.filter((e) => e.topicId);
  if (round >= MAX_CORRECTION_ROUNDS || fixable.length === 0) { await store.setAiReview(record("fail")); return; }

  // Send each part that has errors back for a rewrite, then check the lesson again.
  const byPart = new Map<string, ReviewIssue[]>();
  for (const e of fixable) (byPart.get(e.topicId!) ?? byPart.set(e.topicId!, []).get(e.topicId!)!).push(e);
  const wholeLesson = errors.filter((e) => !e.topicId);
  const next = round + 1;
  await store.deleteAiReview(run.id, subsectionId);
  await store.putTasks([
    ...[...byPart].map(([topicId, problems]) =>
      partTask(run.id, topicId, at, { correction: { round: next, problems: [...problems, ...wholeLesson], previous: rows.find((r) => r.topic.id === topicId)!.part!.content } }, `__c${next}`)),
    reviewTask(run.id, subsectionId, at, next),
  ]);
}

// ── Controls ────────────────────────────────────────────────────────────────

/**
 * Adds lessons (subsections) to the run, or rewrites ones already there: every part is queued again and the lesson's
 * AI check and any decision are cleared. Nothing runs until Start.
 */
export async function queueLessons(store: LessonsStore, runId: string, now: Date, subsectionIds: string[]): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const [topics, tasks] = await Promise.all([store.listTopics(runId), store.listTasks(runId)]);
  const want = new Set(subsectionIds);
  const busy = new Set(tasks.filter((t) => t.status === "queued" || t.status === "running").map((t) => t.targetId));
  const chosen = topics.filter((t) => want.has(t.subsectionId));
  const ready = chosen.filter((t) => !busy.has(t.id));
  for (const ss of new Set(ready.map((t) => t.subsectionId))) {
    await Promise.all([store.deleteAiReview(runId, ss), store.deleteReview(runId, ss), store.deleteTasks(runId, [`review__${ss}`])]);
  }
  await store.putTasks(ready.map((t) => partTask(runId, t.id, iso(now))));
  return { ok: true, queued: ready.length };
}

/** Start (or resume): release the hold, make sure every finished lesson is scheduled for its check, and queue missing parts of unfinished lessons. */
export async function startRun(store: LessonsStore, runId: string, now: Date): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  await store.updateRun(runId, { lessonsPaused: false });
  const [topics, parts, tasks, reviews, aiReviews] = await Promise.all([store.listTopics(runId), store.listParts(runId), store.listTasks(runId), store.listReviews(runId), store.listAiReviews(runId)]);
  const busy = new Set(tasks.filter((t) => t.status === "queued" || t.status === "running").map((t) => t.targetId));
  const lessons = assembleLessons(run, topics, parts, reviews, tasks, aiReviews);
  const missing = topics.filter((t) => lessons.some((l) => l.subsectionId === t.subsectionId && l.status === "incomplete") && !parts.some((p) => p.topicId === t.id) && !busy.has(t.id));
  await store.putTasks(missing.map((t) => partTask(runId, t.id, iso(now))));
  const checks = await ensureChecks(store, run, now);
  return { ok: true, queued: missing.length + checks };
}

/** Pause holds all work: nothing is claimed until Start/Resume. A step already in flight finishes; queued work is kept. */
export async function pauseRun(store: LessonsStore, runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  await store.updateRun(runId, { lessonsPaused: true });
  return { ok: true };
}

// ── Human decision (optional) ───────────────────────────────────────────────

export type Decision = "approve" | "reject";

async function lessonsOf(store: LessonsStore, run: LessonsRun) {
  const [topics, parts, reviews, tasks, aiReviews] = await Promise.all([store.listTopics(run.id), store.listParts(run.id), store.listReviews(run.id), store.listTasks(run.id), store.listAiReviews(run.id)]);
  return assembleLessons(run, topics, parts, reviews, tasks, aiReviews);
}

/** A person's decision on a whole lesson. It needs the AI check to have finished, and overrides its verdict either way. */
export async function decideLesson(store: LessonsStore, runId: string, subsectionId: string, decision: Decision, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const lesson = (await lessonsOf(store, run)).find((l) => l.subsectionId === subsectionId);
  if (!lesson) return { ok: false, error: "Lesson not found" };
  if (!isComplete(lesson.status) || lesson.status === "checking") return { ok: false, error: "This lesson is not ready: it needs every part written and the AI check finished." };
  const r: LessonReview = { id: docId(runId, subsectionId), runId, subsectionId, status: decision === "approve" ? "approved" : "rejected", decidedAt: iso(now) };
  await store.setReview(r);
  return { ok: true };
}

/** Confirms every lesson the AI passed (a person has not decided yet). */
export async function confirmAiApproved(store: LessonsStore, runId: string, now: Date): Promise<number> {
  const run = await store.getRun(runId);
  if (!run) return 0;
  const ready = (await lessonsOf(store, run)).filter((l) => l.status === "ai_approved");
  for (const l of ready) await decideLesson(store, runId, l.subsectionId, "approve", now);
  return ready.length;
}

// ── Export ──────────────────────────────────────────────────────────────────

export function buildExport(run: LessonsRun, topics: LessonTopic[], parts: LessonPart[], reviews: LessonReview[], aiReviews: LessonAiReview[], opts: { approvedOnly: boolean; now: Date; only?: string[] }) {
  const only = opts.only ? new Set(opts.only) : null;
  const lessons = assembleLessons(run, topics, parts, reviews, [], aiReviews).filter((l) => l.status !== "rejected" && isComplete(l.status) && (!opts.approvedOnly || isApproved(l.status)) && (!only || only.has(l.subsectionId)));
  return {
    schema: "mcat-lessons.export",
    schemaVersion: "3.0.0",
    exportedAt: opts.now.toISOString(),
    approvedOnly: opts.approvedOnly,
    run: { id: run.id, subject: run.subject, createdAt: run.createdAt },
    counts: { lessons: lessons.length, parts: lessons.reduce((n, l) => n + l.parts.length, 0) },
    lessons: lessons.map((l) => ({
      id: l.subsectionId, title: `${l.subsectionId} · ${l.title}`, scope: l.scope, majorSection: l.sectionId, status: l.status,
      aiReview: l.ai ? { verdict: l.ai.verdict, correctionRounds: l.ai.round, issues: l.ai.issues } : null,
      parts: l.parts.map(({ topic, part }) => ({ id: topic.id, topic: topic.title, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget, ...(part ? { ...part.content, findings: part.findings, model: part.model, corrections: part.corrections ?? 0 } : {}) })),
    })),
  };
}

// MCAT Lessons pipeline engine.
//
//   Topic database (planned and split once, in Codex) → one lesson per subsection (MS-1-SS-2), written as one part per
//   split topic → human review of each whole lesson.
//   Lessons only: no questions are ever written, and nothing here plans or splits a section.
//
// There is no background worker: every unit of work is a persisted task, and `advance()` runs exactly one task
// per call. The Lessons page calls it in a loop while a run is active; closing the page just pauses the run.
// Everything is idempotent per task id. The Sub-Codex parser, the topic database and the model caller are
// borrowed from Codex; everything that writes lessons lives here.

import type { LessonsStore } from "./store";
import { parseSubCodex } from "../codex/subcodex";
import { UnparseableOutput } from "../codex/engine";
import type { ModelCaller } from "../codex/engine";
import type { TopicBank } from "../topicbank";
import { checkLesson } from "./checks";
import { renderLessonPrompt } from "./prompts";
import { MAX_REPAIR_ROUNDS, MAX_TASK_ATTEMPTS, autoLessonsOn, docId, isCarsSubject, isLessonStage } from "./types";
import { assembleLessons, isComplete } from "./types";
import type { Finding, LessonPart, LessonStage, LessonTask, LessonTopic, LessonsRun } from "./types";

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
const iso = (d: Date) => d.toISOString();
const nowOf = (deps: Deps) => (deps.now ? deps.now() : new Date());

// ── Runs ────────────────────────────────────────────────────────────────────

export interface CreateRunInput {
  sourceText: string;
  /** Major-section numbers to build now; empty or omitted = every saved section. */
  sectionNumbers?: number[];
  /** Write every lesson automatically (default true). */
  autoLessons?: boolean;
  /** With autoLessons off: write just these lessons (subsections) now. Anything else is developed later from the run page. */
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
    autoLessons: input.autoLessons !== false,
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

  await deps.store.createRun(run);
  await deps.store.putTopics(topics);
  if (autoLessonsOn(run)) await deps.store.putTasks(topics.map((t) => newTask(run.id, t.id, now)));
  else if (input.subsectionIds?.length) {
    const want = new Set(input.subsectionIds);
    await deps.store.putTasks(topics.filter((t) => want.has(t.subsectionId)).map((t) => newTask(run.id, t.id, now)));
  }
  return { ok: true, run };
}

function newTask(runId: string, targetId: string, now: string): LessonTask {
  return { id: `lesson__${targetId}`, runId, stage: "lesson", targetId, status: "queued", attempts: 0, createdAt: now, updatedAt: now };
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface Progress {
  tasks: Record<LessonStage, { queued: number; running: number; done: number; failed: number }>;   // one task per part (split topic)
  active: boolean;       // work remains that advance() can do now or later (queued/running)
  failed: number;
  topics: number;
  /** Lessons are subsections; a lesson is "written" once every one of its parts exists. */
  lessons: { total: number; written: number; writing: number; draft: number; approved: number; rejected: number; parts: number };
}

export async function getProgress(store: LessonsStore, runId: string): Promise<Progress> {
  const [allTasks, topics, parts, reviews, run] = await Promise.all([store.listTasks(runId), store.listTopics(runId), store.listParts(runId), store.listReviews(runId), store.getRun(runId)]);
  const tasks = allTasks.filter((t) => isLessonStage(t.stage));
  const held = (t: LessonTask) => run?.lessonsPaused === true && t.status === "queued"; // paused lessons are not work "to do now"
  const byStage: Progress["tasks"] = { lesson: { queued: 0, running: 0, done: 0, failed: 0 } };
  for (const t of tasks) byStage[t.stage][t.status]++;
  const lessons = run ? assembleLessons(run, topics, parts, reviews, tasks) : [];
  return {
    tasks: byStage,
    active: tasks.some((t) => (t.status === "queued" || t.status === "running") && !held(t)),
    failed: tasks.filter((t) => t.status === "failed").length,
    topics: topics.length,
    lessons: {
      total: lessons.length,
      written: lessons.filter((l) => isComplete(l.status)).length,
      writing: lessons.filter((l) => l.status === "writing").length,
      draft: lessons.filter((l) => l.status === "draft").length,
      approved: lessons.filter((l) => l.status === "approved").length,
      rejected: lessons.filter((l) => l.status === "rejected").length,
      parts: parts.length,
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
  if (run.status === "cancelled") return { ran: null, progress: await getProgress(store, runId) };

  const task = await store.claimNextTask(runId, nowOf(deps), LEASE_MS, run.lessonsPaused ? ["lesson"] : undefined);
  if (!task) return { ran: null, progress: await getProgress(store, runId) };

  try {
    await runPart(deps, run, task);
    await store.updateTask(runId, task.id, { status: "done", error: undefined, leaseUntil: undefined, updatedAt: iso(nowOf(deps)) });
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
  opts: { maxTokens: number; render: (repair?: { round: number; previous: unknown; findings: Finding[] }) => Rendered; validate: (json: unknown) => { ok: boolean; value?: T; findings: Finding[] } },
): Promise<{ value: T; warnings: Finding[]; model: string }> {
  let repair: { round: number; previous: unknown; findings: Finding[] } | undefined;
  let last: Finding[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const r = opts.render(repair);
    let res: { json: unknown; model: string };
    try {
      res = await deps.model({ role: "generation", system: r.system, prompt: r.prompt, maxTokens: opts.maxTokens });
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

/** Writes one part (one split topic) of its subsection's lesson. */
async function runPart(deps: Deps, run: LessonsRun, task: LessonTask) {
  const topics = await deps.store.listTopics(run.id);
  const topic = topics.find((t) => t.id === task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const subsection = section.subsections.find((s) => s.id === topic.subsectionId);
  const inLesson = topics.filter((t) => t.subsectionId === topic.subsectionId).sort((a, b) => a.number - b.number);
  const siblingTitles = inLesson.filter((t) => t.id !== topic.id).map((t) => t.title);

  const { value, warnings, model } = await generateValidated(deps, {
    maxTokens: 8000,
    render: (repair) =>
      renderLessonPrompt({
        cars: isCarsSubject(run.subject),
        subject: run.subject,
        topic: { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget },
        siblingTitles,
        lesson: { title: `${topic.subsectionId} · ${subsection?.title ?? topic.subsectionTitle}`, scope: subsection?.scope ?? "", part: inLesson.findIndex((t) => t.id === topic.id) + 1, of: inLesson.length },
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkLesson(json),
  });

  await deps.store.putPart({
    id: docId(run.id, topic.id), runId: run.id, topicId: topic.id, subsectionId: topic.subsectionId,
    content: value, findings: warnings, model, createdAt: iso(nowOf(deps)),
  });
  // A part that changes after the lesson was reviewed puts the whole lesson back to "awaiting review".
  await deps.store.deleteReview(run.id, topic.subsectionId);
}

// ── Lesson controls ─────────────────────────────────────────────────────────

/**
 * Without subsectionIds: switch automatic lessons on and queue every part that has no task yet.
 * With subsectionIds: queue every part of just those lessons, rewriting parts that already exist, and leave the
 * automatic setting alone.
 */
export async function startLessons(
  store: LessonsStore, runId: string, now: Date, subsectionIds?: string[],
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const [topics, tasks] = await Promise.all([store.listTopics(runId), store.listTasks(runId)]);
  const partTasks = new Map(tasks.filter((t) => isLessonStage(t.stage)).map((t) => [t.targetId, t]));

  let ready: LessonTopic[];
  if (subsectionIds) {
    const want = new Set(subsectionIds);
    ready = topics.filter((t) => want.has(t.subsectionId) && !["queued", "running"].includes(partTasks.get(t.id)?.status ?? ""));
  } else {
    await store.updateRun(runId, { autoLessons: true });
    ready = topics.filter((t) => !partTasks.has(t.id));
  }
  await store.updateRun(runId, { lessonsPaused: false });
  await store.putTasks(ready.map((t) => newTask(runId, t.id, iso(now))));
  return { ok: true, queued: ready.length };
}

/** Pause holds lessons; resume releases them; stop drops every part not yet started and turns automatic lessons off. */
export async function controlLessons(store: LessonsStore, runId: string, action: "pause" | "resume" | "stop"): Promise<{ ok: true; dropped?: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (action === "pause") { await store.updateRun(runId, { lessonsPaused: true }); return { ok: true }; }
  if (action === "resume") { await store.updateRun(runId, { lessonsPaused: false }); return { ok: true }; }
  const queued = (await store.listTasks(runId)).filter((t) => isLessonStage(t.stage) && t.status === "queued");
  await store.deleteTasks(runId, queued.map((t) => t.id));
  await store.updateRun(runId, { autoLessons: false, lessonsPaused: false });
  return { ok: true, dropped: queued.length };
}

// ── Human review ────────────────────────────────────────────────────────────

export type Decision = "approve" | "reject";

async function lessonsOf(store: LessonsStore, run: LessonsRun) {
  const [topics, parts, reviews, tasks] = await Promise.all([store.listTopics(run.id), store.listParts(run.id), store.listReviews(run.id), store.listTasks(run.id)]);
  return assembleLessons(run, topics, parts, reviews, tasks);
}

/** Decides a whole lesson (subsection). Only a lesson whose every part has been written can be decided. */
export async function decideLesson(store: LessonsStore, runId: string, subsectionId: string, decision: Decision, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const lesson = (await lessonsOf(store, run)).find((l) => l.subsectionId === subsectionId);
  if (!lesson) return { ok: false, error: "Lesson not found" };
  if (!isComplete(lesson.status)) return { ok: false, error: "This lesson is not fully written yet; decide it once every part exists." };
  await store.setReview({ id: docId(runId, subsectionId), runId, subsectionId, status: decision === "approve" ? "approved" : "rejected", decidedAt: iso(now) });
  return { ok: true };
}

export async function approveAllLessons(store: LessonsStore, runId: string, now: Date): Promise<number> {
  const run = await store.getRun(runId);
  if (!run) return 0;
  const drafts = (await lessonsOf(store, run)).filter((l) => l.status === "draft");
  for (const l of drafts) await decideLesson(store, runId, l.subsectionId, "approve", now);
  return drafts.length;
}

// ── Export ──────────────────────────────────────────────────────────────────

export function buildExport(run: LessonsRun, topics: LessonTopic[], parts: LessonPart[], reviews: import("./types").LessonReview[], opts: { approvedOnly: boolean; now: Date }) {
  const lessons = assembleLessons(run, topics, parts, reviews).filter((l) => l.status !== "rejected" && isComplete(l.status) && (!opts.approvedOnly || l.status === "approved"));
  return {
    schema: "mcat-lessons.export",
    schemaVersion: "2.0.0",
    exportedAt: opts.now.toISOString(),
    approvedOnly: opts.approvedOnly,
    run: { id: run.id, subject: run.subject, createdAt: run.createdAt },
    counts: { lessons: lessons.length, parts: lessons.reduce((n, l) => n + l.parts.length, 0) },
    lessons: lessons.map((l) => ({
      id: l.subsectionId, title: `${l.subsectionId} · ${l.title}`, scope: l.scope, majorSection: l.sectionId, status: l.status,
      parts: l.parts.map(({ topic, part }) => ({ id: topic.id, topic: topic.title, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget, ...(part ? { ...part.content, findings: part.findings, model: part.model } : {}) })),
    })),
  };
}

// MCAT Lessons pipeline engine.
//
//   Sub-Codex → topic plan (per major section) → topic splits (single teachable ideas) → one reading lesson
//   per topic → human review. Lessons only: no questions are ever written.
//
// There is no background worker: every unit of work is a persisted task, and `advance()` runs exactly one task
// per call. The Lessons page calls it in a loop while a run is active; closing the page just pauses the run.
// Everything is idempotent per task id. Plan and split validation, the model caller and the Sub-Codex parser are
// borrowed from Codex; everything that writes lessons lives here.

import type { LessonsStore } from "./store";
import { parseSubCodex } from "../codex/subcodex";
import { checkExpansion, checkPlan } from "../codex/checks";
import { UnparseableOutput } from "../codex/engine";
import type { ModelCaller } from "../codex/engine";
import { checkLesson } from "./checks";
import { renderExpandPrompt, renderLessonPrompt, renderPlanPrompt } from "./prompts";
import { MAX_REPAIR_ROUNDS, MAX_TASK_ATTEMPTS, autoLessonsOn, docId, isCarsSubject, splitTopicId, subsectionId, topicId } from "./types";
import type { Finding, LessonDoc, LessonStage, LessonTask, LessonTopic, LessonsRun } from "./types";

export interface Deps {
  store: LessonsStore;
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
  /** Major-section numbers to build now; empty or omitted = all. */
  sectionNumbers?: number[];
  /** Write lessons automatically once topics are split (default true). */
  autoLessons?: boolean;
  createdBy: string;
}

export async function createRun(deps: Deps, input: CreateRunInput): Promise<{ ok: true; run: LessonsRun } | { ok: false; errors: ReturnType<typeof parseSubCodex>["errors"] }> {
  const parsed = parseSubCodex(input.sourceText);
  if (!parsed.ok || !parsed.subject) return { ok: false, errors: parsed.errors };

  const wanted = new Set(input.sectionNumbers?.length ? input.sectionNumbers : parsed.sections.map((s) => s.number));
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
    sections: parsed.sections.map((s) => ({ number: s.number, id: s.id, title: s.title, selected: wanted.has(s.number), planned: false, subsections: [] })),
  };
  if (!run.sections.some((s) => s.selected)) return { ok: false, errors: [{ line: null, code: "NO_SELECTION", message: "Select at least one major section." }] };

  await deps.store.createRun(run);
  await deps.store.putTasks(run.sections.filter((s) => s.selected).map((s) => newTask(run.id, "plan", s.id, now)));
  return { ok: true, run };
}

function newTask(runId: string, stage: LessonStage, targetId: string, now: string): LessonTask {
  return { id: `${stage}__${targetId}`, runId, stage, targetId, status: "queued", attempts: 0, createdAt: now, updatedAt: now };
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface Progress {
  tasks: Record<LessonStage, { queued: number; running: number; done: number; failed: number }>;
  active: boolean;       // work remains that advance() can do now or later (queued/running)
  failed: number;
  topics: number;
  lessons: { written: number; draft: number; approved: number; rejected: number };
}

export async function getProgress(store: LessonsStore, runId: string): Promise<Progress> {
  const [tasks, topics, lessons, run] = await Promise.all([store.listTasks(runId), store.listTopics(runId), store.listLessons(runId), store.getRun(runId)]);
  const held = (t: LessonTask) => run?.lessonsPaused === true && t.stage === "lesson" && t.status === "queued"; // paused lessons are not work "to do now"
  const empty = () => ({ queued: 0, running: 0, done: 0, failed: 0 });
  const byStage: Progress["tasks"] = { plan: empty(), expand: empty(), lesson: empty() };
  for (const t of tasks) byStage[t.stage][t.status]++;
  return {
    tasks: byStage,
    active: tasks.some((t) => (t.status === "queued" || t.status === "running") && !held(t)),
    failed: tasks.filter((t) => t.status === "failed").length,
    topics: topics.length,
    lessons: {
      written: lessons.length,
      draft: lessons.filter((l) => l.status === "draft").length,
      approved: lessons.filter((l) => l.status === "approved").length,
      rejected: lessons.filter((l) => l.status === "rejected").length,
    },
  };
}

export async function retryFailed(store: LessonsStore, runId: string, now: Date): Promise<number> {
  const failed = (await store.listTasks(runId)).filter((t) => t.status === "failed");
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
    switch (task.stage) {
      case "plan":   await runPlan(deps, run, task); break;
      case "expand": await runExpand(deps, run, task); break;
      case "lesson": await runLesson(deps, run, task); break;
    }
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

// ── Stage 1: topic planning ─────────────────────────────────────────────────

async function runPlan(deps: Deps, run: LessonsRun, task: LessonTask) {
  const section = run.sections.find((s) => s.id === task.targetId);
  if (!section) throw new ContentFailure(`Unknown major section ${task.targetId}`, []);

  const { value: plan } = await generateValidated(deps, {
    maxTokens: 16000,
    render: (repair) =>
      renderPlanPrompt({
        cars: isCarsSubject(run.subject),
        subject: run.subject,
        section: { id: section.id, title: section.title },
        outline: run.sections.map((s) => ({ id: s.id, title: s.title })),
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkPlan(json),
  });

  // IDs are assigned by code, never by the model. Topic numbers continue across subsections.
  let n = 0;
  const topics: LessonTopic[] = [];
  const subsections = plan.subsections.map((s, i) => ({ id: subsectionId(section.number, i + 1), title: s.title, scope: s.scope }));
  plan.subsections.forEach((s, i) => {
    for (const t of s.topics) {
      n++;
      topics.push({
        id: topicId(section.number, i + 1, n), runId: run.id, sectionId: section.id,
        subsectionId: subsections[i].id, subsectionTitle: s.title, number: n,
        title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget,
      });
    }
  });

  await deps.store.putTopics(topics);
  await deps.store.updateSection(run.id, section.number, { planned: true, coverageSummary: plan.coverageSummary, declaredGaps: plan.declaredGaps, subsections });
  // Each planned topic is then split into as many single-idea topics as it needs (possibly just itself).
  const now = iso(nowOf(deps));
  await deps.store.putTasks(topics.map((t) => newTask(run.id, "expand", t.id, now)));
}

// ── Stage 2: topic splits ───────────────────────────────────────────────────

async function runExpand(deps: Deps, run: LessonsRun, task: LessonTask) {
  const topic = await deps.store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const siblingTitles = (await deps.store.listTopics(run.id)).filter((t) => t.subsectionId === topic.subsectionId && t.id !== topic.id).map((t) => t.title);

  const { value } = await generateValidated(deps, {
    maxTokens: 6000,
    render: (repair) =>
      renderExpandPrompt({
        cars: isCarsSubject(run.subject),
        subject: run.subject,
        topic: { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget },
        siblingTitles,
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkExpansion(json, siblingTitles),
  });

  const now = iso(nowOf(deps));
  let lessonTopics: string[] = [topic.id];
  if (value.targets.length > 1) {
    // The broad topic is replaced by finer ones, each with one lesson. Numbers sort them in place.
    const children: LessonTopic[] = value.targets.map((t, i) => ({
      id: splitTopicId(topic.id, i + 1), runId: run.id, sectionId: topic.sectionId,
      subsectionId: topic.subsectionId, subsectionTitle: topic.subsectionTitle, number: topic.number + (i + 1) / 1000,
      title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, groupTitle: topic.title,
    }));
    await deps.store.putTopics(children);
    await deps.store.updateTopic(run.id, topic.id, { expanded: true });
    lessonTopics = children.map((c) => c.id);
  }
  // Re-read the run: the user may have pressed Stop (or Develop lessons) while this split was in flight.
  const fresh = (await deps.store.getRun(run.id)) ?? run;
  if (autoLessonsOn(fresh)) await deps.store.putTasks(lessonTopics.map((id) => newTask(run.id, "lesson", id, now)));
}

// ── Stage 3: reading lessons ────────────────────────────────────────────────

async function runLesson(deps: Deps, run: LessonsRun, task: LessonTask) {
  const topic = await deps.store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const siblingTitles = (await deps.store.listTopics(run.id)).filter((t) => t.subsectionId === topic.subsectionId && t.id !== topic.id).map((t) => t.title);

  const { value, warnings, model } = await generateValidated(deps, {
    maxTokens: 8000,
    render: (repair) =>
      renderLessonPrompt({
        cars: isCarsSubject(run.subject),
        subject: run.subject,
        topic: { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget },
        siblingTitles,
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkLesson(json),
  });

  await deps.store.putLesson({
    id: docId(run.id, topic.id), runId: run.id, topicId: topic.id, status: "draft",
    content: value, findings: warnings, model, createdAt: iso(nowOf(deps)),
  });
}

// ── Lesson controls ─────────────────────────────────────────────────────────

/**
 * Without topicIds: switch automatic lessons on and queue one for every topic whose split has finished and that has
 * none yet (topics split later follow automatically). With topicIds: queue just those, rewriting any that already
 * have a lesson, and leave the automatic setting alone.
 */
export async function startLessons(
  store: LessonsStore, runId: string, now: Date, topicIds?: string[],
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  const [topics, tasks] = await Promise.all([store.listTopics(runId), store.listTasks(runId)]);
  const splitDone = new Set(tasks.filter((t) => t.stage === "expand" && t.status === "done").map((t) => t.targetId));
  const lessonTasks = new Map(tasks.filter((t) => t.stage === "lesson").map((t) => [t.targetId, t]));
  // A split-off topic (MS-1-SS-1-1.2) belongs to the broad topic it came from (MS-1-SS-1-1).
  const origin = (t: LessonTopic) => (t.groupTitle ? t.id.replace(/\.\d+$/, "") : t.id);
  const split = topics.filter((t) => splitDone.has(origin(t)));

  let ready: LessonTopic[];
  if (topicIds) {
    const want = new Set(topicIds);
    ready = split.filter((t) => want.has(t.id) && !["queued", "running"].includes(lessonTasks.get(t.id)?.status ?? ""));
  } else {
    await store.updateRun(runId, { autoLessons: true });
    ready = split.filter((t) => !lessonTasks.has(t.id));
  }
  await store.updateRun(runId, { lessonsPaused: false });
  await store.putTasks(ready.map((t) => newTask(runId, "lesson", t.id, iso(now))));
  return { ok: true, queued: ready.length };
}

/** Pause holds lessons only (planning and splitting carry on); resume releases them; stop drops every lesson not yet started and turns automatic lessons off. */
export async function controlLessons(store: LessonsStore, runId: string, action: "pause" | "resume" | "stop"): Promise<{ ok: true; dropped?: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (action === "pause") { await store.updateRun(runId, { lessonsPaused: true }); return { ok: true }; }
  if (action === "resume") { await store.updateRun(runId, { lessonsPaused: false }); return { ok: true }; }
  const queued = (await store.listTasks(runId)).filter((t) => t.stage === "lesson" && t.status === "queued");
  await store.deleteTasks(runId, queued.map((t) => t.id));
  await store.updateRun(runId, { autoLessons: false, lessonsPaused: false });
  return { ok: true, dropped: queued.length };
}

// ── Human review ────────────────────────────────────────────────────────────

export type Decision = "approve" | "reject";

export async function decideLesson(store: LessonsStore, runId: string, topicId: string, decision: Decision, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const l = (await store.listLessons(runId)).find((x) => x.topicId === topicId);
  if (!l) return { ok: false, error: "Lesson not found" };
  await store.updateLesson(runId, topicId, { status: decision === "approve" ? "approved" : "rejected", decidedAt: iso(now) });
  return { ok: true };
}

export async function approveAllLessons(store: LessonsStore, runId: string, now: Date): Promise<number> {
  const drafts = (await store.listLessons(runId)).filter((l) => l.status === "draft");
  for (const l of drafts) await decideLesson(store, runId, l.topicId, "approve", now);
  return drafts.length;
}

// ── Export ──────────────────────────────────────────────────────────────────

export function buildExport(run: LessonsRun, topics: LessonTopic[], lessons: LessonDoc[], opts: { approvedOnly: boolean; now: Date }) {
  const keep = lessons.filter((l) => l.status !== "rejected" && (!opts.approvedOnly || l.status === "approved"));
  const byNum = (a: { number: number }, b: { number: number }) => a.number - b.number;
  return {
    schema: "mcat-lessons.export",
    schemaVersion: "1.0.0",
    exportedAt: opts.now.toISOString(),
    approvedOnly: opts.approvedOnly,
    run: { id: run.id, subject: run.subject, createdAt: run.createdAt },
    counts: { topics: topics.length, lessons: keep.length },
    majorSections: run.sections.filter((s) => s.selected).map((s) => ({
      id: s.id, title: s.title, coverageSummary: s.coverageSummary, declaredGaps: s.declaredGaps,
      subsections: s.subsections.map((ss) => ({
        id: ss.id, title: ss.title, scope: ss.scope,
        topics: topics.filter((t) => t.subsectionId === ss.id).sort(byNum).map((t) => {
          const l = keep.find((x) => x.topicId === t.id);
          return { id: t.id, title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, lesson: l ? { status: l.status, ...l.content, findings: l.findings, model: l.model } : null };
        }),
      })),
    })),
  };
}

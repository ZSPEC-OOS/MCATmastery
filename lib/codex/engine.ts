// MCAT Codex pipeline engine.
//
//   Sub-Codex → topic plan (per major section) → topic expansion (as many parent topics as the topic needs)
//   → one parent MCQ per topic → atomic MCQs derived from each
//   parent → AI verification (blind solve + scientific review) → bounded correction → human approval.
//
// There is no background worker: every unit of work is a persisted task, and `advance()` runs exactly one
// task per call. The Codex page calls it in a loop while a run is active; closing the page just pauses the
// run, and any later visit resumes it. Everything is idempotent per task id.

import type { CodexStore } from "./store";
import { parseSubCodex } from "./subcodex";
import {
  ATOMIC_MAX_PER_PARENT, MAX_CORRECTION_ATTEMPTS, MAX_REPAIR_ROUNDS, MAX_TASK_ATTEMPTS, atomicId, depthAtLeast, isCarsSubject, splitTopicId, subsectionId, topicId,
} from "./types";
import type {
  BankQuestion, CodexDepth, CodexQuestion, CodexRun, CodexStage, CodexTask, CodexTopic, Finding, QuestionContent, QuestionStatus, VerificationRecord,
} from "./types";
import { checkAtomicSet, checkExpansion, checkParent, checkPlan } from "./checks";
import {
  renderAtomicPrompt, renderBlindPrompt, renderCoveragePrompt, renderExpandPrompt, renderParentPrompt, renderPlanningPrompt, renderReviewPrompt,
} from "./prompts";

// ── Dependencies ────────────────────────────────────────────────────────────

export type ModelRole = "generation" | "audit";

export interface ModelCaller {
  (req: { role: ModelRole; system: string; prompt: string; maxTokens: number }): Promise<{ json: unknown; model: string }>;
}

export interface Deps {
  store: CodexStore;
  model: ModelCaller;
  now?: () => Date;
}

/** The model's reply could not be parsed as JSON at all (distinct from a transient API failure). */
export class UnparseableOutput extends Error {}
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
  depth: CodexDepth;
  /** Major-section numbers to build now; empty or omitted = all. */
  sectionNumbers?: number[];
  createdBy: string;
}

export async function createRun(deps: Deps, input: CreateRunInput): Promise<{ ok: true; run: CodexRun } | { ok: false; errors: ReturnType<typeof parseSubCodex>["errors"] }> {
  const parsed = parseSubCodex(input.sourceText);
  if (!parsed.ok || !parsed.subject) return { ok: false, errors: parsed.errors };

  const banked = bankedSectionNumbers(await deps.store.listRuns(), parsed.subject);
  const wanted = new Set((input.sectionNumbers?.length ? input.sectionNumbers : parsed.sections.map((s) => s.number)).filter((n) => !banked.has(n)));
  if (wanted.size === 0 && banked.size > 0) {
    return { ok: false, errors: [{ line: null, code: "BANKED", message: "Every selected section is already saved to the database. Open its run and choose Remove from database to build it again." }] };
  }
  const now = iso(nowOf(deps));
  const id = `run_${now.replace(/\D/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`;
  const run: CodexRun = {
    id,
    subject: parsed.subject,
    sourceText: input.sourceText,
    depth: input.depth,
    status: "active",
    createdAt: now,
    createdBy: input.createdBy,
    sections: parsed.sections.map((s) => ({ number: s.number, id: s.id, title: s.title, selected: wanted.has(s.number), planned: false, subsections: [] })),
  };
  if (!run.sections.some((s) => s.selected)) return { ok: false, errors: [{ line: null, code: "NO_SELECTION", message: "Select at least one major section." }] };

  await deps.store.createRun(run);
  await deps.store.putTasks(run.sections.filter((s) => s.selected).map((s) => newTask(run.id, "plan", s.id, now)));
  return { ok: true, run };
}

function newTask(runId: string, stage: CodexStage, targetId: string, now: string, suffix = "", correction?: CodexTask["correction"]): CodexTask {
  return {
    id: `${stage}__${targetId}${suffix}`,
    runId, stage, targetId, status: "queued", attempts: 0,
    ...(correction ? { correction } : {}),
    createdAt: now, updatedAt: now,
  };
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface Progress {
  tasks: Record<CodexStage, { queued: number; running: number; done: number; failed: number }>;
  active: boolean;       // work remains that advance() can do now or later (queued/running)
  failed: number;
  topics: number;
  questions: Record<QuestionStatus, number>;
}

export async function getProgress(store: CodexStore, runId: string): Promise<Progress> {
  const [tasks, topics, questions] = await Promise.all([store.listTasks(runId), store.listTopics(runId), store.listQuestions(runId)]);
  const empty = () => ({ queued: 0, running: 0, done: 0, failed: 0 });
  const byStage: Progress["tasks"] = { plan: empty(), expand: empty(), parent: empty(), atomic: empty(), verify: empty() };
  for (const t of tasks) byStage[t.stage][t.status]++;
  const qs: Progress["questions"] = { draft: 0, auto_passed: 0, flagged: 0, approved: 0, rejected: 0, superseded: 0 };
  for (const q of questions) qs[q.status]++;
  return {
    tasks: byStage,
    active: tasks.some((t) => t.status === "queued" || t.status === "running"),
    failed: tasks.filter((t) => t.status === "failed").length,
    topics: topics.length,
    questions: qs,
  };
}

export async function retryFailed(store: CodexStore, runId: string, now: Date): Promise<number> {
  const failed = (await store.listTasks(runId)).filter((t) => t.status === "failed");
  for (const t of failed) await store.updateTask(runId, t.id, { status: "queued", attempts: 0, error: undefined, notBefore: undefined, leaseUntil: undefined, updatedAt: iso(now) });
  return failed.length;
}

// ── advance: run one task ───────────────────────────────────────────────────

export interface AdvanceResult {
  ran: { id: string; stage: CodexStage; targetId: string; outcome: "done" | "retry" | "failed" } | null;
  error?: string;
  progress: Progress;
}

export async function advance(deps: Deps, runId: string): Promise<AdvanceResult> {
  const { store } = deps;
  const run = await store.getRun(runId);
  if (!run) throw new Error("Run not found");
  if (run.status === "cancelled" || run.banked) return { ran: null, progress: await getProgress(store, runId) };

  const task = await store.claimNextTask(runId, nowOf(deps), LEASE_MS);
  if (!task) return { ran: null, progress: await getProgress(store, runId) };

  try {
    switch (task.stage) {
      case "plan":   await runPlan(deps, run, task); break;
      case "expand": await runExpand(deps, run, task); break;
      case "parent": await runParent(deps, run, task); break;
      case "atomic": await runAtomic(deps, run, task); break;
      case "verify": await runVerify(deps, run, task); break;
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

// ── Model helpers ───────────────────────────────────────────────────────────

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

const currentOf = (qs: CodexQuestion[], qid: string) => qs.find((q) => q.qid === qid && q.current);
const nextRevision = (qs: CodexQuestion[], qid: string) => qs.filter((q) => q.qid === qid).reduce((m, q) => Math.max(m, q.revision), 0) + 1;

async function supersede(store: CodexStore, runId: string, qs: CodexQuestion[]) {
  for (const q of qs) await store.updateQuestion(runId, q.id, { current: false, status: "superseded" });
}

// ── Stage 1: topic planning ─────────────────────────────────────────────────

async function runPlan(deps: Deps, run: CodexRun, task: CodexTask) {
  const section = run.sections.find((s) => s.id === task.targetId);
  if (!section) throw new ContentFailure(`Unknown major section ${task.targetId}`, []);

  const { value: plan } = await generateValidated(deps, {
    role: "generation",
    maxTokens: 16000,
    render: (repair) =>
      renderPlanningPrompt({
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
  const topics: CodexTopic[] = [];
  const subsections = plan.subsections.map((s, i) => ({ id: subsectionId(section.number, i + 1), title: s.title, scope: s.scope }));
  plan.subsections.forEach((s, i) => {
    for (const t of s.topics) {
      n++;
      topics.push({
        id: topicId(section.number, i + 1, n), runId: run.id, sectionId: section.id,
        subsectionId: subsections[i].id, subsectionTitle: s.title, number: n,
        title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, correctionAttempts: 0,
      });
    }
  });

  await deps.store.putTopics(topics);
  await deps.store.updateSection(run.id, section.number, { planned: true, coverageSummary: plan.coverageSummary, declaredGaps: plan.declaredGaps, subsections });
  // Each planned topic is then expanded into as many parent-question topics as it needs (possibly just itself).
  const now = iso(nowOf(deps));
  await deps.store.putTasks(topics.map((t) => newTask(run.id, "expand", t.id, now)));
}

// ── Stage 1b: topic expansion ───────────────────────────────────────────────

async function runExpand(deps: Deps, run: CodexRun, task: CodexTask) {
  const topic = await deps.store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const siblingTitles = (await deps.store.listTopics(run.id)).filter((t) => t.subsectionId === topic.subsectionId && t.id !== topic.id).map((t) => t.title);

  const { value } = await generateValidated(deps, {
    role: "generation",
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
  let parentTopics: string[] = [topic.id];
  if (value.targets.length > 1) {
    // The broad topic is replaced by finer ones, each with exactly one parent question. Numbers sort them in place.
    const children: CodexTopic[] = value.targets.map((t, i) => ({
      id: splitTopicId(topic.id, i + 1), runId: run.id, sectionId: topic.sectionId,
      subsectionId: topic.subsectionId, subsectionTitle: topic.subsectionTitle, number: topic.number + (i + 1) / 1000,
      title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, correctionAttempts: 0, groupTitle: topic.title,
    }));
    await deps.store.putTopics(children);
    await deps.store.updateTopic(run.id, topic.id, { expanded: true });
    parentTopics = children.map((c) => c.id);
  }
  if (depthAtLeast(run.depth, "parents")) {
    await deps.store.putTasks(parentTopics.map((id) => newTask(run.id, "parent", id, now, "__r1")));
  }
}

// ── Stage 2: parent questions ───────────────────────────────────────────────

async function runParent(deps: Deps, run: CodexRun, task: CodexTask) {
  const topic = await deps.store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const all = await deps.store.listQuestions(run.id);
  const cars = isCarsSubject(run.subject);
  // For CARS the excerpt is part of the question, so sibling comparison uses excerpt + stem.
  const siblings = all.filter((q) => q.kind === "parent" && q.current && q.qid !== topic.id).map((q) => (q.content.passage ? `${q.content.passage} ${q.content.stem}` : q.content.stem));

  const { value, warnings, model } = await generateValidated(deps, {
    role: "generation",
    maxTokens: 4000,
    render: (repair) =>
      renderParentPrompt({
        cars,
        subject: run.subject,
        topic: { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget },
        siblingStems: siblings.map((x) => x.slice(-400)),
        ...(task.correction ? { correction: task.correction } : {}),
        ...(repair ? { repair } : {}),
      }),
    validate: (json) => checkParent(json, siblings, { cars }),
  });

  const revision = nextRevision(all, topic.id);
  const old = all.filter((q) => q.current && (q.qid === topic.id || q.parentId === topic.id));
  await supersede(deps.store, run.id, old); // a new parent invalidates its atoms too
  const now = iso(nowOf(deps));
  await deps.store.putQuestion({
    id: `${topic.id}__r${revision}`, runId: run.id, qid: topic.id, kind: "parent", topicId: topic.id,
    revision, current: true, status: "draft", content: value, findings: warnings, model, createdAt: now,
  });
  if (depthAtLeast(run.depth, "atomics")) await deps.store.putTasks([newTask(run.id, "atomic", topic.id, now, `__p${revision}`)]);
}

// ── Stage 3: atomic questions ───────────────────────────────────────────────

async function runAtomic(deps: Deps, run: CodexRun, task: CodexTask) {
  const topic = await deps.store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const section = run.sections.find((s) => s.id === topic.sectionId)!;
  const all = await deps.store.listQuestions(run.id);
  const parent = currentOf(all, topic.id);
  if (!parent) throw new ContentFailure(`No current parent question for ${topic.id}`, []);

  const topicView = { id: topic.id, title: topic.title, majorSection: section.title, subsection: topic.subsectionTitle, scope: topic.scope, primaryLearningTarget: topic.primaryLearningTarget };
  const cars = isCarsSubject(run.subject);
  const parentView = { ...(parent.content.passage ? { passage: parent.content.passage } : {}), stem: parent.content.stem, options: parent.content.options.map((o) => ({ key: o.key, text: o.text })), correctKey: parent.content.correctKey, explanation: parent.content.explanation };

  const gen = (extra?: Finding[], previous?: unknown) =>
    generateValidated(deps, {
      role: "generation",
      maxTokens: 8000,
      render: (repair) =>
        renderAtomicPrompt({
          cars,
          subject: run.subject, topic: topicView, parent: parentView,
          ...(task.correction ? { correction: task.correction } : {}),
          ...(extra?.length && !repair ? { repair: { round: 1, previous, findings: extra } } : {}),
          ...(repair ? { repair } : {}),
        }),
      validate: (json) => {
        const r = checkAtomicSet(json, parent.content);
        const findings = [...r.setFindings, ...r.perItem.flat()];
        return { ok: r.ok, value: r.ok ? r.items : undefined, findings };
      },
    });

  let result = await gen();
  let coverage = await reviewCoverage(deps, parentView, result.value);
  if (coverage.verdict === "insufficient" && coverage.missing.length > 0) {
    // One coverage-driven repair pass; whatever the reviewer still says afterwards is recorded for the person.
    const retry = await gen(coverage.missing.map((m) => ({ code: "COVERAGE_MISSING", severity: "error" as const, message: `Essential prerequisite not tested: ${m}` })), result.value);
    result = retry;
    coverage = await reviewCoverage(deps, parentView, retry.value);
  }

  const now = iso(nowOf(deps));
  const old = all.filter((q) => q.current && q.parentId === topic.id);
  await supersede(deps.store, run.id, old);
  const items = result.value;
  for (let i = 0; i < items.length; i++) {
    const qid = atomicId(topic.id, i + 1);
    const revision = nextRevision(all, qid);
    const findings: Finding[] = [...result.warnings.filter((f) => f.message.startsWith(`Question ${i + 1}:`))];
    if (coverage.unnecessary.includes(i + 1)) findings.push({ code: "COVERAGE_UNNECESSARY", severity: "warning", message: "Coverage reviewer considers this question unnecessary for solving the parent." });
    if (i === 0 && coverage.verdict !== "sufficient") {
      findings.push({ code: "COVERAGE_GAP", severity: "warning", message: coverage.verdict === "insufficient" ? `Coverage reviewer found untested prerequisites: ${coverage.missing.join("; ")}` : "Coverage reviewer could not decide whether the set is sufficient." });
    }
    // CARS atomics are answered from the parent's excerpt, which software attaches (the model never writes it).
    const content = parent.content.passage ? { ...items[i], passage: parent.content.passage } : items[i];
    await deps.store.putQuestion({
      id: `${qid}__r${revision}`, runId: run.id, qid, kind: "atomic", parentId: topic.id, topicId: topic.id,
      revision, current: true, status: "draft", content, findings, coverage, model: result.model, createdAt: now,
    });
  }
  if (depthAtLeast(run.depth, "verified")) {
    await deps.store.putTasks([newTask(run.id, "verify", topic.id, now, `__p${parent.revision}a${nextRevision(all, atomicId(topic.id, 1))}`)]);
  }
}

async function reviewCoverage(deps: Deps, parent: unknown, atoms: QuestionContent[]) {
  const view = atoms.map((a) => ({ stem: a.stem, options: a.options.map((o) => ({ key: o.key, text: o.text })), correctKey: a.correctKey, explanation: a.explanation }));
  const r = renderCoveragePrompt(parent, view);
  const { json } = await deps.model({ role: "audit", system: r.system, prompt: r.prompt, maxTokens: 2500 }).catch((e) => {
    if (e instanceof UnparseableOutput) return { json: { verdict: "uncertain" } };
    throw e;
  });
  const o = (json ?? {}) as { verdict?: string; missing?: unknown; unnecessary?: unknown };
  const verdict = o.verdict === "sufficient" || o.verdict === "insufficient" ? o.verdict : "uncertain";
  return {
    verdict: verdict as "sufficient" | "insufficient" | "uncertain",
    missing: Array.isArray(o.missing) ? o.missing.map(String).slice(0, 10) : [],
    unnecessary: Array.isArray(o.unnecessary) ? o.unnecessary.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= ATOMIC_MAX_PER_PARENT) : [],
  };
}

// ── Stage 4: verification and correction ────────────────────────────────────

async function runVerify(deps: Deps, run: CodexRun, task: CodexTask) {
  const { store } = deps;
  const topic = await store.getTopic(run.id, task.targetId);
  if (!topic) throw new ContentFailure(`Unknown topic ${task.targetId}`, []);
  const all = await store.listQuestions(run.id);
  const parent = currentOf(all, topic.id);
  const atoms = all.filter((q) => q.current && q.parentId === topic.id).sort((a, b) => a.qid.localeCompare(b.qid, undefined, { numeric: true }));
  if (!parent) throw new ContentFailure(`No current parent question for ${topic.id}`, []);
  const group = [parent, ...atoms];

  // Two separate calls: a blind solve (key and explanation withheld) and an audit of the question as written.
  const blindReq = renderBlindPrompt(group.map((q) => ({ id: q.qid, passage: q.content.passage, stem: q.content.stem, options: q.content.options })));
  const reviewReq = renderReviewPrompt(group.map((q) => ({
    id: q.qid, kind: q.kind, ...(q.content.passage ? { passage: q.content.passage } : {}), stem: q.content.stem, options: q.content.options, correctKey: q.content.correctKey,
    explanation: q.content.explanation, sourceBasis: q.content.sourceBasis, references: q.content.references,
    ...(q.kind === "atomic" ? { parentId: q.parentId } : {}),
  })));
  const [blindRes, reviewRes] = await Promise.all([
    deps.model({ role: "audit", system: blindReq.system, prompt: blindReq.prompt, maxTokens: 4000 }),
    deps.model({ role: "audit", system: reviewReq.system, prompt: reviewReq.prompt, maxTokens: 8000 }),
  ]);

  const solutions = new Map<string, { chosenKey?: string; confidence?: string; alsoDefensible?: string[]; note?: string }>();
  for (const s of ((blindRes.json as { solutions?: unknown[] })?.solutions ?? []) as Record<string, unknown>[]) {
    if (s && typeof s.id === "string") solutions.set(s.id, { chosenKey: String(s.chosenKey ?? "").trim().toUpperCase(), confidence: String(s.confidence ?? ""), alsoDefensible: Array.isArray(s.alsoDefensible) ? s.alsoDefensible.map(String) : [], note: typeof s.note === "string" ? s.note : undefined });
  }
  const reviews = new Map<string, { verdict: "pass" | "fail" | "uncertain"; issues: Finding[] }>();
  for (const r of ((reviewRes.json as { reviews?: unknown[] })?.reviews ?? []) as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string") continue;
    const issues: Finding[] = (Array.isArray(r.issues) ? (r.issues as Record<string, unknown>[]) : []).slice(0, 12).map((i) => ({
      code: "V_REVIEW",
      severity: i.severity === "error" ? "error" : "warning",
      message: String(i.message ?? "").slice(0, 600),
      responsible: i.responsible === "parent_question" || i.responsible === "topic_specification" ? i.responsible : "this_question",
      ...(i.suggestedFix ? { suggestedFix: String(i.suggestedFix).slice(0, 600) } : {}),
    }));
    const verdict = r.verdict === "pass" || r.verdict === "fail" ? r.verdict : "uncertain";
    if (verdict === "fail" && !issues.some((i) => i.severity === "error")) issues.push({ code: "V_REVIEW", severity: "error", message: "The scientific reviewer marked this question as failing.", responsible: "this_question" });
    reviews.set(r.id, { verdict, issues });
  }

  const at = iso(nowOf(deps));
  const perQuestion = group.map((q) => {
    const findings: Finding[] = [];
    const sol = solutions.get(q.qid);
    const rev = reviews.get(q.qid);
    let blind: VerificationRecord["blind"];
    if (!sol || !sol.chosenKey) findings.push({ code: "V_BLIND_MISSING", severity: "warning", message: "The blind solver returned no answer for this question." });
    else {
      const agrees = sol.chosenKey === q.content.correctKey;
      blind = { chosenKey: sol.chosenKey, confidence: sol.confidence ?? "", alsoDefensible: sol.alsoDefensible ?? [], note: sol.note, agrees };
      if (!agrees) findings.push({ code: "V_BLIND_DISAGREES", severity: "error", message: `Independent solve chose ${sol.chosenKey}, but the stated key is ${q.content.correctKey}.${sol.note ? ` ${sol.note}` : ""}`, responsible: "this_question" });
      else if (sol.confidence === "low" || (sol.alsoDefensible?.length ?? 0) > 0) findings.push({ code: "V_BLIND_UNSURE", severity: "warning", message: `Independent solve agreed but was not confident${sol.alsoDefensible?.length ? ` (also defensible: ${sol.alsoDefensible.join(", ")})` : ""}.`, responsible: "this_question" });
    }
    if (!rev) findings.push({ code: "V_REVIEW_MISSING", severity: "warning", message: "The scientific reviewer returned nothing for this question." });
    else findings.push(...rev.issues);
    const verification: VerificationRecord = { at, ...(blind ? { blind } : {}), ...(rev ? { review: { verdict: rev.verdict, issues: rev.issues } } : {}) };
    return { q, findings, verification };
  });

  // Attribute problems to the stage that must fix them.
  const parentProblems = perQuestion.flatMap(({ q, findings }) =>
    findings.filter((f) => f.severity === "error" && (q.kind === "parent" || f.responsible === "parent_question" || f.responsible === "topic_specification")),
  );
  const atomProblems = perQuestion.filter(({ q, findings }) => q.kind === "atomic" && findings.some((f) => f.severity === "error" && f.responsible === "this_question"));

  const budgetLeft = topic.correctionAttempts < MAX_CORRECTION_ATTEMPTS;
  const round = topic.correctionAttempts + 1;
  const cnow = iso(nowOf(deps));
  let queued: "parent" | "atomic" | null = null;

  if (parentProblems.length > 0 && budgetLeft) {
    await store.putTasks([newTask(run.id, "parent", topic.id, cnow, `__c${round}`, { round, problems: parentProblems, previous: parent.content })]);
    await store.updateTopic(run.id, topic.id, { correctionAttempts: round });
    queued = "parent";
  } else if (parentProblems.length === 0 && atomProblems.length > 0 && budgetLeft) {
    const problems = atomProblems.flatMap(({ q, findings }) => findings.filter((f) => f.severity === "error").map((f) => ({ ...f, message: `${q.qid}: ${f.message}` })));
    await store.putTasks([newTask(run.id, "atomic", topic.id, cnow, `__c${round}`, { round, problems, previous: atoms.map((a) => ({ qid: a.qid, ...a.content })) })]);
    await store.updateTopic(run.id, topic.id, { correctionAttempts: round });
    queued = "atomic";
  }

  for (const { q, findings, verification } of perQuestion) {
    const structural = q.findings.filter((f) => !f.code.startsWith("V_"));
    const hasError = findings.some((f) => f.severity === "error") || (q.kind === "atomic" && parentProblems.length > 0);
    let status: QuestionStatus = "auto_passed";
    if (queued) status = hasError ? "draft" : "auto_passed"; // a corrected revision will replace the failing ones
    else if (hasError) status = "flagged";
    await store.updateQuestion(run.id, q.id, { findings: [...structural, ...findings], verification, status });
  }
}

// ── Codex database (final bank) ─────────────────────────────────────────────

/** Major-section numbers of `subject` that a saved (banked) run already holds. */
export function bankedSectionNumbers(runs: CodexRun[], subject: string): Set<number> {
  const out = new Set<number>();
  for (const r of runs) if (r.banked && r.subject === subject) for (const s of r.sections) if (s.selected) out.add(s.number);
  return out;
}

/** Why a run cannot be saved to the database yet. Empty means it can. */
export function bankBlockers(run: CodexRun, progress: Progress): string[] {
  const out: string[] = [];
  if (run.banked) return ["Already saved to the database."];
  if (run.depth !== "verified") out.push("Only runs built through AI verification can be saved.");
  if (!run.sections.filter((s) => s.selected).every((s) => s.planned)) out.push("Not every major section has been planned.");
  if (progress.active) out.push("Work remains: press Run until every stage is finished.");
  if (progress.failed > 0) out.push(`${progress.failed} task(s) failed: retry them first.`);
  const pending = progress.questions.draft + progress.questions.auto_passed + progress.questions.flagged;
  if (pending > 0) out.push(`${pending} question(s) still need your decision (approve or reject).`);
  if (progress.questions.approved === 0) out.push("No approved questions to save.");
  return out;
}

/** Copies the run's approved questions into the database and locks the run. */
export async function bankRun(store: CodexStore, runId: string, now: Date): Promise<{ ok: true; questions: number } | { ok: false; errors: string[] }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, errors: ["Run not found"] };
  const blockers = bankBlockers(run, await getProgress(store, runId));
  if (blockers.length) return { ok: false, errors: blockers };

  const [topics, questions] = await Promise.all([store.listTopics(runId), store.listQuestions(runId)]);
  const approved = questions.filter((q) => q.current && q.status === "approved");
  const approvedParents = new Set(approved.filter((q) => q.kind === "parent").map((q) => q.qid));
  const topicOf = new Map(topics.map((t) => [t.id, t]));
  const list: BankQuestion[] = [];
  for (const q of approved) {
    if (q.kind === "atomic" && !(q.parentId && approvedParents.has(q.parentId))) continue; // an atomic set is useless without its parent
    const t = topicOf.get(q.topicId);
    const sec = t && run.sections.find((s) => s.id === t.sectionId);
    if (!t || !sec) continue;
    list.push({
      id: `${runId}__${q.qid}`, runId, subject: run.subject, sectionId: sec.id, sectionNumber: sec.number, sectionTitle: sec.title,
      subsectionId: t.subsectionId, subsectionTitle: t.subsectionTitle, topicId: t.id, topicTitle: t.title,
      qid: q.qid, kind: q.kind, ...(q.parentId ? { parentId: q.parentId } : {}), revision: q.revision, content: q.content, savedAt: iso(now),
    });
  }
  await store.putBankQuestions(list);
  if ((await store.countBankQuestions(runId)) !== list.length) return { ok: false, errors: ["The database count did not match after saving; the run was not locked. Try again."] };
  await store.setBanked(runId, { at: iso(now), questions: list.length });
  return { ok: true, questions: list.length };
}

/** Removes the run's questions from the database and unlocks the run and its sections. */
export async function unbankRun(store: CodexStore, runId: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const run = await store.getRun(runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (!run.banked) return { ok: false, error: "This run is not saved to the database." };
  const removed = await store.deleteBankQuestions(runId);
  await store.setBanked(runId, null);
  return { ok: true, removed };
}

// ── Human decisions ─────────────────────────────────────────────────────────

export type Decision = "approve" | "reject";

export async function decide(
  store: CodexStore, runId: string, questionId: string, decision: Decision, opts: { override?: boolean; now: Date },
): Promise<{ ok: true; status: QuestionStatus } | { ok: false; error: string }> {
  if ((await store.getRun(runId))?.banked) return { ok: false, error: "This run is saved to the database and locked. Remove it from the database to change decisions." };
  const q = (await store.listQuestions(runId)).find((x) => x.id === questionId);
  if (!q) return { ok: false, error: "Question not found" };
  if (!q.current || q.status === "superseded") return { ok: false, error: "This revision has been superseded" };
  if (decision === "approve" && q.status === "flagged" && !opts.override) {
    return { ok: false, error: "This question has an unresolved blocking finding; approve it explicitly to override." };
  }
  const status: QuestionStatus = decision === "approve" ? "approved" : "rejected";
  await store.updateQuestion(runId, q.id, { status, decidedAt: iso(opts.now) });
  return { ok: true, status };
}

// ── Export ──────────────────────────────────────────────────────────────────

export function buildExport(run: CodexRun, topics: CodexTopic[], questions: CodexQuestion[], opts: { approvedOnly: boolean; now: Date }) {
  const keep = (q: CodexQuestion) => q.current && q.status !== "superseded" && (!opts.approvedOnly || q.status === "approved");
  const qs = questions.filter(keep);
  const view = (q: CodexQuestion) => ({ id: q.qid, status: q.status, revision: q.revision, ...q.content, findings: q.findings, verification: q.verification, coverage: q.coverage, model: q.model });
  const byNum = (a: { number: number }, b: { number: number }) => a.number - b.number;
  return {
    schema: "mcat-codex.export",
    schemaVersion: "1.0.0",
    exportedAt: opts.now.toISOString(),
    approvedOnly: opts.approvedOnly,
    run: { id: run.id, subject: run.subject, depth: run.depth, createdAt: run.createdAt },
    counts: { topics: topics.length, parents: qs.filter((q) => q.kind === "parent").length, atomics: qs.filter((q) => q.kind === "atomic").length },
    majorSections: run.sections.filter((s) => s.selected).map((s) => ({
      id: s.id, title: s.title, coverageSummary: s.coverageSummary, declaredGaps: s.declaredGaps,
      subsections: s.subsections.map((ss) => ({
        id: ss.id, title: ss.title, scope: ss.scope,
        topics: topics.filter((t) => t.subsectionId === ss.id).sort(byNum).map((t) => {
          const parent = qs.find((q) => q.qid === t.id && q.kind === "parent");
          const atoms = qs.filter((q) => q.parentId === t.id).sort((a, b) => a.qid.localeCompare(b.qid, undefined, { numeric: true }));
          return { id: t.id, title: t.title, scope: t.scope, primaryLearningTarget: t.primaryLearningTarget, parentQuestion: parent ? view(parent) : null, atomicQuestions: atoms.map(view) };
        }),
      })),
    })),
  };
}

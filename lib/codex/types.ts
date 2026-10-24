// MCAT Codex — shared types and ID grammar.
// Codex is a self-contained module: nothing here touches the Mastery question bank.

export type CodexDepth = "topics" | "parents" | "atomics" | "verified";

export const DEPTH_LABELS: Record<CodexDepth, string> = {
  topics:   "Topics only",
  parents:  "Through parent questions",
  atomics:  "Through atomic questions",
  verified: "Complete, with AI verification",
};

const DEPTH_RANK: Record<CodexDepth, number> = { topics: 0, parents: 1, atomics: 2, verified: 3 };
export const depthAtLeast = (d: CodexDepth, min: CodexDepth) => DEPTH_RANK[d] >= DEPTH_RANK[min];

export type CodexStage = "plan" | "expand" | "parent" | "atomic" | "verify";
export type TaskStatus = "queued" | "running" | "done" | "failed";

/** Question lifecycle. Only a person can move a question to "approved". */
export type QuestionStatus =
  | "draft"        // written, not yet verified (or verification not requested)
  | "auto_passed"  // structural checks and AI review found no blocking problem — still needs a person
  | "flagged"      // blocking problem remains after the allowed correction attempts
  | "approved"
  | "rejected"
  | "superseded";  // replaced by a newer revision

export const MAX_CORRECTION_ATTEMPTS = 2;
export const MAX_REPAIR_ROUNDS = 2;
export const MAX_TASK_ATTEMPTS = 3;
export const ATOMIC_MAX_PER_PARENT = 12;
/** Safety bound only: how many separately testable ideas one planned topic may be split into. */
export const EXPAND_MAX_TARGETS = 30;

// ── IDs ─────────────────────────────────────────────────────────────────────

export const majorSectionId = (n: number) => `MS-${n}`;
export const subsectionId = (ms: number, ss: number) => `MS-${ms}-SS-${ss}`;
export const topicId = (ms: number, ss: number, n: number) => `MS-${ms}-SS-${ss}-${n}`;
export const splitTopicId = (topic: string, n: number) => `${topic}.${n}`;
export const atomicId = (parent: string, n: number) => `${parent}-A${n}`;

// ── Persisted documents ─────────────────────────────────────────────────────

export interface RunSection {
  number: number;
  id: string;           // MS-n
  title: string;
  selected: boolean;
  planned: boolean;
  coverageSummary?: string;
  declaredGaps?: { description: string; reason: string }[];
  subsections: { id: string; title: string; scope: string }[];
}

export interface CodexRun {
  id: string;
  subject: string;
  sourceText: string;       // the Sub-Codex exactly as submitted
  sections: RunSection[];
  depth: CodexDepth;
  status: "active" | "cancelled";
  createdAt: string;
  createdBy: string;
}

export interface CodexTopic {
  id: string;               // MS-1-SS-2-15 (also the parent question's id)
  runId: string;
  sectionId: string;
  subsectionId: string;
  subsectionTitle: string;
  number: number;
  title: string;
  scope: string;
  primaryLearningTarget: string;
  correctionAttempts: number;
  /** Set on a topic that the expand stage split into finer topics (MS-1-SS-1-1.1, .2, ...). Hidden from listings. */
  expanded?: boolean;
  /** On a split-off topic: the title of the broader topic it came from. */
  groupTitle?: string;
}

export interface CodexTask {
  id: string;
  runId: string;
  stage: CodexStage;
  targetId: string;         // section id (plan) or topic/parent id
  status: TaskStatus;
  attempts: number;
  leaseUntil?: string;
  notBefore?: string;
  error?: string;
  /** Correction instructions from verification, passed to the generator as data. */
  correction?: { round: number; problems: Finding[]; previous: unknown };
  createdAt: string;
  updatedAt: string;
}

export interface Option {
  key: "A" | "B" | "C" | "D";
  text: string;
  rationale?: string;       // required on the three distractors
}

/** CARS tests reading and reasoning skills, not content, so its questions carry a short excerpt to read. */
export const isCarsSubject = (subject: string) => /\bCARS\b/.test(subject) || /critical analysis and reasoning/i.test(subject);

export interface QuestionContent {
  passage?: string;         // CARS only: short original excerpt the question is answered from
  stem: string;
  options: Option[];
  correctKey: "A" | "B" | "C" | "D";
  explanation: string;
  references: { citation: string; note?: string }[];   // model-asserted, never verified by software
  sourceBasis: string;
  cognitiveSkill: string;
  reasoningDemand: "recall" | "application" | "analysis";
  difficulty: "easy" | "medium" | "hard";
  purpose?: string;         // atomic questions only
}

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  /** Which earlier step should fix it. */
  responsible?: "this_question" | "parent_question" | "topic_specification";
  suggestedFix?: string;
}

export interface VerificationRecord {
  at: string;
  blind?: { chosenKey: string; confidence: string; alsoDefensible: string[]; note?: string; agrees: boolean };
  review?: { verdict: "pass" | "fail" | "uncertain"; issues: Finding[] };
}

export interface CodexQuestion {
  id: string;               // qid + "__r" + revision (document id is runId + "__" + this)
  runId: string;
  qid: string;              // MS-1-SS-2-15 or MS-1-SS-2-15-A3
  kind: "parent" | "atomic";
  parentId?: string;
  topicId: string;
  revision: number;
  current: boolean;
  status: QuestionStatus;
  content: QuestionContent;
  findings: Finding[];      // structural warnings + verification findings
  verification?: VerificationRecord;
  coverage?: { verdict: "sufficient" | "insufficient" | "uncertain"; missing: string[]; unnecessary: number[] };
  model?: string;
  createdAt: string;
  decidedAt?: string;
}

export const docId = (runId: string, ...parts: (string | number)[]) => [runId, ...parts].join("__");

// ── Study progress (per learner, per question) ──────────────────────────────

export interface CodexProgress {
  id: string;               // `${userId}__${runId}__${qid}` (document id)
  userId: string;
  runId: string;
  qid: string;
  attempts: number;
  correctCount: number;
  streak: number;           // consecutive correct answers; mastered at MASTERY_STREAK
  lastCorrect: boolean;
  lastAnswer: string;
  lastAt: string;
}

export const MASTERY_STREAK = 2;
export const progressId = (userId: string, runId: string, qid: string) => `${userId}__${runId}__${qid}`;

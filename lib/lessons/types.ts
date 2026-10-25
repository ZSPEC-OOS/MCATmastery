// MCAT Lessons — shared types and ID grammar.
// Lessons is a self-contained app: Subject → major section → topic plan → topic splits → reading lessons.
// It generates lessons only (no questions) and keeps its own `lessons_*` Firestore collections.

export type LessonStage = "plan" | "expand" | "lesson";
export type TaskStatus = "queued" | "running" | "done" | "failed";

export const MAX_TASK_ATTEMPTS = 3;
export const MAX_REPAIR_ROUNDS = 2;

// ── IDs ─────────────────────────────────────────────────────────────────────

export const subsectionId = (ms: number, ss: number) => `MS-${ms}-SS-${ss}`;
export const topicId = (ms: number, ss: number, n: number) => `MS-${ms}-SS-${ss}-${n}`;
export const splitTopicId = (topic: string, n: number) => `${topic}.${n}`;
export const docId = (runId: string, ...parts: (string | number)[]) => [runId, ...parts].join("__");

/** CARS teaches reading and reasoning skills, not content, so its lessons teach a skill instead of a subject. */
export const isCarsSubject = (subject: string) => /\bCARS\b/.test(subject) || /critical analysis and reasoning/i.test(subject);

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

export interface LessonsRun {
  id: string;
  subject: string;
  sourceText: string;       // the Sub-Codex exactly as submitted
  sections: RunSection[];
  status: "active" | "cancelled";
  createdAt: string;
  createdBy: string;
  /** Lessons are written automatically for every split topic. Stop turns this off; Develop lessons turns it back on. Unset = on. */
  autoLessons?: boolean;
  /** Lessons are held: lesson tasks are not claimed, planning and splitting carry on. */
  lessonsPaused?: boolean;
}

export const autoLessonsOn = (run: Pick<LessonsRun, "autoLessons">) => run.autoLessons !== false;

export interface LessonTopic {
  id: string;               // MS-1-SS-2-15, or MS-1-SS-2-15.2 once the topic has been split
  runId: string;
  sectionId: string;
  subsectionId: string;
  subsectionTitle: string;
  number: number;
  title: string;
  scope: string;
  primaryLearningTarget: string;
  /** Set on a topic that the expand stage replaced with finer topics. Hidden from listings. */
  expanded?: boolean;
  /** On a split-off topic: the title of the broader topic it came from. */
  groupTitle?: string;
}

export interface LessonTask {
  id: string;
  runId: string;
  stage: LessonStage;
  targetId: string;         // section id (plan) or topic id
  status: TaskStatus;
  attempts: number;
  leaseUntil?: string;
  notBefore?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
}

/** A reading lesson for one split topic. No questions: this is learning material. */
export interface LessonContent {
  title: string;
  objectives: string[];
  whyItMatters: string;
  sections: { heading: string; body: string }[];
  keyTerms: { term: string; definition: string }[];
  misconceptions: { misconception: string; correction: string }[];
  mcatFocus: string;
  summary: string;
  references: { citation: string; note?: string }[];
  sourceBasis: string;
}

export interface LessonDoc {
  id: string;               // `${runId}__${topicId}` (document id)
  runId: string;
  topicId: string;
  status: "draft" | "approved" | "rejected";
  content: LessonContent;
  findings: Finding[];
  model?: string;
  createdAt: string;
  decidedAt?: string;
}

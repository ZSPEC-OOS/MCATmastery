// MCAT Lessons — shared types.
// Lessons writes one reading lesson per topic of the shared topic database (planned and split once, in Codex).
// It generates lessons only (no questions) and keeps its own `lessons_*` Firestore collections.

export type LessonStage = "lesson";
const LESSON_STAGES: readonly string[] = ["lesson"];
/** Runs made before lessons moved onto the topic database can hold plan/expand tasks; those are ignored everywhere. */
export const isLessonStage = (s: string): s is LessonStage => LESSON_STAGES.includes(s);
export type TaskStatus = "queued" | "running" | "done" | "failed";

export const MAX_TASK_ATTEMPTS = 3;
export const MAX_REPAIR_ROUNDS = 2;

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
  /** Lessons are held: lesson tasks are not claimed until resumed. */
  lessonsPaused?: boolean;
}

export const autoLessonsOn = (run: Pick<LessonsRun, "autoLessons">) => run.autoLessons !== false;

export interface LessonTopic {
  id: string;               // MS-1-SS-2-15, or MS-1-SS-2-15.2 for a split-off topic (same IDs as the topic database)
  runId: string;
  sectionId: string;
  subsectionId: string;
  subsectionTitle: string;
  number: number;
  title: string;
  scope: string;
  primaryLearningTarget: string;
  /** On a split-off topic: the title of the broader topic it came from. */
  groupTitle?: string;
}

export interface LessonTask {
  id: string;
  runId: string;
  stage: LessonStage;
  targetId: string;         // topic id
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

/** One part of a lesson: the reading material for a single split topic. No questions: this is learning material. */
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

/**
 * A lesson is one subsection (MS-1-SS-2) and is made of one part per split topic. Parts are stored one document each
 * so parallel workers never overwrite one another; the lesson is assembled from them when read.
 */
export interface LessonPart {
  id: string;               // `${runId}__${topicId}` (document id)
  runId: string;
  topicId: string;
  subsectionId: string;
  content: LessonContent;
  findings: Finding[];
  model?: string;
  createdAt: string;
}

/** The human decision on a whole lesson (subsection). No document = awaiting review. */
export interface LessonReview {
  id: string;               // `${runId}__${subsectionId}` (document id)
  runId: string;
  subsectionId: string;
  status: "approved" | "rejected";
  decidedAt: string;
}

/**
 * not_started: nothing written and nothing queued. writing: parts are queued or running. incomplete: some parts exist
 * but none are queued (stopped, paused-then-stopped or failed). The rest need every part to exist.
 */
export type LessonStatus = "not_started" | "writing" | "incomplete" | "draft" | "approved" | "rejected";
export const isComplete = (s: LessonStatus) => s === "draft" || s === "approved" || s === "rejected";

/** A lesson as the pages show it, assembled from its parts. */
export interface Lesson {
  subsectionId: string;
  title: string;            // the subsection title; the lesson is titled "MS-1-SS-2 · <title>"
  scope: string;
  sectionId: string;
  topicIds: string[];       // every part the lesson will have, in order
  parts: { topic: LessonTopic; part: LessonPart | null }[];
  status: LessonStatus;
}

export function assembleLessons(run: LessonsRun, topics: LessonTopic[], parts: LessonPart[], reviews: LessonReview[], tasks: LessonTask[] = []): Lesson[] {
  const byTopic = new Map(parts.map((p) => [p.topicId, p]));
  const pending = new Set(tasks.filter((t) => t.status === "queued" || t.status === "running").map((t) => t.targetId));
  const review = new Map(reviews.map((r) => [r.subsectionId, r]));
  const out: Lesson[] = [];
  for (const sec of run.sections.filter((x) => x.selected)) {
    for (const ss of sec.subsections) {
      const mine = topics.filter((t) => t.subsectionId === ss.id).sort((a, b) => a.number - b.number);
      const rows = mine.map((topic) => ({ topic, part: byTopic.get(topic.id) ?? null }));
      const complete = rows.length > 0 && rows.every((r) => r.part);
      out.push({
        subsectionId: ss.id, title: ss.title, scope: ss.scope, sectionId: sec.id, topicIds: mine.map((t) => t.id), parts: rows,
        status: complete ? (review.get(ss.id)?.status ?? "draft")
          : mine.some((t) => pending.has(t.id)) ? "writing"
            : rows.some((r) => r.part) ? "incomplete" : "not_started",
      });
    }
  }
  return out;
}

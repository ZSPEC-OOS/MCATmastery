// MCAT Lessons — shared types.
// Lessons writes one lesson per subsection (MS-1-SS-2) of the shared topic database (planned and split once, in
// Codex), as one part per split topic. Every finished lesson is then checked by an AI reviewer and corrected where
// needed before a person looks at it. It generates lessons only (no questions) and keeps its own `lessons_*`
// Firestore collections.

/** "lesson" writes (or rewrites) one part; "review" is the AI check of a whole finished lesson. */
export type LessonStage = "lesson" | "review";
const LESSON_STAGES: readonly string[] = ["lesson", "review"];
/** Runs made before lessons moved onto the topic database can hold plan/expand tasks; those are ignored everywhere. */
export const isLessonStage = (s: string): s is LessonStage => LESSON_STAGES.includes(s);
export type TaskStatus = "queued" | "running" | "done" | "failed";

export const MAX_TASK_ATTEMPTS = 3;
export const MAX_REPAIR_ROUNDS = 2;
/** How many times the AI reviewer may send a lesson's parts back for correction before it is flagged for a person. */
export const MAX_CORRECTION_ROUNDS = 2;

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
  /** Work is held: lesson and review tasks are not claimed until Start. Nothing starts by itself. */
  lessonsPaused?: boolean;
}

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

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
}

/** An AI reviewer's note on a lesson. `topicId` names the part it concerns (absent = the lesson as a whole). */
export interface ReviewIssue {
  topicId?: string;
  severity: Severity;
  message: string;
  suggestedFix?: string;
}

export interface LessonTask {
  id: string;
  runId: string;
  stage: LessonStage;
  targetId: string;         // topic id (lesson stage) or subsection id (review stage)
  status: TaskStatus;
  attempts: number;
  leaseUntil?: string;
  notBefore?: string;
  error?: string;
  /** Review tasks: how many correction rounds this lesson has already used. */
  round?: number;
  /** Set when the AI reviewer sent this part back: what to fix, and the text being replaced. */
  correction?: { round: number; problems: ReviewIssue[]; previous: unknown };
  createdAt: string;
  updatedAt: string;
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
  /** How many times the AI reviewer sent this part back and it was rewritten. */
  corrections?: number;
  createdAt: string;
}

/** The AI reviewer's verdict on a whole lesson. No document = not checked yet. */
export interface LessonAiReview {
  id: string;               // `${runId}__${subsectionId}` (document id)
  runId: string;
  subsectionId: string;
  verdict: "pass" | "fail"; // "fail" after the allowed correction rounds = flagged for a person
  issues: ReviewIssue[];
  round: number;            // 0 = passed first time; n = passed or stopped after n correction rounds
  model?: string;
  at: string;
}

/** The human decision on a whole lesson (subsection). Optional: it overrides the AI verdict either way. */
export interface LessonReview {
  id: string;               // `${runId}__${subsectionId}` (document id)
  runId: string;
  subsectionId: string;
  status: "approved" | "rejected";
  decidedAt: string;
}

/** A learner's reading progress in one lesson (Study). One document per user and lesson. */
export interface LessonReading {
  id: string;               // `${userId}__${runId}__${subsectionId}` (document id)
  userId: string;
  runId: string;
  subsectionId: string;
  readParts: string[];      // topic ids the learner has read
  lastPart?: string;        // where they were last reading
  updatedAt: string;
}
export const readingId = (userId: string, runId: string, subsectionId: string) => [userId, runId, subsectionId].join("__");

/**
 * not_started: nothing written and nothing queued. writing: parts queued or running. fixing: every part exists but the AI
 * check sent some back and they are being rewritten. incomplete: some parts exist but
 * none are queued. checking: every part exists, the AI check has not finished. ai_approved: the AI reviewer passed it
 * (after corrections if it needed any). flagged: the AI reviewer still found errors after the allowed corrections.
 * approved / rejected: a person decided.
 */
export type LessonStatus = "not_started" | "writing" | "fixing" | "incomplete" | "checking" | "ai_approved" | "flagged" | "approved" | "rejected";
export const isComplete = (s: LessonStatus) => s === "checking" || s === "ai_approved" || s === "flagged" || s === "approved" || s === "rejected";
/** Counts as approved for the Database checklist: passed by the AI or approved by a person, and not rejected. */
export const isApproved = (s: LessonStatus) => s === "ai_approved" || s === "approved";

/** A lesson as the pages show it, assembled from its parts. */
export interface Lesson {
  subsectionId: string;
  title: string;            // the subsection title; the lesson is titled "MS-1-SS-2 · <title>"
  scope: string;
  sectionId: string;
  topicIds: string[];       // every part the lesson will have, in order
  parts: { topic: LessonTopic; part: LessonPart | null }[];
  status: LessonStatus;
  ai: { verdict: "pass" | "fail"; issues: ReviewIssue[]; round: number } | null;
  /** While parts are being rewritten after an AI check: which round, how many parts, and what the reviewer found. */
  fixing: { round: number; parts: number; issues: ReviewIssue[] } | null;
  /** Part and review tasks queued or running for this lesson. */
  pending: number;
  /** True when the run has any task or part for this lesson, i.e. the user chose it. */
  inRun: boolean;
}

export function assembleLessons(run: LessonsRun, topics: LessonTopic[], parts: LessonPart[], reviews: LessonReview[], tasks: LessonTask[] = [], aiReviews: LessonAiReview[] = []): Lesson[] {
  const byTopic = new Map(parts.map((p) => [p.topicId, p]));
  const review = new Map(reviews.map((r) => [r.subsectionId, r]));
  const ai = new Map(aiReviews.map((r) => [r.subsectionId, r]));
  const out: Lesson[] = [];
  for (const sec of run.sections.filter((x) => x.selected)) {
    for (const ss of sec.subsections) {
      const mine = topics.filter((t) => t.subsectionId === ss.id).sort((a, b) => a.number - b.number);
      const ids = new Set(mine.map((t) => t.id));
      const mineTasks = tasks.filter((t) => t.status === "queued" || t.status === "running").filter((t) => (t.stage === "review" ? t.targetId === ss.id : ids.has(t.targetId)));
      const rows = mine.map((topic) => ({ topic, part: byTopic.get(topic.id) ?? null }));
      const complete = rows.length > 0 && rows.every((r) => r.part);
      const a = ai.get(ss.id);
      const partsPending = mineTasks.some((t) => t.stage === "lesson");
      const correcting = mineTasks.filter((t) => t.stage === "lesson" && t.correction);
      out.push({
        subsectionId: ss.id, title: ss.title, scope: ss.scope, sectionId: sec.id, topicIds: mine.map((t) => t.id), parts: rows,
        ai: a ? { verdict: a.verdict, issues: a.issues, round: a.round } : null,
        fixing: correcting.length ? { round: Math.max(...correcting.map((t) => t.correction!.round)), parts: correcting.length, issues: correcting.flatMap((t) => t.correction!.problems) } : null,
        pending: mineTasks.length,
        inRun: rows.some((r) => r.part) || tasks.some((t) => (t.stage === "review" ? t.targetId === ss.id : ids.has(t.targetId))),
        status: complete && !partsPending
          ? (review.get(ss.id)?.status ?? (a ? (a.verdict === "pass" ? "ai_approved" : "flagged") : "checking"))
          : partsPending ? (complete && correcting.length ? "fixing" : "writing") : rows.some((r) => r.part) ? "incomplete" : "not_started",
      });
    }
  }
  return out;
}

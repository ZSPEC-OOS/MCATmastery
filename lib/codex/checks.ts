// Deterministic validation of model output. Nothing is stored unless these checks pass; errors go back to
// the model for a bounded number of repair rounds, warnings are kept on the question for the reviewer.

import { z } from "zod";
import type { Finding, QuestionContent } from "./types";
import { ATOMIC_MAX_PER_PARENT } from "./types";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// ── Question shape ──────────────────────────────────────────────────────────

const KEYS = ["A", "B", "C", "D"] as const;
const text = (max: number) => z.string().trim().min(1).max(max);

const OptionSchema = z.object({
  key: z.string().transform((s) => s.trim().toUpperCase()).pipe(z.enum(KEYS)),
  text: text(1000),
  rationale: z.string().trim().max(1500).optional().nullable().transform((v) => v || undefined),
});

const RefSchema = z.object({ citation: text(500), note: z.string().max(500).optional().nullable().transform((v) => v || undefined) });

export const QuestionSchema = z.object({
  passage: z.string().trim().max(3000).optional().nullable().transform((v) => v || undefined),
  stem: text(4000),
  options: z.array(OptionSchema).length(4),
  correctKey: z.string().transform((s) => s.trim().toUpperCase()).pipe(z.enum(KEYS)),
  explanation: text(8000),
  references: z.array(RefSchema).max(8).default([]),
  sourceBasis: z.string().trim().max(1000).default(""),
  cognitiveSkill: z.string().trim().max(60).default("knowledge_of_concepts"),
  reasoningDemand: z.enum(["recall", "application", "analysis"]).catch("application"),
  difficulty: z.enum(["easy", "medium", "hard"]).catch("medium"),
  purpose: z.string().trim().max(500).optional(),
});

export interface Parsed<T> {
  ok: boolean;
  value?: T;
  findings: Finding[];
}

const err = (code: string, message: string): Finding => ({ code, severity: "error", message });
const warn = (code: string, message: string): Finding => ({ code, severity: "warning", message });

/** Shape + content rules for one question. `purpose` is required only for atomic questions. */
export function checkQuestion(raw: unknown, opts: { atomic: boolean; passage?: "required" }): Parsed<QuestionContent> {
  const parsed = QuestionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.slice(0, 12).map((i) => err("SCHEMA", `${i.path.join(".") || "question"}: ${i.message}`)) };
  }
  const q = parsed.data;
  const findings: Finding[] = [];

  const keys = q.options.map((o) => o.key).sort().join("");
  if (keys !== "ABCD") findings.push(err("OPTION_KEYS", "Options must be keyed exactly A, B, C and D, once each."));

  if (words(q.stem) < 4) findings.push(err("STEM_SHORT", "The stem is too short to be a question."));
  if (words(q.explanation) < 25) findings.push(err("EXPLANATION_SHORT", "The explanation must be at least 25 words."));

  const texts = q.options.map((o) => norm(o.text));
  if (new Set(texts).size !== texts.length) findings.push(err("DUPLICATE_OPTIONS", "Two options have the same text."));

  // Options must stand alone. Letters are matched case-sensitively so ordinary prose ("to answer a question",
  // "vitamin A and B") is not mistaken for a reference to another option.
  const banned = /\b(?:all of the above|none of the above|neither of the above)\b/i;
  const refersToOption = /\b(?:[Oo]ptions?|[Cc]hoices?|[Aa]nswers?)\s+\(?[A-D]\)?(?=[\s.,;:)]|$)|\b[Bb]oth\s+[A-D]\s+and\s+[A-D]\b/;
  for (const o of q.options) {
    if (banned.test(o.text) || refersToOption.test(o.text)) {
      findings.push(err("COMPOUND_OPTION", `Option ${o.key} refers to other options or uses an "all/none of the above" form.`));
    }
  }

  const distractors = q.options.filter((o) => o.key !== q.correctKey);
  const missing = distractors.filter((o) => !o.rationale || words(o.rationale) < 4);
  if (missing.length) findings.push(err("RATIONALE_MISSING", `Distractor rationale missing or too short for option(s) ${missing.map((o) => o.key).join(", ")}.`));
  const rats = distractors.map((o) => norm(o.rationale ?? "")).filter(Boolean);
  if (new Set(rats).size !== rats.length) findings.push(err("RATIONALE_DUPLICATE", "Distractor rationales must differ from each other."));

  // The explanation must not declare a different letter correct.
  const wrongKey = [...q.explanation.matchAll(/\b(?:option|choice|answer)\s+\(?([A-D])\)?\s+is\s+(?:the\s+)?correct\b/gi)]
    .map((m) => m[1].toUpperCase())
    .find((k) => k !== q.correctKey);
  if (wrongKey) findings.push(err("EXPLANATION_KEY_MISMATCH", `The explanation says option ${wrongKey} is correct but the key is ${q.correctKey}.`));

  if (opts.atomic && !q.purpose) findings.push(err("PURPOSE_MISSING", "Every atomic question needs a one-sentence purpose."));

  // CARS parents must bring a short original excerpt; atomics reuse the parent's excerpt (attached by software).
  if (opts.passage === "required") {
    const n = q.passage ? words(q.passage) : 0;
    if (!q.passage) findings.push(err("PASSAGE_MISSING", "A CARS question needs a short original excerpt in the \"passage\" field."));
    else if (n < 60 || n > 220) findings.push(err("PASSAGE_LENGTH", `The excerpt is ${n} words; write about 80-150 words (60-220 is accepted).`));
  }

  // Warnings (kept, visible to the reviewer)
  const lens = q.options.map((o) => o.text.length);
  const keyLen = q.options.find((o) => o.key === q.correctKey)?.text.length ?? 0;
  const others = lens.filter((_, i) => q.options[i].key !== q.correctKey);
  if (others.length && keyLen > 1.6 * (others.reduce((a, b) => a + b, 0) / others.length) && keyLen === Math.max(...lens)) {
    findings.push(warn("LENGTH_TELL", "The correct option is much longer than the distractors."));
  }
  if (q.references.length === 0) findings.push(warn("NO_REFERENCES", "No references given; the basis rests on sourceBasis alone."));

  const blocking = findings.some((f) => f.severity === "error");
  const content: QuestionContent = {
    ...(opts.passage === "required" && q.passage ? { passage: q.passage } : {}),
    stem: q.stem,
    options: KEYS.map((k) => {
      const o = q.options.find((x) => x.key === k)!;
      return { key: k, text: o?.text ?? "", ...(k !== q.correctKey && o?.rationale ? { rationale: o.rationale } : {}) };
    }),
    correctKey: q.correctKey,
    explanation: q.explanation,
    references: q.references,
    sourceBasis: q.sourceBasis,
    cognitiveSkill: q.cognitiveSkill,
    reasoningDemand: q.reasoningDemand,
    difficulty: q.difficulty,
    ...(q.purpose ? { purpose: q.purpose } : {}),
  };
  return { ok: !blocking, value: blocking ? undefined : content, findings };
}

/** Checks a parent against already-written sibling stems in the same run. */
export function checkParent(raw: unknown, siblingStems: string[], opts: { cars?: boolean } = {}): Parsed<QuestionContent> {
  const r = checkQuestion(raw, { atomic: false, ...(opts.cars ? { passage: "required" as const } : {}) });
  if (!r.value) return r;
  const findings = [...r.findings];
  const mine = r.value.passage ? `${r.value.passage} ${r.value.stem}` : r.value.stem;
  const top = siblingStems.reduce((m, s) => Math.max(m, similarity(s, mine)), 0);
  if (top >= 0.85) findings.push(err("SIBLING_DUPLICATE", "The stem is nearly identical to another topic's question."));
  else if (top >= 0.7) findings.push(warn("SIBLING_SIMILAR", "The stem is similar to another topic's question."));
  const blocking = findings.some((f) => f.severity === "error");
  return { ok: !blocking, value: blocking ? undefined : r.value, findings };
}

/** Checks a set of atomic questions derived from one parent. */
export function checkAtomicSet(raw: unknown, parent: QuestionContent): { ok: boolean; items: QuestionContent[]; perItem: Finding[][]; setFindings: Finding[] } {
  const setFindings: Finding[] = [];
  const list = Array.isArray((raw as { questions?: unknown })?.questions) ? ((raw as { questions: unknown[] }).questions) : null;
  if (!list) return { ok: false, items: [], perItem: [], setFindings: [err("SCHEMA", 'Expected {"questions": [...]}.')] };
  if (list.length === 0) setFindings.push(err("EMPTY_SET", "At least one atomic question is required."));
  if (list.length > ATOMIC_MAX_PER_PARENT) setFindings.push(err("SET_TOO_LARGE", `At most ${ATOMIC_MAX_PER_PARENT} atomic questions are allowed per parent.`));

  const items: QuestionContent[] = [];
  const perItem: Finding[][] = [];
  const parentKeyText = norm(parent.options.find((o) => o.key === parent.correctKey)?.text ?? "");
  const seenStems: string[] = [];

  list.slice(0, ATOMIC_MAX_PER_PARENT).forEach((item, i) => {
    const r = checkQuestion(item, { atomic: true });
    const f = r.findings.map((x) => ({ ...x, message: `Question ${i + 1}: ${x.message}` }));
    if (r.value) {
      if (similarity(parent.stem, r.value.stem) >= 0.7) f.push(err("RESTATES_PARENT", `Question ${i + 1}: restates the parent question.`));
      const correctText = norm(r.value.options.find((o) => o.key === r.value!.correctKey)?.text ?? "");
      if (parentKeyText && correctText === parentKeyText) f.push(err("GIVES_AWAY_PARENT", `Question ${i + 1}: its answer is the parent's correct answer.`));
      if (seenStems.some((s) => similarity(s, r.value!.stem) >= 0.8)) f.push(err("ATOMIC_DUPLICATE", `Question ${i + 1}: duplicates another atomic question.`));
      seenStems.push(r.value.stem);
      items.push(r.value);
    }
    perItem.push(f);
  });

  const blocking = setFindings.some((f) => f.severity === "error") || perItem.some((f) => f.some((x) => x.severity === "error")) || items.length !== Math.min(list.length, ATOMIC_MAX_PER_PARENT);
  return { ok: !blocking, items: blocking ? [] : items, perItem, setFindings };
}

// ── Planning ────────────────────────────────────────────────────────────────

export const PlanSchema = z.object({
  coverageSummary: z.string().default(""),
  subsections: z.array(z.object({
    title: text(300),
    scope: z.string().trim().default(""),
    topics: z.array(z.object({
      title: text(300),
      scope: text(1500),
      primaryLearningTarget: text(800),
    })).min(1),
  })).min(1),
  declaredGaps: z.array(z.object({ description: z.string(), reason: z.string().default("") })).default([]),
  reportedCounts: z.object({
    majorSectionTotal: z.number(),
    subsections: z.array(z.object({ title: z.string(), topicCount: z.number() })),
  }).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

const SURVEY = /\b(overview|fundamentals|introduction to|basics of|general principles)\b/i;

export function checkPlan(raw: unknown): Parsed<Plan> {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.slice(0, 12).map((i) => err("SCHEMA", `${i.path.join(".") || "plan"}: ${i.message}`)) };
  }
  const plan = parsed.data;
  const findings: Finding[] = [];

  const subTitles = plan.subsections.map((s) => norm(s.title));
  if (new Set(subTitles).size !== subTitles.length) findings.push(err("DUPLICATE_SUBSECTION", "Two subsections have the same title."));

  const all = plan.subsections.flatMap((s) => s.topics.map((t) => ({ sub: s.title, title: t.title })));
  for (let i = 0; i < all.length; i++) {
    if (SURVEY.test(all[i].title)) findings.push(err("SURVEY_TOPIC", `Topic "${all[i].title}" is survey-style; name one specific concept.`));
    if (words(all[i].title) > 24) findings.push(err("TOPIC_TOO_LONG", `Topic "${all[i].title.slice(0, 60)}…" is too long to be a single idea.`));
    for (let j = i + 1; j < all.length; j++) {
      if (norm(all[i].title) === norm(all[j].title) || similarity(all[i].title, all[j].title) >= 0.8) {
        findings.push(err("DUPLICATE_TOPIC", `Topics "${all[i].title}" and "${all[j].title}" duplicate each other.`));
      }
    }
  }

  const rc = plan.reportedCounts;
  if (rc) {
    if (rc.majorSectionTotal !== all.length) findings.push(err("COUNT_MISMATCH", `reportedCounts.majorSectionTotal is ${rc.majorSectionTotal} but ${all.length} topics were listed.`));
    for (const s of plan.subsections) {
      const reported = rc.subsections.find((x) => norm(x.title) === norm(s.title));
      if (!reported || reported.topicCount !== s.topics.length) findings.push(err("COUNT_MISMATCH", `Reported topic count for subsection "${s.title}" does not match the ${s.topics.length} topics listed.`));
    }
  }

  const blocking = findings.some((f) => f.severity === "error");
  return { ok: !blocking, value: blocking ? undefined : plan, findings };
}

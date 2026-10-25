// Deterministic validation of a generated lesson. Nothing is stored unless these checks pass; errors go back to
// the model for a bounded number of repair rounds, warnings are kept on the lesson for the reviewer.
// Plan and split validation is shared with Codex (checkPlan, checkExpansion in ../codex/checks).

import { z } from "zod";
import type { Finding, LessonContent } from "./types";

const text = (max: number) => z.string().trim().min(1).max(max);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export interface Parsed<T> {
  ok: boolean;
  value?: T;
  findings: Finding[];
}

const err = (code: string, message: string): Finding => ({ code, severity: "error", message });
const warn = (code: string, message: string): Finding => ({ code, severity: "warning", message });

const LessonSchema = z.object({
  title: text(300),
  objectives: z.array(text(400)).min(1).max(8),
  whyItMatters: z.string().trim().max(1000).default(""),
  sections: z.array(z.object({ heading: text(200), body: text(8000) })).min(2).max(12),
  keyTerms: z.array(z.object({ term: text(200), definition: text(800) })).max(20).default([]),
  misconceptions: z.array(z.object({ misconception: text(500), correction: text(800) })).max(8).default([]),
  mcatFocus: z.string().trim().max(1000).default(""),
  summary: text(2000),
  references: z.array(z.object({ citation: text(500), note: z.string().max(500).optional().nullable().transform((v) => v || undefined) })).max(8).default([]),
  sourceBasis: z.string().trim().max(1000).default(""),
});

export function checkLesson(raw: unknown): Parsed<LessonContent> {
  const parsed = LessonSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, findings: parsed.error.issues.slice(0, 12).map((i) => err("SCHEMA", `${i.path.join(".") || "lesson"}: ${i.message}`)) };
  }
  const l = parsed.data;
  const findings: Finding[] = [];
  const total = l.sections.reduce((n, s) => n + words(s.body), 0);
  if (total < 250) findings.push(err("TOO_SHORT", `The lesson body is ${total} words; write a real reading lesson of at least 250 words.`));
  const headings = l.sections.map((s) => norm(s.heading));
  if (new Set(headings).size !== headings.length) findings.push(err("DUPLICATE_HEADING", "Two sections have the same heading."));
  // Lessons teach; they must not contain practice questions.
  const all = [...l.sections.map((s) => ({ where: `Section "${s.heading}"`, body: s.body })), { where: "The summary", body: l.summary }, { where: "mcatFocus", body: l.mcatFocus }];
  const quiz = all.find((s) => /\b(?:which of the following|answer choices?)\b/i.test(s.body));
  if (quiz) findings.push(err("CONTAINS_QUESTIONS", `${quiz.where} reads like a practice question; this is a reading lesson with no questions.`));
  if (l.references.length === 0) findings.push(warn("NO_REFERENCES", "No references given; the basis rests on sourceBasis alone."));
  if (!l.whyItMatters) findings.push(warn("NO_WHY", "No explanation of why the idea matters."));
  const blocking = findings.some((f) => f.severity === "error");
  return { ok: !blocking, value: blocking ? undefined : l, findings };
}

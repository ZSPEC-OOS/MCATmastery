// MCAT Lessons — Study. Read-only views over finished lessons: a library of everything that has been approved (by a
// person, or passed by the AI reviewer and not rejected), and one lesson with the learner's reading progress.

import type { LessonsStore } from "./store";
import { assembleLessons, isApproved } from "./types";
import type { Lesson, LessonReading, LessonsRun } from "./types";

export interface StudyLessonSummary {
  runId: string;
  subsectionId: string;
  title: string;
  minutes: number;          // estimated reading time
  parts: number;
  readParts: number;
  lastPart: string | null;
}

export interface StudyLibrary {
  subjects: { subject: string; sections: { id: string; title: string; lessons: StudyLessonSummary[] }[] }[];
}

const WORDS_PER_MINUTE = 200;

export const lessonWords = (l: Lesson) =>
  l.parts.reduce((n, { part }) => {
    if (!part) return n;
    const c = part.content;
    const text = [c.whyItMatters, c.summary, c.mcatFocus, ...c.objectives, ...c.sections.map((s) => s.body), ...c.keyTerms.map((k) => k.definition), ...c.misconceptions.map((m) => `${m.misconception} ${m.correction}`)].join(" ");
    return n + text.split(/\s+/).filter(Boolean).length;
  }, 0);

async function assembled(store: LessonsStore, run: LessonsRun) {
  const [topics, parts, reviews, aiReviews] = await Promise.all([store.listTopics(run.id), store.listParts(run.id), store.listReviews(run.id), store.listAiReviews(run.id)]);
  return assembleLessons(run, topics, parts, reviews, [], aiReviews);
}

/** Every lesson a learner can study, newest approved copy of each, grouped by subject and major section. */
export async function buildLibrary(store: LessonsStore, userId: string): Promise<StudyLibrary> {
  const [runs, reading] = await Promise.all([store.listRuns(), store.listReading(userId)]);
  const readBy = new Map(reading.map((r) => [`${r.runId}__${r.subsectionId}`, r]));
  const newestFirst = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const seen = new Set<string>();   // subject + subsection: the newest approved copy wins
  const bySubject = new Map<string, Map<string, { id: string; title: string; lessons: StudyLessonSummary[] }>>();
  for (const run of newestFirst) {
    for (const l of (await assembled(store, run)).filter((x) => isApproved(x.status))) {
      const key = `${run.subject}__${l.subsectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sections = bySubject.get(run.subject) ?? bySubject.set(run.subject, new Map()).get(run.subject)!;
      const sec = run.sections.find((s) => s.id === l.sectionId);
      const bucket = sections.get(l.sectionId) ?? sections.set(l.sectionId, { id: l.sectionId, title: sec?.title ?? l.sectionId, lessons: [] }).get(l.sectionId)!;
      const r = readBy.get(`${run.id}__${l.subsectionId}`);
      bucket.lessons.push({
        runId: run.id, subsectionId: l.subsectionId, title: l.title, parts: l.parts.length,
        minutes: Math.max(1, Math.round(lessonWords(l) / WORDS_PER_MINUTE)),
        readParts: r ? r.readParts.filter((id) => l.topicIds.includes(id)).length : 0, lastPart: r?.lastPart ?? null,
      });
    }
  }
  const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return {
    subjects: [...bySubject].map(([subject, sections]) => ({
      subject,
      sections: [...sections.values()].sort((a, b) => num(a.id) - num(b.id)).map((s) => ({ ...s, lessons: s.lessons.sort((a, b) => a.subsectionId.localeCompare(b.subsectionId, undefined, { numeric: true })) })),
    })).sort((a, b) => a.subject.localeCompare(b.subject)),
  };
}

export interface StudyLesson {
  runId: string;
  subject: string;
  sectionTitle: string;
  lesson: Lesson;
  minutes: number;
  reading: LessonReading | null;
  prev: { runId: string; subsectionId: string; title: string } | null;
  next: { runId: string; subsectionId: string; title: string } | null;
}

/** One approved lesson for the reader, with the learner's progress and the neighbouring lessons of the same section. */
export async function getStudyLesson(store: LessonsStore, userId: string, runId: string, subsectionId: string): Promise<StudyLesson | null> {
  const run = await store.getRun(runId);
  if (!run) return null;
  const all = await assembled(store, run);
  const lesson = all.find((l) => l.subsectionId === subsectionId);
  if (!lesson || !isApproved(lesson.status)) return null;
  const siblings = all.filter((l) => l.sectionId === lesson.sectionId && isApproved(l.status));
  const i = siblings.findIndex((l) => l.subsectionId === subsectionId);
  const link = (l: Lesson | undefined) => (l ? { runId, subsectionId: l.subsectionId, title: l.title } : null);
  return {
    runId, subject: run.subject, sectionTitle: run.sections.find((s) => s.id === lesson.sectionId)?.title ?? lesson.sectionId,
    lesson, minutes: Math.max(1, Math.round(lessonWords(lesson) / WORDS_PER_MINUTE)),
    reading: await store.getReading(userId, runId, subsectionId),
    prev: link(siblings[i - 1]), next: link(siblings[i + 1]),
  };
}

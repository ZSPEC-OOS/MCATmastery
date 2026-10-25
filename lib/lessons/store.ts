// MCAT Lessons persistence. Everything lives in its own `lessons_*` Firestore collections, so nothing here can
// touch Mastery's question bank or the Codex collections. Firebase is initialised by Mastery's own
// FIREBASE_SERVICE_ACCOUNT variable.

import type { LessonAiReview, LessonPart, LessonReading, LessonReview, LessonStage, LessonTask, LessonTopic, LessonsRun, RunSection } from "./types";
import { docId, isLessonStage, readingId } from "./types";

export interface LessonsStore {
  createRun(run: LessonsRun): Promise<void>;
  getRun(id: string): Promise<LessonsRun | null>;
  listRuns(): Promise<LessonsRun[]>;
  updateRun(id: string, patch: Partial<LessonsRun>): Promise<void>;
  deleteRun(id: string): Promise<void>;
  /** Atomic read-modify-write of one major section, so parallel plan tasks cannot overwrite each other. */
  updateSection(runId: string, sectionNumber: number, patch: Partial<RunSection>): Promise<void>;

  putTasks(tasks: LessonTask[]): Promise<void>;
  listTasks(runId: string): Promise<LessonTask[]>;
  updateTask(runId: string, id: string, patch: Partial<LessonTask>): Promise<void>;
  deleteTasks(runId: string, ids: string[]): Promise<void>;
  /** Atomically claims the next ready task (queued, or running with an expired lease), skipping the given stages. */
  claimNextTask(runId: string, now: Date, leaseMs: number, skipStages?: LessonStage[]): Promise<LessonTask | null>;

  putTopics(topics: LessonTopic[]): Promise<void>;
  listTopics(runId: string): Promise<LessonTopic[]>;
  getTopic(runId: string, id: string): Promise<LessonTopic | null>;
  updateTopic(runId: string, id: string, patch: Partial<LessonTopic>): Promise<void>;

  putPart(p: LessonPart): Promise<void>;
  listParts(runId: string): Promise<LessonPart[]>;
  listReviews(runId: string): Promise<LessonReview[]>;
  setReview(r: LessonReview): Promise<void>;
  deleteReview(runId: string, subsectionId: string): Promise<void>;
  listAiReviews(runId: string): Promise<LessonAiReview[]>;
  setAiReview(r: LessonAiReview): Promise<void>;
  deleteAiReview(runId: string, subsectionId: string): Promise<void>;

  /** Study: a learner's reading progress. */
  listReading(userId: string): Promise<LessonReading[]>;
  getReading(userId: string, runId: string, subsectionId: string): Promise<LessonReading | null>;
  putReading(r: LessonReading): Promise<void>;
}

// Write every part first, then check lessons: a correction queued by a check is rewritten before the next check runs.
const STAGE_RANK: Record<LessonStage, number> = { lesson: 0, review: 1 };

export function pickClaimable(tasks: LessonTask[], now: Date, skipStages: LessonStage[] = []): LessonTask[] {
  const t = now.getTime();
  return tasks
    .filter((x) => {
      if (!isLessonStage(x.stage) || skipStages.includes(x.stage)) return false;
      if (x.status === "queued") return !x.notBefore || new Date(x.notBefore).getTime() <= t;
      if (x.status === "running") return !!x.leaseUntil && new Date(x.leaseUntil).getTime() < t;
      return false;
    })
    .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ── Firestore ───────────────────────────────────────────────────────────────

const C = { runs: "lessons_runs", tasks: "lessons_tasks", topics: "lessons_topics", parts: "lessons_parts", reviews: "lessons_reviews", aiReviews: "lessons_aireviews", reading: "lessons_reading" } as const;

/** Firestore rejects `undefined` field values; this strips them from nested data. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function firebaseApp() {
  const { getApps, initializeApp, cert } = require("firebase-admin/app") as typeof import("firebase-admin/app");
  if (getApps().length > 0) return getApps()[0];
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) throw new Error("Firebase not configured — set FIREBASE_SERVICE_ACCOUNT");
  const parsed = JSON.parse(Buffer.from(svc, "base64").toString("utf8"));
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${parsed.project_id}.firebasestorage.app`;
  return initializeApp({ credential: cert(parsed), storageBucket });
}

function fsdb() {
  const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
  return getFirestore(firebaseApp());
}

export function createFirestoreStore(): LessonsStore {
  const col = (name: string) => fsdb().collection(name);
  const byRun = async <T>(name: string, runId: string) => (await col(name).where("runId", "==", runId).get()).docs.map((d) => d.data() as T);

  return {
    async createRun(run) { await col(C.runs).doc(run.id).set(clean(run)); },
    async getRun(id) { const d = await col(C.runs).doc(id).get(); return d.exists ? (d.data() as LessonsRun) : null; },
    async listRuns() { return (await col(C.runs).get()).docs.map((d) => d.data() as LessonsRun); },
    async updateRun(id, patch) { await col(C.runs).doc(id).update(clean(patch)); },
    async updateSection(runId, n, patch) {
      const ref = col(C.runs).doc(runId);
      await fsdb().runTransaction(async (tx) => {
        const run = (await tx.get(ref)).data() as LessonsRun | undefined;
        if (!run) return;
        tx.update(ref, { sections: clean(run.sections.map((s) => (s.number === n ? { ...s, ...patch } : s))) });
      });
    },
    async deleteRun(id) {
      for (const name of [C.tasks, C.topics, C.parts, C.reviews, C.aiReviews, C.reading]) {
        const snap = await col(name).where("runId", "==", id).get();
        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = fsdb().batch();
          snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await col(C.runs).doc(id).delete();
    },

    async putTasks(list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = fsdb().batch();
        list.slice(i, i + 400).forEach((t) => batch.set(col(C.tasks).doc(docId(t.runId, t.id)), clean(t)));
        await batch.commit();
      }
    },
    async listTasks(runId) { return byRun<LessonTask>(C.tasks, runId); },
    async updateTask(runId, id, patch) {
      // Plain update(): fields set to undefined are meant to be removed, which update() cannot express, so use FieldValue.delete.
      const { FieldValue } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) data[k] = v === undefined ? FieldValue.delete() : clean(v);
      await col(C.tasks).doc(docId(runId, id)).update(data);
    },
    async deleteTasks(runId, ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = fsdb().batch();
        ids.slice(i, i + 400).forEach((id) => batch.delete(col(C.tasks).doc(docId(runId, id))));
        await batch.commit();
      }
    },
    async claimNextTask(runId, now, leaseMs, skipStages) {
      const candidates = pickClaimable(await byRun<LessonTask>(C.tasks, runId), now, skipStages).slice(0, 6);
      for (const c of candidates) {
        const ref = col(C.tasks).doc(docId(runId, c.id));
        const claimed = await fsdb().runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const cur = snap.data() as LessonTask;
          if (pickClaimable([cur], now, skipStages).length === 0) return null; // someone else claimed it first
          const next: LessonTask = { ...cur, status: "running", attempts: cur.attempts + 1, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: now.toISOString() };
          tx.set(ref, clean(next));
          return next;
        });
        if (claimed) return claimed;
      }
      return null;
    },

    async putTopics(list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = fsdb().batch();
        list.slice(i, i + 400).forEach((t) => batch.set(col(C.topics).doc(docId(t.runId, t.id)), clean(t)));
        await batch.commit();
      }
    },
    async listTopics(runId) { return byRun<LessonTopic>(C.topics, runId); },
    async getTopic(runId, id) { const d = await col(C.topics).doc(docId(runId, id)).get(); return d.exists ? (d.data() as LessonTopic) : null; },
    async updateTopic(runId, id, patch) { await col(C.topics).doc(docId(runId, id)).update(clean(patch)); },

    async putPart(p) { await col(C.parts).doc(p.id).set(clean(p)); },
    async listParts(runId) { return byRun<LessonPart>(C.parts, runId); },
    async listReviews(runId) { return byRun<LessonReview>(C.reviews, runId); },
    async setReview(r) { await col(C.reviews).doc(r.id).set(clean(r)); },
    async deleteReview(runId, subsectionId) { await col(C.reviews).doc(docId(runId, subsectionId)).delete(); },
    async listAiReviews(runId) { return byRun<LessonAiReview>(C.aiReviews, runId); },
    async setAiReview(r) { await col(C.aiReviews).doc(r.id).set(clean(r)); },
    async deleteAiReview(runId, subsectionId) { await col(C.aiReviews).doc(docId(runId, subsectionId)).delete(); },
    async listReading(userId) { return (await col(C.reading).where("userId", "==", userId).get()).docs.map((d) => d.data() as LessonReading); },
    async getReading(userId, runId, subsectionId) { const d = await col(C.reading).doc(readingId(userId, runId, subsectionId)).get(); return d.exists ? (d.data() as LessonReading) : null; },
    async putReading(r) { await col(C.reading).doc(r.id).set(clean(r)); },
  };
}

let _store: LessonsStore | null = null;
export function getStore(): LessonsStore {
  return (_store ??= createFirestoreStore());
}

// MCAT Codex persistence. Everything lives in its own `codex_*` Firestore collections, so nothing here can
// touch the Mastery question bank. Firebase is initialised by Mastery's own FIREBASE_SERVICE_ACCOUNT variable.
// A memory implementation backs the offline self-test.

import type { BankQuestion, CodexContent, CodexProgress, CodexQuestion, CodexRun, CodexStage, CodexTask, CodexTopic, RunBanked, RunSection } from "./types";
import { docId, progressId } from "./types";

export interface CodexStore {
  createRun(run: CodexRun): Promise<void>;
  getRun(id: string): Promise<CodexRun | null>;
  listRuns(): Promise<CodexRun[]>;
  updateRun(id: string, patch: Partial<CodexRun>): Promise<void>;
  deleteRun(id: string): Promise<void>;
  putContent(c: CodexContent): Promise<void>;
  listContent(runId: string): Promise<CodexContent[]>;
  updateContent(runId: string, topicId: string, patch: Partial<CodexContent>): Promise<void>;
  /** Copies approved questions into the Codex database. Idempotent per document id. */
  putBankQuestions(list: BankQuestion[]): Promise<void>;
  deleteBankQuestions(runId: string): Promise<number>;
  countBankQuestions(runId: string): Promise<number>;
  /** Marks a run as saved (or, with null, removes the mark). */
  setBanked(runId: string, banked: RunBanked | null): Promise<void>;
  /** Atomic read-modify-write of one major section, so parallel plan tasks cannot overwrite each other. */
  updateSection(runId: string, sectionNumber: number, patch: Partial<RunSection>): Promise<void>;

  putTasks(tasks: CodexTask[]): Promise<void>;
  listTasks(runId: string): Promise<CodexTask[]>;
  getTask(runId: string, id: string): Promise<CodexTask | null>;
  updateTask(runId: string, id: string, patch: Partial<CodexTask>): Promise<void>;
  /** Atomically claims the next ready task (queued, or running with an expired lease). */
  claimNextTask(runId: string, now: Date, leaseMs: number, skipStages?: CodexStage[]): Promise<CodexTask | null>;
  deleteTasks(runId: string, ids: string[]): Promise<void>;

  putTopics(topics: CodexTopic[]): Promise<void>;
  /** Working topics only: a topic that was split into finer ones is not listed (getTopic still returns it). */
  listTopics(runId: string): Promise<CodexTopic[]>;
  getTopic(runId: string, id: string): Promise<CodexTopic | null>;
  updateTopic(runId: string, id: string, patch: Partial<CodexTopic>): Promise<void>;

  putQuestion(q: CodexQuestion): Promise<void>;
  listQuestions(runId: string): Promise<CodexQuestion[]>;
  updateQuestion(runId: string, id: string, patch: Partial<CodexQuestion>): Promise<void>;
  getQuestion(runId: string, id: string): Promise<CodexQuestion | null>;

  /** Study progress for one learner in one run. */
  listProgress(userId: string, runId: string): Promise<CodexProgress[]>;
  /** Atomically records one answer and returns the updated progress. */
  recordAnswer(a: { userId: string; runId: string; qid: string; correct: boolean; answer: string; now: Date }): Promise<CodexProgress>;
}

function applyAnswerTo(prev: CodexProgress | undefined, a: { userId: string; runId: string; qid: string; correct: boolean; answer: string; now: Date }): CodexProgress {
  return {
    id: progressId(a.userId, a.runId, a.qid), userId: a.userId, runId: a.runId, qid: a.qid,
    attempts: (prev?.attempts ?? 0) + 1,
    correctCount: (prev?.correctCount ?? 0) + (a.correct ? 1 : 0),
    streak: a.correct ? (prev?.streak ?? 0) + 1 : 0,
    lastCorrect: a.correct, lastAnswer: a.answer, lastAt: a.now.toISOString(),
  };
}

// Earlier stages first: every plan, then every parent question, then every atomic set, then verification.
// Corrections queued by verification re-enter at their own stage and are worked through in the same order.
const STAGE_RANK: Record<CodexStage, number> = { plan: 0, expand: 1, content: 2, parent: 3, atomic: 4, verify: 5 };

export function pickClaimable(tasks: CodexTask[], now: Date, skipStages: CodexStage[] = []): CodexTask[] {
  const t = now.getTime();
  return tasks
    .filter((x) => {
      if (skipStages.includes(x.stage)) return false;
      if (x.status === "queued") return !x.notBefore || new Date(x.notBefore).getTime() <= t;
      if (x.status === "running") return !!x.leaseUntil && new Date(x.leaseUntil).getTime() < t;
      return false;
    })
    .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ── Memory ──────────────────────────────────────────────────────────────────

export function createMemoryStore(): CodexStore {
  const runs = new Map<string, CodexRun>();
  const tasks = new Map<string, CodexTask>();
  const topics = new Map<string, CodexTopic>();
  const questions = new Map<string, CodexQuestion>();
  const progress = new Map<string, CodexProgress>();
  const bank = new Map<string, BankQuestion>();
  const content = new Map<string, CodexContent>();
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    async createRun(run) { runs.set(run.id, clone(run)); },
    async getRun(id) { const r = runs.get(id); return r ? clone(r) : null; },
    async listRuns() { return [...runs.values()].map(clone); },
    async updateRun(id, patch) { const r = runs.get(id); if (r) runs.set(id, { ...r, ...clone(patch) }); },
    async putContent(c) { content.set(c.id, clone(c)); },
    async listContent(runId) { return [...content.values()].filter((c) => c.runId === runId).map(clone); },
    async updateContent(runId, topicId, patch) { const k = docId(runId, topicId); const c = content.get(k); if (c) content.set(k, { ...c, ...clone(patch) }); },
    async putBankQuestions(list) { for (const b of list) bank.set(b.id, clone(b)); },
    async deleteBankQuestions(runId) { let n = 0; for (const [k, v] of bank) if (v.runId === runId) { bank.delete(k); n++; } return n; },
    async countBankQuestions(runId) { return [...bank.values()].filter((b) => b.runId === runId).length; },
    async setBanked(runId, banked) {
      const r = runs.get(runId);
      if (!r) return;
      const { banked: _drop, ...rest } = r;
      runs.set(runId, banked ? { ...rest, banked: clone(banked) } : rest);
    },
    async updateSection(runId, n, patch) {
      const r = runs.get(runId);
      if (r) runs.set(runId, { ...r, sections: r.sections.map((s) => (s.number === n ? { ...s, ...clone(patch) } : s)) });
    },
    async deleteRun(id) {
      runs.delete(id);
      for (const [k, v] of content) if (v.runId === id) content.delete(k);
      for (const m of [tasks, topics, questions, progress]) for (const [k, v] of m) if ((v as { runId: string }).runId === id) m.delete(k);
    },
    async putTasks(list) { for (const t of list) tasks.set(docId(t.runId, t.id), clone(t)); },
    async listTasks(runId) { return [...tasks.values()].filter((t) => t.runId === runId).map(clone); },
    async getTask(runId, id) { const t = tasks.get(docId(runId, id)); return t ? clone(t) : null; },
    async updateTask(runId, id, patch) { const k = docId(runId, id); const t = tasks.get(k); if (t) tasks.set(k, { ...t, ...clone(patch) }); },
    async deleteTasks(runId, ids) { for (const id of ids) tasks.delete(docId(runId, id)); },
    async claimNextTask(runId, now, leaseMs, skipStages) {
      const next = pickClaimable([...tasks.values()].filter((t) => t.runId === runId), now, skipStages)[0];
      if (!next) return null;
      const claimed: CodexTask = { ...next, status: "running", attempts: next.attempts + 1, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: now.toISOString() };
      tasks.set(docId(runId, next.id), claimed);
      return clone(claimed);
    },
    async putTopics(list) { for (const t of list) topics.set(docId(t.runId, t.id), clone(t)); },
    async listTopics(runId) { return [...topics.values()].filter((t) => t.runId === runId && !t.expanded).map(clone); },
    async getTopic(runId, id) { const t = topics.get(docId(runId, id)); return t ? clone(t) : null; },
    async updateTopic(runId, id, patch) { const k = docId(runId, id); const t = topics.get(k); if (t) topics.set(k, { ...t, ...clone(patch) }); },
    async putQuestion(q) { questions.set(docId(q.runId, q.id), clone(q)); },
    async listQuestions(runId) { return [...questions.values()].filter((q) => q.runId === runId).map(clone); },
    async updateQuestion(runId, id, patch) { const k = docId(runId, id); const q = questions.get(k); if (q) questions.set(k, { ...q, ...clone(patch) }); },
    async getQuestion(runId, id) { const q = questions.get(docId(runId, id)); return q ? clone(q) : null; },
    async listProgress(userId, runId) { return [...progress.values()].filter((p) => p.userId === userId && p.runId === runId).map(clone); },
    async recordAnswer(a) {
      const next = applyAnswerTo(progress.get(progressId(a.userId, a.runId, a.qid)), a);
      progress.set(next.id, next);
      return clone(next);
    },
  };
}

// ── Firestore ───────────────────────────────────────────────────────────────

const C = { runs: "codex_runs", tasks: "codex_tasks", topics: "codex_topics", questions: "codex_questions", progress: "codex_progress", bank: "codex_bank", content: "codex_content" } as const;

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

/** Saves a JSON export under codex/ in Mastery's Firebase Storage bucket. Returns the object path. */
export async function saveExportToStorage(path: string, json: string): Promise<{ bucket: string; path: string }> {
  const { getStorage } = require("firebase-admin/storage") as typeof import("firebase-admin/storage");
  const bucket = getStorage(firebaseApp()).bucket();
  await bucket.file(path).save(Buffer.from(json, "utf8"), { contentType: "application/json" });
  return { bucket: bucket.name, path };
}

export function createFirestoreStore(): CodexStore {
  const col = (name: string) => fsdb().collection(name);
  const byRun = async <T>(name: string, runId: string) => (await col(name).where("runId", "==", runId).get()).docs.map((d) => d.data() as T);

  return {
    async createRun(run) { await col(C.runs).doc(run.id).set(clean(run)); },
    async getRun(id) { const d = await col(C.runs).doc(id).get(); return d.exists ? (d.data() as CodexRun) : null; },
    async listRuns() { return (await col(C.runs).get()).docs.map((d) => d.data() as CodexRun); },
    async updateRun(id, patch) { await col(C.runs).doc(id).update(clean(patch)); },
    async putContent(c) { await col(C.content).doc(c.id).set(clean(c)); },
    async listContent(runId) { return byRun<CodexContent>(C.content, runId); },
    async updateContent(runId, topicId, patch) { await col(C.content).doc(docId(runId, topicId)).update(clean(patch)); },
    async putBankQuestions(list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = fsdb().batch();
        list.slice(i, i + 400).forEach((b) => batch.set(col(C.bank).doc(b.id), clean(b)));
        await batch.commit();
      }
    },
    async deleteBankQuestions(runId) {
      const snap = await col(C.bank).where("runId", "==", runId).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = fsdb().batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      return snap.size;
    },
    async countBankQuestions(runId) { return (await col(C.bank).where("runId", "==", runId).count().get()).data().count; },
    async setBanked(runId, banked) {
      const { FieldValue } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
      await col(C.runs).doc(runId).update({ banked: banked ? clean(banked) : FieldValue.delete() });
    },
    async updateSection(runId, n, patch) {
      const ref = col(C.runs).doc(runId);
      await fsdb().runTransaction(async (tx) => {
        const run = (await tx.get(ref)).data() as CodexRun | undefined;
        if (!run) return;
        tx.update(ref, { sections: clean(run.sections.map((s) => (s.number === n ? { ...s, ...patch } : s))) });
      });
    },
    async deleteRun(id) {
      for (const name of [C.tasks, C.topics, C.questions, C.progress, C.content]) {
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
    async listTasks(runId) { return byRun<CodexTask>(C.tasks, runId); },
    async getTask(runId, id) { const d = await col(C.tasks).doc(docId(runId, id)).get(); return d.exists ? (d.data() as CodexTask) : null; },
    async updateTask(runId, id, patch) { await col(C.tasks).doc(docId(runId, id)).update(clean(patch)); },
    async deleteTasks(runId, ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = fsdb().batch();
        ids.slice(i, i + 400).forEach((id) => batch.delete(col(C.tasks).doc(docId(runId, id))));
        await batch.commit();
      }
    },
    async claimNextTask(runId, now, leaseMs, skipStages) {
      const candidates = pickClaimable(await byRun<CodexTask>(C.tasks, runId), now, skipStages).slice(0, 6);
      for (const c of candidates) {
        const ref = col(C.tasks).doc(docId(runId, c.id));
        const claimed = await fsdb().runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const cur = snap.data() as CodexTask;
          if (pickClaimable([cur], now, skipStages).length === 0) return null; // someone else claimed it first
          const next: CodexTask = { ...cur, status: "running", attempts: cur.attempts + 1, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: now.toISOString() };
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
    async listTopics(runId) { return (await byRun<CodexTopic>(C.topics, runId)).filter((t) => !t.expanded); },
    async getTopic(runId, id) { const d = await col(C.topics).doc(docId(runId, id)).get(); return d.exists ? (d.data() as CodexTopic) : null; },
    async updateTopic(runId, id, patch) { await col(C.topics).doc(docId(runId, id)).update(clean(patch)); },

    async putQuestion(q) { await col(C.questions).doc(docId(q.runId, q.id)).set(clean(q)); },
    async listQuestions(runId) { return byRun<CodexQuestion>(C.questions, runId); },
    async updateQuestion(runId, id, patch) { await col(C.questions).doc(docId(runId, id)).update(clean(patch)); },
    async getQuestion(runId, id) { const d = await col(C.questions).doc(docId(runId, id)).get(); return d.exists ? (d.data() as CodexQuestion) : null; },
    async listProgress(userId, runId) {
      return (await col(C.progress).where("userId", "==", userId).where("runId", "==", runId).get()).docs.map((d) => d.data() as CodexProgress);
    },
    async recordAnswer(a) {
      const ref = col(C.progress).doc(progressId(a.userId, a.runId, a.qid));
      return fsdb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = applyAnswerTo(snap.exists ? (snap.data() as CodexProgress) : undefined, a);
        tx.set(ref, clean(next));
        return next;
      });
    },
  };
}

let _store: CodexStore | null = null;
export function getStore(): CodexStore {
  return (_store ??= createFirestoreStore());
}

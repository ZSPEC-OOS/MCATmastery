// The shared topic database. A finished Codex "Topics only" run saves its major sections and split topics here,
// per subject. Codex (questions) and Lessons (reading lessons) both start from these topics, so the whole
// curriculum is planned and split exactly once.
//
// Saving is permanent by design: a section document is written with create(), which fails if one already exists,
// and nothing in this module (or the apps) deletes or overwrites saved sections.

export interface BankSection {
  id: string;               // `${subjectKey}__MS-n` (document id)
  subject: string;
  number: number;
  sectionId: string;        // MS-n
  title: string;
  coverageSummary?: string;
  declaredGaps?: { description: string; reason: string }[];
  subsections: { id: string; title: string; scope: string }[];
  topicCount: number;
  sourceRunId: string;
  savedAt: string;
}

export interface BankTopic {
  id: string;               // `${subjectKey}__${topicId}` (document id)
  subject: string;
  sectionNumber: number;
  sectionId: string;
  subsectionId: string;
  subsectionTitle: string;
  topicId: string;          // MS-1-SS-2-15, or MS-1-SS-2-15.2 for a split-off topic
  number: number;
  title: string;
  scope: string;
  primaryLearningTarget: string;
  groupTitle?: string;      // on a split-off topic: the broader topic it came from
  savedAt: string;
}

export interface TopicBank {
  /** Sections of `subject` already saved. */
  listSections(subject: string): Promise<BankSection[]>;
  /** Topics of the given sections of `subject`, in curriculum order. */
  listTopics(subject: string, sectionNumbers: number[]): Promise<BankTopic[]>;
  /** Permanently saves sections and their topics. Fails (and writes nothing) if any section already exists. */
  save(sections: BankSection[], topics: BankTopic[]): Promise<void>;
}

export const subjectKey = (subject: string) => subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const bankSectionId = (subject: string, number: number) => `${subjectKey(subject)}__MS-${number}`;
export const bankTopicId = (subject: string, topicId: string) => `${subjectKey(subject)}__${topicId}`;

// ── Firestore ───────────────────────────────────────────────────────────────

const C = { sections: "topicbank_sections", topics: "topicbank_topics" } as const;

/** Firestore rejects `undefined` field values; this strips them from nested data. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function fsdb() {
  const { getApps, initializeApp, cert } = require("firebase-admin/app") as typeof import("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
  if (getApps().length === 0) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) throw new Error("Firebase not configured — set FIREBASE_SERVICE_ACCOUNT");
    const parsed = JSON.parse(Buffer.from(svc, "base64").toString("utf8"));
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${parsed.project_id}.firebasestorage.app`;
    initializeApp({ credential: cert(parsed), storageBucket });
  }
  return getFirestore(getApps()[0]);
}

export function createFirestoreTopicBank(): TopicBank {
  const col = (name: string) => fsdb().collection(name);
  return {
    async listSections(subject) {
      const snap = await col(C.sections).where("subject", "==", subject).get();
      return snap.docs.map((d) => d.data() as BankSection).sort((a, b) => a.number - b.number);
    },
    async listTopics(subject, sectionNumbers) {
      const want = new Set(sectionNumbers);
      const snap = await col(C.topics).where("subject", "==", subject).get();
      return snap.docs.map((d) => d.data() as BankTopic).filter((t) => want.has(t.sectionNumber)).sort((a, b) => a.sectionNumber - b.sectionNumber || a.number - b.number);
    },
    async save(sections, topics) {
      // A saved section is never touched again: refuse up front if any already exists.
      for (const s of sections) {
        if ((await col(C.sections).doc(s.id).get()).exists) throw new Error(`${s.sectionId} of ${s.subject} is already saved in the topic database.`);
      }
      // Topics first, then the section document as the commit marker (create() throws if it exists). If a write
      // fails partway, no section document exists yet, so the save can simply be repeated.
      for (let i = 0; i < topics.length; i += 400) {
        const batch = fsdb().batch();
        topics.slice(i, i + 400).forEach((t) => batch.set(col(C.topics).doc(t.id), clean(t)));
        await batch.commit();
      }
      for (const s of sections) await col(C.sections).doc(s.id).create(clean(s));
    },
  };
}

let _bank: TopicBank | null = null;
export function getTopicBank(): TopicBank {
  return (_bank ??= createFirestoreTopicBank());
}

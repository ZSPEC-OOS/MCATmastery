"use client";
import { useState } from "react";
import useSWR from "swr";
import CodexNavbar from "../_components/CodexNavbar";
import { TEAL, card, fetcher, input } from "../_components/ui";

interface Row {
  number: number; id: string; title: string; topics: number; topicsSaved: boolean; questionsSaved: boolean;
  lessonsTotal: number; lessonsApproved: number; complete: boolean;
}
interface Data { subject: string; sections: Row[]; subjects: string[] }
interface SectionDetail {
  section: { id: string; title: string; coverageSummary?: string; declaredGaps?: { description: string; reason: string }[]; topicCount: number; savedAt: string };
  subsections: { id: string; title: string; scope: string; lessonApproved: boolean; topics: { id: string; title: string; scope: string; primaryLearningTarget: string; groupTitle: string | null }[] }[];
}

const Chip = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: ok ? "#16a34a" : "var(--text-muted)", background: ok ? "rgba(22,163,74,0.12)" : "var(--bg-input)", fontWeight: 600 }}>{children}</span>
);

// The saved contents of one section: its subsections (lessons) and every split topic.
function SectionContents({ subject, number }: { subject: string; number: number }) {
  const { data, error } = useSWR<SectionDetail>(`/api/codex/database/section?subject=${encodeURIComponent(subject)}&number=${number}`, fetcher);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  if (error) return <p className="text-sm px-3 pb-3" style={{ color: "var(--accent-red)" }}>{error.message}</p>;
  if (!data) return <p className="text-sm px-3 pb-3" style={{ color: "var(--text-muted)" }}>Loading…</p>;
  return (
    <div className="px-3 pb-3 space-y-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Saved {new Date(data.section.savedAt).toLocaleString()} · {data.section.topicCount} topics · {data.subsections.length} lessons (subsections)
        {data.section.coverageSummary ? ` · ${data.section.coverageSummary}` : ""}
      </p>
      {data.section.declaredGaps && data.section.declaredGaps.length > 0 && (
        <p className="text-xs" style={{ color: "#d97706" }}>Gaps declared by the planner: {data.section.declaredGaps.map((g) => g.description).join("; ")}</p>
      )}
      {data.subsections.map((ss) => (
        <div key={ss.id}>
          <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
            <span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{ss.id}</span>{ss.title}
            <span className="ml-2 text-xs font-normal" style={{ color: ss.lessonApproved ? "#16a34a" : "var(--text-muted)" }}>{ss.lessonApproved ? "lesson approved" : "lesson not approved"} · {ss.topics.length} topics</span>
          </h3>
          <ul className="space-y-0.5">
            {ss.topics.map((t) => (
              <li key={t.id}>
                <button className="w-full text-left text-sm py-1 flex gap-2" style={{ color: "var(--text-primary)" }} onClick={() => setOpenTopic(openTopic === t.id ? null : t.id)}>
                  <span className="text-xs font-mono mt-0.5" style={{ color: "var(--text-muted)", minWidth: 104 }}>{t.id}</span>
                  <span className="flex-1">{t.groupTitle && <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{t.groupTitle}</span>}{t.title}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{openTopic === t.id ? "▾" : "▸"}</span>
                </button>
                {openTopic === t.id && (
                  <p className="text-xs pl-[116px] pb-1" style={{ color: "var(--text-muted)" }}><b>Scope:</b> {t.scope} <b>Target:</b> {t.primaryLearningTarget}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Which major sections are finished: topics saved, questions saved, every lesson approved.
export default function DatabasePage() {
  const [subject, setSubject] = useState("Biology");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (n: number) => setOpen((o) => { const next = new Set(o); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const { data, error } = useSWR<Data>(`/api/codex/database?subject=${encodeURIComponent(subject)}`, fetcher);

  const done = data?.sections.filter((s) => s.complete).length ?? 0;
  const withTopics = data?.sections.filter((s) => s.topicsSaved).length ?? 0;

  return (
    <div className="flex flex-col min-h-screen">
      <CodexNavbar />
      <main className="max-w-4xl mx-auto w-full px-4 md:px-6 py-6 flex-1">
        <h1 className="text-2xl mb-1" style={{ color: "var(--text-primary)" }}>Database</h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          A section is complete when its topics are saved, its questions are saved to the question database, and every lesson (one per subsection) is approved.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...input, width: "auto" }} aria-label="Subject">
            {(data?.subjects ?? [subject]).map((s) => <option key={s}>{s}</option>)}
          </select>
          {data && <span className="text-sm" style={{ color: "var(--text-secondary)" }}><b>{done}</b> of {data.sections.length} complete · <b>{withTopics}</b> with topics saved</span>}
          {data && withTopics > 0 && (
            <span className="flex gap-2">
              <button className="text-xs underline" style={{ color: "var(--text-muted)" }} onClick={() => setOpen(new Set(data.sections.filter((x) => x.topicsSaved).map((x) => x.number)))}>Expand all</button>
              <button className="text-xs underline" style={{ color: "var(--text-muted)" }} onClick={() => setOpen(new Set())}>Collapse all</button>
            </span>
          )}
        </div>

        {error && <p style={{ color: "var(--accent-red)" }}>{error.message}</p>}
        {!data && !error && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}

        <div className="space-y-2">
          {data?.sections.map((s) => (
            <div key={s.number} style={{ ...card, borderColor: s.complete ? TEAL : undefined }}>
              <button
                className="w-full text-left p-3 flex flex-wrap items-center gap-2" disabled={!s.topicsSaved}
                aria-expanded={open.has(s.number)} onClick={() => s.topicsSaved && toggle(s.number)}
                style={{ cursor: s.topicsSaved ? "pointer" : "default" }}
              >
                <span className="text-xs w-3" style={{ color: "var(--text-muted)" }}>{s.topicsSaved ? (open.has(s.number) ? "▾" : "▸") : ""}</span>
                <span className="text-sm flex-1 min-w-[180px]" style={{ color: "var(--text-primary)" }}><b>{s.id}</b> {s.title}</span>
                <Chip ok={s.topicsSaved}>{s.topicsSaved ? `${s.topics} topics saved` : "topics not saved"}</Chip>
                <Chip ok={s.questionsSaved}>{s.questionsSaved ? "questions saved" : "no questions saved"}</Chip>
                <Chip ok={s.topicsSaved && s.lessonsTotal > 0 && s.lessonsApproved >= s.lessonsTotal}>{s.topicsSaved ? `lessons ${s.lessonsApproved}/${s.lessonsTotal} approved` : "no lessons"}</Chip>
                {s.complete && <span className="text-xs font-semibold" style={{ color: TEAL }}>Complete</span>}
              </button>
              {open.has(s.number) && s.topicsSaved && <SectionContents subject={data.subject} number={s.number} />}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

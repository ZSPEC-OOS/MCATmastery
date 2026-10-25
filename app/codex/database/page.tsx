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

const Chip = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: ok ? "#16a34a" : "var(--text-muted)", background: ok ? "rgba(22,163,74,0.12)" : "var(--bg-input)", fontWeight: 600 }}>{children}</span>
);

// Which major sections are finished: topics saved, questions saved, every lesson approved.
export default function DatabasePage() {
  const [subject, setSubject] = useState("Biology");
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
        </div>

        {error && <p style={{ color: "var(--accent-red)" }}>{error.message}</p>}
        {!data && !error && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}

        <div className="space-y-2">
          {data?.sections.map((s) => (
            <div key={s.number} className="p-3 flex flex-wrap items-center gap-2" style={{ ...card, borderColor: s.complete ? TEAL : undefined }}>
              <span className="text-sm flex-1 min-w-[200px]" style={{ color: "var(--text-primary)" }}><b>{s.id}</b> {s.title}</span>
              <Chip ok={s.topicsSaved}>{s.topicsSaved ? `${s.topics} topics saved` : "topics not saved"}</Chip>
              <Chip ok={s.questionsSaved}>{s.questionsSaved ? "questions saved" : "no questions saved"}</Chip>
              <Chip ok={s.topicsSaved && s.lessonsTotal > 0 && s.lessonsApproved >= s.lessonsTotal}>{s.topicsSaved ? `lessons ${s.lessonsApproved}/${s.lessonsTotal} approved` : "no lessons"}</Chip>
              {s.complete && <span className="text-xs font-semibold" style={{ color: TEAL }}>Complete</span>}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

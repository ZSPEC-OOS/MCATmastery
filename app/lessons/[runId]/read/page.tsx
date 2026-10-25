"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../../_components/LessonsNavbar";
import LessonCard from "../../_components/LessonCard";
import { btn, fetcher, input } from "../../_components/ui";
import type { Lesson, LessonsRun } from "../../../../lib/lessons/types";

interface Detail { run: Omit<LessonsRun, "sourceText">; lessons: Lesson[] }
type Filter = "all" | "writing" | "draft" | "approved" | "rejected";

// Read and review the lessons, in learning order.
export default function ReadLessons() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, mutate } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [filter, setFilter] = useState<Filter>("all");
  const [openAll, setOpenAll] = useState(0); // bumped to remount cards; odd = all open
  const [notice, setNotice] = useState("");

  if (error) return <Shell runId={runId}><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell runId={runId}><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, lessons } = data;
  const shown = (l: Lesson) => filter === "all" || l.status === filter;
  const counts = { writing: lessons.filter((l) => l.status === "writing").length, draft: lessons.filter((l) => l.status === "draft").length, approved: lessons.filter((l) => l.status === "approved").length, rejected: lessons.filter((l) => l.status === "rejected").length };

  async function decide(l: Lesson, action: "approve" | "reject") {
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, subsectionId: l.subsectionId }) });
    if (!res.ok) setNotice((await res.json()).error ?? "Could not record the decision");
    mutate();
  }

  async function approveAll() {
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_all" }) });
    const d = await res.json();
    setNotice(res.ok ? `Approved ${d.approved ?? 0} lesson(s).` : (d.error ?? "Could not approve"));
    mutate();
  }

  return (
    <Shell runId={runId}>
      <h1 className="text-2xl mb-1" style={{ color: "var(--text-primary)" }}>Lessons</h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        {run.subject}: {lessons.length} lesson(s), one per subsection · {counts.writing} still writing · {counts.draft} awaiting you · {counts.approved} approved · {counts.rejected} rejected
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ ...input, width: "auto" }} aria-label="Filter lessons">
          <option value="all">All lessons</option>
          <option value="writing">Still writing</option>
          <option value="draft">Awaiting review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button style={btn("ghost")} onClick={() => setOpenAll((n) => (n % 2 === 0 ? n + 1 : n + 2))}>Open all</button>
        <button style={btn("ghost")} onClick={() => setOpenAll((n) => (n % 2 === 1 ? n + 1 : n + 2))}>Collapse all</button>
        <span className="flex-1" />
        <button style={btn("ghost", counts.draft === 0)} disabled={counts.draft === 0} onClick={approveAll}>Approve all awaiting</button>
      </div>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}
      {lessons.every((l) => l.parts.every((p) => !p.part)) && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nothing written yet. Use Develop lessons or Choose lessons on the run page.</p>}

      <div className="space-y-5">
        {run.sections.filter((sec) => sec.selected).map((sec) => {
          const mine = lessons.filter((l) => l.sectionId === sec.id && shown(l));
          if (mine.length === 0) return null;
          return (
            <section key={sec.id}>
              <h2 className="text-lg mb-1" style={{ color: "var(--text-primary)" }}>{sec.id} · {sec.title}</h2>
              <div className="space-y-1.5">
                {mine.map((l) => <LessonCard key={`${l.subsectionId}-${openAll}`} lesson={l} onDecide={decide} defaultOpen={openAll % 2 === 1} />)}
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function Shell({ runId, children }: { runId: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <main className="max-w-4xl mx-auto w-full px-4 md:px-6 py-6 flex-1">
        <Link href={`/lessons/${runId}`} className="text-xs" style={{ color: "var(--text-muted)" }}>← Back to run</Link>
        {children}
      </main>
    </div>
  );
}

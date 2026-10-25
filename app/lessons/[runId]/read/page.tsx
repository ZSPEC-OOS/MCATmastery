"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../../_components/LessonsNavbar";
import LessonCard from "../../_components/LessonCard";
import { btn, fetcher, input } from "../../_components/ui";
import type { LessonDoc, LessonTopic, LessonsRun } from "../../../../lib/lessons/types";

interface Detail { run: Omit<LessonsRun, "sourceText">; topics: LessonTopic[]; lessons: LessonDoc[] }
type Filter = "all" | "draft" | "approved" | "rejected";

// Read and review the lessons, in learning order.
export default function ReadLessons() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, mutate } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [filter, setFilter] = useState<Filter>("all");
  const [openAll, setOpenAll] = useState(0); // bumped to remount cards; odd = all open
  const [notice, setNotice] = useState("");

  if (error) return <Shell runId={runId}><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell runId={runId}><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, topics, lessons } = data;
  const lessonOf = (tid: string) => lessons.find((l) => l.topicId === tid);
  const shown = (l: LessonDoc | undefined): l is LessonDoc => !!l && (filter === "all" || l.status === filter);
  const counts = { draft: lessons.filter((l) => l.status === "draft").length, approved: lessons.filter((l) => l.status === "approved").length, rejected: lessons.filter((l) => l.status === "rejected").length };

  async function decide(l: LessonDoc, action: "approve" | "reject") {
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, topicId: l.topicId }) });
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
        {run.subject}: {lessons.length} lesson(s) · {counts.draft} awaiting you · {counts.approved} approved · {counts.rejected} rejected
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ ...input, width: "auto" }} aria-label="Filter lessons">
          <option value="all">All lessons</option>
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
      {lessons.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No lessons yet. Use Develop lessons or Choose lessons on the run page.</p>}

      <div className="space-y-5">
        {run.sections.filter((s) => s.selected).map((s) => {
          const subs = s.subsections.map((ss) => ({ ss, rows: topics.filter((t) => t.subsectionId === ss.id).map((t) => ({ t, l: lessonOf(t.id) })).filter((r) => shown(r.l)) })).filter((x) => x.rows.length > 0);
          if (subs.length === 0) return null;
          return (
            <section key={s.id}>
              <h2 className="text-lg mb-1" style={{ color: "var(--text-primary)" }}>{s.id} · {s.title}</h2>
              {subs.map(({ ss, rows }) => (
                <div key={ss.id} className="mb-4">
                  <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>{ss.id} · {ss.title}</h3>
                  <div className="space-y-1.5">
                    {rows.map(({ t, l }) => (
                      <div key={t.id}>
                        <p className="text-xs mb-0.5" style={{ color: "var(--text-muted)" }}>{t.id}{t.groupTitle ? ` · ${t.groupTitle}` : ""}</p>
                        <LessonCard key={`${l!.id}-${openAll}`} c={l!} onDecide={decide} defaultOpen={openAll % 2 === 1} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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

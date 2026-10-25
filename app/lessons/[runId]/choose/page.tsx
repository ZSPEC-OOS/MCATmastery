"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../../_components/LessonsNavbar";
import { ACCENT, btn, card, fetcher } from "../../_components/ui";
import type { LessonDoc, LessonTopic, LessonsRun } from "../../../../lib/lessons/types";

interface Detail { run: Omit<LessonsRun, "sourceText">; topics: LessonTopic[]; lessons: LessonDoc[] }

// Choose individual topics to develop lessons for.
export default function ChooseLessons() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const { data, error } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (error) return <Shell runId={runId}><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell runId={runId}><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, topics, lessons } = data;
  const lessonOf = (tid: string) => lessons.find((l) => l.topicId === tid);
  const toggle = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const rewrite = [...picked].filter((id) => lessonOf(id)).length;

  async function develop() {
    if (rewrite > 0 && !confirm(`${rewrite} selected topic(s) already have a lesson. It will be replaced by a new draft. Continue?`)) return;
    setBusy(true); setNotice("");
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", topicIds: [...picked] }) });
    const d = await res.json();
    if (!res.ok) { setNotice(d.error ?? "Could not start"); setBusy(false); return; }
    if (d.queued === 0) { setNotice("Nothing was queued: the chosen topics already have a lesson in progress."); setBusy(false); return; }
    router.push(`/lessons/${runId}?autostart=1`);
  }

  return (
    <Shell runId={runId}>
      <h1 className="text-2xl mb-1" style={{ color: "var(--text-primary)" }}>Choose lessons</h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{run.subject}: tick the topics to write reading lessons for, then develop them.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button style={btn("ghost")} onClick={() => toggle(topics.map((t) => t.id), true)}>Select all</button>
        <button style={btn("ghost")} onClick={() => toggle(topics.filter((t) => !lessonOf(t.id)).map((t) => t.id), true)}>Select topics without a lesson</button>
        <button style={btn("ghost")} onClick={() => setPicked(new Set())}>Clear</button>
        <span className="flex-1" />
        <button style={btn("primary", busy || picked.size === 0)} disabled={busy || picked.size === 0} onClick={develop}>
          {busy ? "Queuing…" : `Develop selected (${picked.size})`}
        </button>
      </div>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}

      <div className="space-y-5">
        {run.sections.filter((s) => s.selected).map((s) => (
          <section key={s.id}>
            <h2 className="text-lg mb-1" style={{ color: "var(--text-primary)" }}>{s.id} · {s.title}</h2>
            {s.subsections.map((ss) => {
              const rows = topics.filter((t) => t.subsectionId === ss.id);
              const ids = rows.map((t) => t.id);
              const all = ids.length > 0 && ids.every((i) => picked.has(i));
              return (
                <div key={ss.id} className="mb-3" style={card}>
                  <label className="flex items-center gap-2 p-3 text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                    <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                    {ss.id} · {ss.title}
                  </label>
                  <ul className="px-3 pb-2">
                    {rows.map((t) => {
                      const l = lessonOf(t.id);
                      return (
                        <li key={t.id}>
                          <label className="flex items-start gap-2 py-1.5 text-sm" style={{ color: "var(--text-primary)" }}>
                            <input type="checkbox" className="mt-1" checked={picked.has(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} />
                            <span className="flex-1">
                              {t.groupTitle && <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{t.groupTitle}</span>}
                              {t.title}
                            </span>
                            <span className="text-xs" style={{ color: l ? ACCENT : "var(--text-muted)" }}>{l ? `lesson ${l.status}` : "no lesson"}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}
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

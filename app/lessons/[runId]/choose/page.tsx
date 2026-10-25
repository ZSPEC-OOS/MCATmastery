"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../../_components/LessonsNavbar";
import { ACCENT, btn, card, fetcher } from "../../_components/ui";
import type { Lesson, LessonsRun } from "../../../../lib/lessons/types";

interface Detail { run: Omit<LessonsRun, "sourceText">; lessons: Lesson[] }

// Choose individual lessons (subsections) to develop. Every part of a chosen lesson is written again.
export default function ChooseLessons() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const { data, error } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (error) return <Shell runId={runId}><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell runId={runId}><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, lessons } = data;
  const written = (l: Lesson) => l.parts.filter((p) => p.part).length;
  const toggle = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const rewrite = lessons.filter((l) => picked.has(l.subsectionId) && written(l) > 0).length;

  async function develop() {
    if (rewrite > 0 && !confirm(`${rewrite} selected lesson(s) already have written parts. They will be written again, and the AI check and any decision are cleared. Continue?`)) return;
    setBusy(true); setNotice("");
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue", subsectionIds: [...picked] }) });
    const d = await res.json();
    if (!res.ok) { setNotice(d.error ?? "Could not start"); setBusy(false); return; }
    if (d.queued === 0) { setNotice("Nothing was queued: the chosen lessons are already queued or running."); setBusy(false); return; }
    router.push(`/lessons/${runId}`);
  }

  return (
    <Shell runId={runId}>
      <h1 className="text-2xl mb-1" style={{ color: "var(--text-primary)" }}>Add lessons</h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{run.subject}: tick the lessons (subsections) to add to this run, or to write again. They are queued only; nothing runs until you press Start on the run page.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button style={btn("ghost")} onClick={() => toggle(lessons.map((l) => l.subsectionId), true)}>Select all</button>
        <button style={btn("ghost")} onClick={() => toggle(lessons.filter((l) => written(l) === 0).map((l) => l.subsectionId), true)}>Select lessons not written</button>
        <button style={btn("ghost")} onClick={() => setPicked(new Set())}>Clear</button>
        <span className="flex-1" />
        <button style={btn("primary", busy || picked.size === 0)} disabled={busy || picked.size === 0} onClick={develop}>
          {busy ? "Queuing…" : `Queue selected (${picked.size})`}
        </button>
      </div>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}

      <div className="space-y-5">
        {run.sections.filter((s) => s.selected).map((s) => {
          const mine = lessons.filter((l) => l.sectionId === s.id);
          const ids = mine.map((l) => l.subsectionId);
          const all = ids.length > 0 && ids.every((i) => picked.has(i));
          return (
            <section key={s.id}>
              <label className="flex items-center gap-2 text-lg mb-1" style={{ color: "var(--text-primary)" }}>
                <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                {s.id} · {s.title}
              </label>
              <div className="mb-3" style={card}>
                <ul className="px-3 py-2">
                  {mine.map((l) => (
                    <li key={l.subsectionId}>
                      <label className="flex items-start gap-2 py-1.5 text-sm" style={{ color: "var(--text-primary)" }}>
                        <input type="checkbox" className="mt-1" checked={picked.has(l.subsectionId)} onChange={(e) => toggle([l.subsectionId], e.target.checked)} />
                        <span className="flex-1"><span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{l.subsectionId}</span>{l.title}</span>
                        <span className="text-xs whitespace-nowrap" style={{ color: written(l) > 0 ? ACCENT : "var(--text-muted)" }}>{written(l)}/{l.parts.length} parts · {l.status === "not_started" ? (l.inRun ? "queued" : "not in run") : l.status.replace("_", " ")}</span>
                      </label>
                    </li>
                  ))}
                </ul>
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

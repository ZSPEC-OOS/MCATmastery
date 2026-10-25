"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../_components/LessonsNavbar";
import LessonCard from "../_components/LessonCard";
import { ACCENT, btn, card, fetcher, input } from "../_components/ui";
import type { Lesson, LessonsRun } from "../../../lib/lessons/types";
import type { Progress } from "../../../lib/lessons/engine";

interface Detail {
  run: Omit<LessonsRun, "sourceText">;
  lessons: Lesson[];
  failedTasks: { id: string; stage: string; targetId: string; error?: string }[];
  progress: Progress;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, mutate } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [running, setRunning] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [log, setLog] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [dlMode, setDlMode] = useState<"all" | "selected">("all");
  const [dlApproved, setDlApproved] = useState(false);
  const [dlPick, setDlPick] = useState<Set<string>>(new Set());
  const live = useRef(false);
  const lastMutate = useRef(0);

  useEffect(() => () => { live.current = false; }, []);

  const addLog = useCallback((line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 12)), []);

  // The loop that does the work: one step per request, saved after every step. Nothing calls it until you press Start.
  const runLoop = useCallback(async () => {
    if (live.current) return;
    live.current = true; setRunning(true);
    const worker = async () => {
      let errors = 0;
      while (live.current) {
        let d: { ran: { stage: string; targetId: string; outcome: string } | null; error?: string; progress: Progress; };
        try {
          const res = await fetch(`/api/lessons/runs/${runId}/advance`, { method: "POST" });
          d = await res.json();
          if (!res.ok) throw new Error((d as unknown as { error: string }).error);
        } catch (e) {
          errors++; addLog(`Request failed: ${e instanceof Error ? e.message : "error"}`);
          if (errors >= 3) break;
          await sleep(3000); continue;
        }
        if (!d.ran) {
          if (d.progress.active) { await sleep(2500); continue; } // other workers busy, or a step is backing off
          break;
        }
        addLog(`${d.ran.stage === "review" ? "AI check" : "write"} ${d.ran.targetId}: ${d.ran.outcome}${d.error ? ` — ${d.error.slice(0, 140)}` : ""}`);
        errors = d.ran.outcome === "done" ? 0 : errors + (d.ran.outcome === "failed" ? 0 : 1);
        if (errors >= 3) { addLog("Stopped after repeated errors. Check the model in Admin → Settings."); break; }
        if (Date.now() - lastMutate.current > 1500) { lastMutate.current = Date.now(); mutate(); }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    live.current = false; setRunning(false); mutate();
  }, [runId, concurrency, mutate, addLog]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    return { ok: res.ok, d: await res.json() };
  }

  async function onStart() {
    setNotice("");
    const { ok, d } = await post("start");
    if (!ok) { setNotice(d.error ?? "Could not start"); return; }
    await mutate();
    runLoop();
  }

  async function onPause() {
    live.current = false;                 // this page stops after the step in flight
    await post("pause");                  // and nothing else (another tab) picks up new work
    setNotice("Paused. A step already in progress will finish first. Press Resume to continue.");
    mutate();
  }

  async function onStop() {
    if (!confirm("Stop? Everything still queued is dropped. Parts already written are kept, and a step in progress finishes. You can add lessons again later.")) return;
    live.current = false;
    const { ok, d } = await post("stop");
    setNotice(ok ? `Stopped. ${d.dropped ?? 0} queued step(s) dropped.` : (d.error ?? "Could not stop"));
    mutate();
  }

  async function decide(l: Lesson, action: "approve" | "reject") {
    const { ok, d } = await post(action, { subsectionId: l.subsectionId });
    if (!ok) setNotice(d.error ?? "Could not record the decision");
    mutate();
  }

  async function queueOne(l: Lesson) {
    const { ok, d } = await post("queue", { subsectionIds: [l.subsectionId] });
    setNotice(ok ? `${d.queued} part(s) queued for ${l.subsectionId}. Press ${paused || phase === "stopped" ? "Resume" : "Start"} to write ${d.queued === 1 ? "it" : "them"}.` : (d.error ?? "Could not queue"));
    await mutate();
  }

  function download() {
    const q = new URLSearchParams();
    if (dlApproved) q.set("approved", "1");
    if (dlMode === "selected") q.set("lessons", [...dlPick].join(","));
    window.location.href = `/api/lessons/runs/${runId}/export${q.toString() ? `?${q}` : ""}`;
    setDlOpen(false);
  }

  async function confirmAll() {
    const { ok, d } = await post("approve_all");
    setNotice(ok ? `Confirmed ${d.approved ?? 0} AI-approved lesson(s).` : (d.error ?? "Could not confirm"));
    mutate();
  }

  async function retry() {
    await fetch(`/api/lessons/runs/${runId}/retry`, { method: "POST" });
    mutate();
  }

  if (error) return <Shell><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, lessons, progress, failedTasks } = data;
  const L = progress.lessons;
  const waiting = progress.tasks.lesson.queued + progress.tasks.lesson.running + progress.tasks.review.queued + progress.tasks.review.running;
  const paused = run.lessonsPaused === true;

  // One honest status for the whole run.
  const unfinished = lessons.filter((l) => l.inRun && (l.status === "incomplete" || l.status === "checking")).length;
  const phase = running ? "running" : paused ? "paused" : progress.active ? "ready" : unfinished > 0 ? "stopped" : L.inRun === 0 ? "empty" : "finished";
  const finished = phase === "finished";
  const statusText: Record<string, string> = {
    running: "Running. Keep this page open; it is safe to pause.",
    paused: `Paused. ${waiting} step${waiting === 1 ? "" : "s"} waiting. Press Resume to continue.`,
    ready: `Ready. ${L.inRun} lesson${L.inRun === 1 ? "" : "s"} chosen (${L.partsTotal} parts). Nothing runs until you press Start.`,
    stopped: `Stopped. ${unfinished} lesson${unfinished === 1 ? " is" : "s are"} not finished. Press Start to continue ${unfinished === 1 ? "it" : "them"}.`,
    empty: "No lessons chosen yet. Open a lesson below and choose Add to run.",
    finished: "Finished. Everything chosen has been written and checked.",
  };
  const approvedCount = L.aiApproved + L.approved;
  const pct = L.partsTotal ? Math.round((L.partsDone / L.partsTotal) * 100) : 0;

  return (
    <Shell>
      <div className="mb-4">
        <Link href="/lessons" className="text-xs" style={{ color: "var(--text-muted)" }}>← All runs</Link>
        <h1 className="text-2xl" style={{ color: "var(--text-primary)" }}>{run.subject}</h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>One lesson per subsection · started {new Date(run.createdAt).toLocaleString()}</p>
      </div>

      <section className="p-4 mb-4 space-y-3" style={card} aria-label="Run controls">
        <div className="flex flex-wrap items-center gap-2">
          <button style={btn("primary", running || phase === "empty" || phase === "finished")} disabled={running || phase === "empty" || phase === "finished"} onClick={onStart}>
            {paused || phase === "stopped" ? "Resume" : "Start"}
          </button>
          <button style={btn("ghost", !running)} disabled={!running} onClick={onPause}>Pause</button>
          <button style={btn("danger", !(progress.active || paused))} disabled={!(progress.active || paused)} onClick={onStop}>Stop</button>
          <span className="flex-1" />
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Parallel
            <select value={concurrency} disabled={running} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ ...input, width: 64, marginLeft: 6, padding: "6px 8px" }}>
              {[1, 2, 3].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <p className="text-sm" style={{ color: phase === "running" ? ACCENT : "var(--text-secondary)" }}>{statusText[phase]}</p>

        {L.inRun > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              <span>Parts written</span><span>{L.partsDone}/{L.partsTotal}</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: "var(--bg-input)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: ACCENT }} /></div>
            <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
              {L.complete}/{L.inRun} lessons written · {approvedCount} approved{L.checking > 0 ? ` · ${L.checking} awaiting AI check` : ""}{L.flagged > 0 ? ` · ${L.flagged} flagged for you` : ""}{L.rejected > 0 ? ` · ${L.rejected} rejected` : ""}
            </p>
          </div>
        )}

        <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="text-xs font-semibold" style={{ color: "var(--text-muted)" }} aria-expanded={advanced || phase === "empty"} onClick={() => setAdvanced((v) => !v)}>
            Advanced {advanced || phase === "empty" ? "▾" : "▸"}
          </button>
          {(advanced || phase === "empty") && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button style={btn("ghost", L.aiApproved === 0)} disabled={L.aiApproved === 0} onClick={confirmAll}>Confirm all AI-approved ({L.aiApproved})</button>
              <button style={btn("ghost")} aria-expanded={dlOpen} onClick={() => setDlOpen((v) => !v)}>Download {dlOpen ? "▾" : "▸"}</button>
              {dlOpen && (
                <div className="basis-full p-3 space-y-2 text-sm" style={{ border: "1px solid var(--border)", borderRadius: 12, color: "var(--text-secondary)" }}>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2"><input type="radio" name="dl" checked={dlMode === "all"} onChange={() => setDlMode("all")} />All lessons</label>
                    <label className="flex items-center gap-2"><input type="radio" name="dl" checked={dlMode === "selected"} onChange={() => setDlMode("selected")} />Selected lessons</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={dlApproved} onChange={(e) => setDlApproved(e.target.checked)} />Approved only</label>
                  </div>
                  {dlMode === "selected" && (
                    <ul className="max-h-56 overflow-y-auto space-y-1">
                      {lessons.filter((l) => l.status !== "not_started" && l.status !== "writing" && l.status !== "incomplete").map((l) => (
                        <li key={l.subsectionId}>
                          <label className="flex items-start gap-2">
                            <input type="checkbox" className="mt-1" checked={dlPick.has(l.subsectionId)} onChange={(e) => setDlPick((p) => { const n = new Set(p); if (e.target.checked) n.add(l.subsectionId); else n.delete(l.subsectionId); return n; })} />
                            <span><span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{l.subsectionId}</span>{l.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button style={btn("primary", dlMode === "selected" && dlPick.size === 0)} disabled={dlMode === "selected" && dlPick.size === 0} onClick={download}>
                    Download{dlMode === "selected" ? ` (${dlPick.size})` : ""}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}
      {finished && L.flagged > 0 && <p className="text-sm mb-3" style={{ color: "var(--accent-red)" }}>{L.flagged} lesson(s) still had errors after the AI check and corrections. Open them to decide.</p>}

      {failedTasks.length > 0 && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: "var(--accent-red)" }}>
          <div className="flex items-center justify-between gap-2">
            <b style={{ color: "var(--accent-red)" }}>{failedTasks.length} step(s) failed</b>
            <button style={btn("ghost")} onClick={retry}>Retry failed</button>
          </div>
          <ul className="mt-2 text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
            {failedTasks.slice(0, 5).map((t) => <li key={t.id}><code>{t.id}</code> — {t.error}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        {run.sections.filter((s) => s.selected).map((s) => (
          <section key={s.id}>
            <h2 className="text-lg mb-1" style={{ color: "var(--text-primary)" }}>{s.id} · {s.title}</h2>
            {s.coverageSummary && <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{s.coverageSummary}</p>}
            {s.declaredGaps && s.declaredGaps.length > 0 && (
              <p className="text-xs mb-2" style={{ color: "#d97706" }}>Gaps declared by the planner: {s.declaredGaps.map((g) => g.description).join("; ")}</p>
            )}
            <div className="space-y-1.5">
              {lessons.filter((l) => l.sectionId === s.id).map((l) => <LessonCard key={l.subsectionId} lesson={l} onDecide={decide} onQueue={queueOne} />)}
            </div>
          </section>
        ))}
      </div>

      {log.length > 0 && (
        <pre className="mt-6 p-3 text-xs overflow-x-auto" style={{ ...card, color: "var(--text-muted)" }}>{log.join("\n")}</pre>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <main className="max-w-6xl mx-auto w-full px-4 md:px-6 py-6 flex-1">{children}</main>
    </div>
  );
}

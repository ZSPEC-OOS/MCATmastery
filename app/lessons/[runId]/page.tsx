"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../_components/LessonsNavbar";
import LessonCard from "../_components/LessonCard";
import { ACCENT, btn, card, fetcher, input } from "../_components/ui";
import type { LessonDoc, LessonTopic, LessonsRun } from "../../../lib/lessons/types";
import type { Progress } from "../../../lib/lessons/engine";

interface Detail {
  run: Omit<LessonsRun, "sourceText">;
  topics: LessonTopic[];
  lessons: LessonDoc[];
  failedTasks: { id: string; stage: string; targetId: string; error?: string }[];
  progress: Progress;
}

const STAGES: { key: keyof Progress["tasks"]; label: string }[] = [
  { key: "plan", label: "Topic plans" }, { key: "expand", label: "Topic splits" }, { key: "lesson", label: "Lessons" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, mutate } = useSWR<Detail>(`/api/lessons/runs/${runId}`, fetcher);
  const [running, setRunning] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [log, setLog] = useState<string[]>([]);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const live = useRef(false);
  const lastMutate = useRef(0);

  useEffect(() => () => { live.current = false; }, []);

  const addLog = useCallback((line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 12)), []);

  const start = useCallback(async () => {
    if (live.current) return;
    live.current = true; setRunning(true); setNotice("");
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
          if (d.progress.active) { await sleep(2500); continue; } // other workers busy, or a task is backing off
          break;
        }
        addLog(`${d.ran.stage} ${d.ran.targetId}: ${d.ran.outcome}${d.error ? ` — ${d.error.slice(0, 140)}` : ""}`);
        errors = d.ran.outcome === "done" ? 0 : errors + (d.ran.outcome === "failed" ? 0 : 1);
        if (errors >= 3) { addLog("Stopped after repeated errors. Check the model in Admin → Settings."); break; }
        if (Date.now() - lastMutate.current > 1500) { lastMutate.current = Date.now(); mutate(); }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    live.current = false; setRunning(false); mutate();
  }, [runId, concurrency, mutate, addLog]);

  const pause = () => { live.current = false; };

  // The topic-chooser page sends you here with ?autostart=1 after queuing topics.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !data || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("autostart") !== "1") return;
    autoStarted.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (data.progress.active) start();
  }, [data, start]);

  async function decide(c: LessonDoc, action: "approve" | "reject") {
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, topicId: c.topicId }) });
    if (!res.ok) setNotice((await res.json()).error ?? "Could not record the decision");
    mutate();
  }

  async function lessonAction(action: "start" | "pause" | "resume" | "stop" | "approve_all") {
    if (action === "stop" && !confirm("Stop lessons? Lessons not yet started are dropped and automatic lessons switch off. Lessons already written are kept.")) return;
    const res = await fetch(`/api/lessons/runs/${runId}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const d = await res.json();
    if (!res.ok) { setNotice(d.error ?? "Could not update lessons"); return; }
    setNotice(
      action === "start" ? `Lessons switched on: ${d.queued} topic(s) queued. Topics split later are added automatically.`
        : action === "pause" ? "Lessons paused. Planning and splitting are unaffected."
          : action === "resume" ? "Lessons resumed."
            : action === "stop" ? `Lessons stopped: ${d.dropped ?? 0} queued lesson(s) dropped.`
              : `Approved ${d.approved ?? 0} lesson(s).`,
    );
    await mutate();
    if ((action === "start" && d.queued > 0) || action === "resume") start();
  }

  async function retry() {
    await fetch(`/api/lessons/runs/${runId}/retry`, { method: "POST" });
    mutate();
  }

  if (error) return <Shell><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, topics, lessons, progress, failedTasks } = data;
  const lessonOf = (tid: string) => lessons.find((l) => l.topicId === tid);
  const unfinished = progress.active;
  const lt = progress.tasks.lesson;
  const lessonsPending = lt.queued + lt.running;
  const autoOn = run.autoLessons !== false;
  const splitsDone = progress.tasks.expand.done > 0;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <Link href="/lessons" className="text-xs" style={{ color: "var(--text-muted)" }}>← All runs</Link>
          <h1 className="text-2xl" style={{ color: "var(--text-primary)" }}>{run.subject}</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Reading lessons · started {new Date(run.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Parallel
            <select value={concurrency} disabled={running} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ ...input, width: 64, marginLeft: 6, padding: "6px 8px" }}>
              {[1, 2, 3].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          {running
            ? <button style={btn("ghost")} onClick={pause}>Pause</button>
            : <button style={btn("primary", !unfinished)} disabled={!unfinished} onClick={start}>{unfinished ? "Run" : "Finished"}</button>}
        </div>
      </div>

      {unfinished && !running && (
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Work remains. Press <b>Run</b> to continue. Progress is saved after every step, so you can pause or close this page at any time.
        </p>
      )}
      {running && <p className="text-sm mb-3" style={{ color: ACCENT }}>Running. Keep this page open. It is safe to pause.</p>}

      <section className="grid gap-3 sm:grid-cols-3 mb-4">
        {STAGES.map(({ key, label }) => {
          const t = progress.tasks[key];
          const total = t.queued + t.running + t.done + t.failed;
          const pct = total ? Math.round((t.done / total) * 100) : 0;
          return (
            <div key={key} className="p-3" style={card}>
              <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}><span>{label}</span><span>{t.done}/{total}</span></div>
              <div className="h-1.5 rounded-full mt-2" style={{ background: "var(--bg-input)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: ACCENT }} /></div>
              {t.failed > 0 && <p className="text-xs mt-1" style={{ color: "var(--accent-red)" }}>{t.failed} failed</p>}
            </div>
          );
        })}
      </section>

      <section className="p-3 mb-4 flex flex-wrap items-center gap-2" style={card} aria-label="Lessons toolbar">
        <span className="text-sm font-semibold mr-1" style={{ color: "var(--text-primary)" }}>Lessons</span>
        <span className="text-xs mr-2" style={{ color: "var(--text-muted)" }}>
          {progress.lessons.written} written · {progress.lessons.approved} approved · {progress.lessons.draft} awaiting you
          {lessonsPending > 0 ? ` · ${lessonsPending} left` : ""}{run.lessonsPaused ? " · paused" : ""}{!autoOn ? " · automatic lessons off" : ""}
        </span>
        <span className="flex-1" />
        {splitsDone && (!autoOn || (lessonsPending === 0 && !run.lessonsPaused)) && <button style={btn("primary")} onClick={() => lessonAction("start")}>Develop lessons</button>}
        {!run.lessonsPaused && lessonsPending > 0 && <button style={btn("ghost")} onClick={() => lessonAction("pause")}>Pause lessons</button>}
        {run.lessonsPaused && <button style={btn("primary")} onClick={() => lessonAction("resume")}>Resume lessons</button>}
        {lt.queued > 0 && <button style={btn("danger")} onClick={() => lessonAction("stop")}>Stop</button>}
        <button style={btn("ghost", progress.lessons.draft === 0)} disabled={progress.lessons.draft === 0} onClick={() => lessonAction("approve_all")}>Approve all lessons</button>
        <Link href={`/lessons/${runId}/choose`} style={{ ...btn("ghost"), textDecoration: "none" }}>Choose lessons</Link>
        <Link href={`/lessons/${runId}/read`} style={{ ...btn("ghost"), textDecoration: "none" }}>Read lessons</Link>
        <a style={{ ...btn("ghost"), textDecoration: "none" }} href={`/api/lessons/runs/${runId}/export?approved=1`}>Download approved</a>
        <a style={{ ...btn("ghost"), textDecoration: "none" }} href={`/api/lessons/runs/${runId}/export`}>Download everything</a>
      </section>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}

      {failedTasks.length > 0 && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: "var(--accent-red)" }}>
          <div className="flex items-center justify-between gap-2">
            <b style={{ color: "var(--accent-red)" }}>{failedTasks.length} task(s) failed</b>
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
            {!s.planned && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Not planned yet.</p>}
            {s.coverageSummary && <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{s.coverageSummary}</p>}
            {s.declaredGaps && s.declaredGaps.length > 0 && (
              <p className="text-xs mb-2" style={{ color: "#d97706" }}>Gaps declared by the planner: {s.declaredGaps.map((g) => g.description).join("; ")}</p>
            )}
            {s.subsections.map((ss) => (
              <div key={ss.id} className="mb-4">
                <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-roboto), system-ui, sans-serif" }}>{ss.id} · {ss.title}</h3>
                <div className="space-y-1.5">
                  {topics.filter((t) => t.subsectionId === ss.id).map((t) => {
                    const lesson = lessonOf(t.id);
                    const open = openTopic === t.id;
                    return (
                      <div key={t.id} style={card}>
                        <button className="w-full text-left p-3 flex items-center gap-2" onClick={() => setOpenTopic(open ? null : t.id)}>
                          <span className="text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: 96 }}>{t.id}</span>
                          <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {t.groupTitle && <span className="block text-xs font-normal" style={{ color: "var(--text-muted)" }}>{t.groupTitle}</span>}
                            {t.title}
                          </span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{lesson ? `lesson ${lesson.status}` : "no lesson yet"}</span>
                        </button>
                        {open && (
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}><b>Scope:</b> {t.scope} <b>Target:</b> {t.primaryLearningTarget}</p>
                            {lesson && <LessonCard key={lesson.id} c={lesson} onDecide={decide} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import CodexNavbar from "../_components/CodexNavbar";
import QuestionCard from "../_components/QuestionCard";
import LessonCard from "../_components/LessonCard";
import { TEAL, btn, card, fetcher, input } from "../_components/ui";
import { DEPTH_LABELS, contentOn } from "../../../lib/codex/types";
import type { CodexContent, CodexQuestion, CodexRun, CodexTopic } from "../../../lib/codex/types";
import type { Progress } from "../../../lib/codex/engine";

interface Detail {
  run: Omit<CodexRun, "sourceText">;
  topics: CodexTopic[];
  questions: CodexQuestion[];
  failedTasks: { id: string; stage: string; targetId: string; error?: string }[];
  progress: Progress;
  content: CodexContent[];
  bankBlockers: string[];
}

const STAGES: { key: keyof Progress["tasks"]; label: string }[] = [
  { key: "plan", label: "Topic plans" }, { key: "expand", label: "Topic splits" }, { key: "content", label: "Lessons" }, { key: "parent", label: "Parent questions" }, { key: "atomic", label: "Atomic sets" }, { key: "verify", label: "Verification" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data, error, mutate } = useSWR<Detail>(`/api/codex/runs/${runId}`, fetcher);
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
          const res = await fetch(`/api/codex/runs/${runId}/advance`, { method: "POST" });
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

  async function decide(q: CodexQuestion, action: "approve" | "reject", override = false) {
    const res = await fetch(`/api/codex/runs/${runId}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, questionId: q.id, override }) });
    if (!res.ok) setNotice((await res.json()).error ?? "Could not record the decision");
    mutate();
  }

  async function approvePassed() {
    const res = await fetch(`/api/codex/runs/${runId}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_passed" }) });
    const d = await res.json();
    setNotice(`Approved ${d.approved ?? 0} question(s) that passed AI review.`);
    mutate();
  }

  async function retry() {
    await fetch(`/api/codex/runs/${runId}/retry`, { method: "POST" });
    mutate();
  }

  async function startLessons() {
    const res = await fetch(`/api/codex/runs/${runId}/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
    const d = await res.json();
    setNotice(res.ok ? `Lessons switched on: ${d.queued} topic(s) queued. Press Run to develop them; topics split later are added automatically.` : (d.error ?? "Could not start lessons"));
    mutate();
  }

  async function decideLesson(c: CodexContent, action: "approve" | "reject") {
    const res = await fetch(`/api/codex/runs/${runId}/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, topicId: c.topicId }) });
    if (!res.ok) setNotice((await res.json()).error ?? "Could not record the decision");
    mutate();
  }

  async function approveLessons() {
    const res = await fetch(`/api/codex/runs/${runId}/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_all" }) });
    const d = await res.json();
    setNotice(res.ok ? `Approved ${d.approved ?? 0} lesson(s).` : (d.error ?? "Could not approve"));
    mutate();
  }

  async function saveToDatabase() {
    if (!confirm("Save this run's approved questions to the database? The run will be locked and its sections will disappear from the new-run list until you remove it from the database.")) return;
    setNotice("Saving to the database…");
    const res = await fetch(`/api/codex/runs/${runId}/bank`, { method: "POST" });
    const d = await res.json();
    setNotice(res.ok ? `Saved ${d.questions} question(s) to the database. This run is now locked.` : (d.errors ?? [d.error]).join(" "));
    mutate();
  }

  async function removeFromDatabase() {
    if (!confirm("Remove this run's questions from the database? The run unlocks and its sections return to the new-run list.")) return;
    const res = await fetch(`/api/codex/runs/${runId}/bank`, { method: "DELETE" });
    const d = await res.json();
    setNotice(res.ok ? `Removed ${d.removed} question(s) from the database. This run is unlocked.` : (d.error ?? "Could not remove"));
    mutate();
  }

  async function saveToFirebase(approved: boolean) {
    setNotice("Saving to Firebase Storage…");
    const res = await fetch(`/api/codex/runs/${runId}/export?save=1${approved ? "&approved=1" : ""}`);
    const d = await res.json();
    setNotice(res.ok ? `Saved to Firebase Storage: ${d.saved.path}` : (d.error ?? "Could not save"));
  }

  if (error) return <Shell><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, topics, questions, progress, failedTasks, bankBlockers, content } = data;
  const lessonsOn = contentOn(run);
  const contentRun = run.depth === "content";
  const lessonOf = (tid: string) => content.find((c) => c.topicId === tid);
  const lessonCounts = { written: content.length, approved: content.filter((c) => c.status === "approved").length, draft: content.filter((c) => c.status === "draft").length };
  const banked = run.banked;
  const current = (qid: string) => questions.find((q) => q.qid === qid && q.current);
  const atomsOf = (id: string) => questions.filter((q) => q.parentId === id).sort((a, b) => a.qid.localeCompare(b.qid, undefined, { numeric: true }));
  const counts = progress.questions;
  const unfinished = progress.active && !banked;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <Link href="/codex" className="text-xs" style={{ color: "var(--text-muted)" }}>← All runs</Link>
          <h1 className="text-2xl" style={{ color: "var(--text-primary)" }}>{run.subject}</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{DEPTH_LABELS[run.depth]} · started {new Date(run.createdAt).toLocaleString()}</p>
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

      {banked && (
        <div className="p-3 mb-4 text-sm flex flex-wrap items-center justify-between gap-2" style={{ ...card, borderColor: TEAL }}>
          <span style={{ color: "var(--text-secondary)" }}>
            <b style={{ color: TEAL }}>In the database</b> · {banked.questions} question(s) saved {new Date(banked.at).toLocaleString()}. This run is locked and its sections are hidden from the new-run list.
          </span>
          <button style={btn("ghost")} onClick={removeFromDatabase}>Remove from database</button>
        </div>
      )}

      {unfinished && !running && (
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Work remains. Press <b>Run</b> to continue — progress is saved after every step, so you can pause or close this page at any time.
        </p>
      )}
      {running && <p className="text-sm mb-3" style={{ color: TEAL }}>Running — keep this page open. It is safe to pause.</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
        {STAGES.filter(({ key }) => (key === "content" ? lessonsOn : contentRun ? key === "plan" || key === "expand" : true)).map(({ key, label }) => {
          const t = progress.tasks[key];
          const total = t.queued + t.running + t.done + t.failed;
          const pct = total ? Math.round((t.done / total) * 100) : 0;
          return (
            <div key={key} className="p-3" style={card}>
              <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}><span>{label}</span><span>{t.done}/{total}</span></div>
              <div className="h-1.5 rounded-full mt-2" style={{ background: "var(--bg-input)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: TEAL }} /></div>
              {t.failed > 0 && <p className="text-xs mt-1" style={{ color: "var(--accent-red)" }}>{t.failed} failed</p>}
              {key === "expand" && !lessonsOn && !banked && t.done > 0 && (
                <div className="mt-2">
                  <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={startLessons}>Develop content</button>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Optional: write a reading lesson for each split topic.</p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {failedTasks.length > 0 && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: "var(--accent-red)" }}>
          <div className="flex items-center justify-between gap-2">
            <b style={{ color: "var(--accent-red)" }}>{failedTasks.length} task(s) failed</b>
            <button style={btn("ghost", !!banked)} disabled={!!banked} onClick={retry}>Retry failed</button>
          </div>
          <ul className="mt-2 text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
            {failedTasks.slice(0, 5).map((t) => <li key={t.id}><code>{t.id}</code> — {t.error}</li>)}
          </ul>
        </div>
      )}

      <section className="p-3 mb-4 flex flex-wrap items-center gap-2" style={card}>
        {!contentRun && (
          <span className="text-sm mr-2" style={{ color: "var(--text-secondary)" }}>
            <b>{counts.approved}</b> approved · <b>{counts.auto_passed}</b> awaiting you · <b>{counts.flagged}</b> flagged · <b>{counts.rejected}</b> rejected
          </span>
        )}
        {lessonsOn && (
          <span className="text-sm mr-2" style={{ color: "var(--text-secondary)" }}>
            Lessons: <b>{lessonCounts.written}</b> written · <b>{lessonCounts.approved}</b> approved · <b>{lessonCounts.draft}</b> awaiting you
          </span>
        )}
        <span className="flex-1" />
        {lessonsOn && <button style={btn("ghost", lessonCounts.draft === 0 || !!banked)} disabled={lessonCounts.draft === 0 || !!banked} onClick={approveLessons}>Approve all lessons</button>}
        {!contentRun && <button style={btn("ghost", counts.auto_passed === 0 || !!banked)} disabled={counts.auto_passed === 0 || !!banked} onClick={approvePassed}>Approve all that passed AI review</button>}
        <a style={{ ...btn("ghost"), textDecoration: "none" }} href={`/api/codex/runs/${runId}/export?approved=1`}>Download approved</a>
        <a style={{ ...btn("ghost"), textDecoration: "none" }} href={`/api/codex/runs/${runId}/export`}>Download everything</a>
        {!contentRun && <button style={btn("ghost", counts.approved === 0)} disabled={counts.approved === 0} onClick={() => saveToFirebase(true)}>Save approved to Firebase</button>}
        {!banked && !contentRun && <button style={btn("primary", bankBlockers.length > 0)} disabled={bankBlockers.length > 0} onClick={saveToDatabase}>Save to database</button>}
        {!banked && !contentRun && bankBlockers.length > 0 && progress.topics > 0 && (
          <ul className="basis-full text-xs list-disc pl-5" style={{ color: "var(--text-muted)" }}>
            {bankBlockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
      </section>
      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}

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
                    const parent = current(t.id);
                    const atoms = atomsOf(t.id);
                    const open = openTopic === t.id;
                    return (
                      <div key={t.id} style={card}>
                        <button className="w-full text-left p-3 flex items-center gap-2" onClick={() => setOpenTopic(open ? null : t.id)}>
                          <span className="text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: 96 }}>{t.id}</span>
                          <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t.groupTitle && <span className="block text-xs font-normal" style={{ color: "var(--text-muted)" }}>{t.groupTitle}</span>}{t.title}</span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {lessonOf(t.id) ? `lesson ${lessonOf(t.id)!.status}` : lessonsOn ? "no lesson yet" : ""}
                            {!contentRun && `${lessonsOn ? " · " : ""}${parent ? `1 parent · ${atoms.length} atomic` : "no question yet"}`}
                          </span>
                        </button>
                        {open && (
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}><b>Scope:</b> {t.scope} <b>Target:</b> {t.primaryLearningTarget}</p>
                            {lessonOf(t.id) && <LessonCard key={lessonOf(t.id)!.id} c={lessonOf(t.id)!} locked={!!banked} onDecide={decideLesson} />}
                            {parent && <QuestionCard key={parent.id} q={parent} onDecide={decide} />}
                            {atoms.length > 0 && <p className="text-xs font-semibold pt-1" style={{ color: "var(--text-muted)" }}>Atomic questions</p>}
                            {atoms.map((a) => <QuestionCard key={a.id} q={a} onDecide={decide} />)}
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
      <CodexNavbar />
      <main className="max-w-6xl mx-auto w-full px-4 md:px-6 py-6 flex-1">{children}</main>
    </div>
  );
}

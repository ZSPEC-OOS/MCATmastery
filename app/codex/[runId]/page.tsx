"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import CodexNavbar from "../_components/CodexNavbar";
import QuestionCard from "../_components/QuestionCard";
import { TEAL, btn, card, fetcher, input } from "../_components/ui";
import { DEPTH_LABELS } from "../../../lib/codex/types";
import type { CodexQuestion, CodexRun, CodexTopic } from "../../../lib/codex/types";
import type { Progress } from "../../../lib/codex/engine";

interface Detail {
  run: Omit<CodexRun, "sourceText">;
  topics: CodexTopic[];
  questions: CodexQuestion[];
  failedTasks: { id: string; stage: string; targetId: string; error?: string }[];
  retrying: { id: string; stage: string; targetId: string; error?: string }[];
  progress: Progress;
  bankBlockers: string[];
  topicSaveBlockers: string[];
}

// Plain names for the steps, in the order they run.
const STEPS: { key: keyof Progress["tasks"]; label: string }[] = [
  { key: "plan", label: "Planning" }, { key: "expand", label: "Splitting" }, { key: "parent", label: "Writing questions" }, { key: "atomic", label: "Atomic sets" }, { key: "verify", label: "AI checks" },
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
  const [advanced, setAdvanced] = useState(false);
  const [dlApproved, setDlApproved] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const live = useRef(false);
  const lastMutate = useRef(0);
  const lastError = useRef("");

  useEffect(() => () => { live.current = false; }, []);

  const addLog = useCallback((line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 12)), []);

  // The loop that does the work: one step per request, saved after every step. Nothing calls it until you press Start.
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
          if (d.progress.active) { await sleep(2500); continue; } // other workers busy, or a step is backing off
          break;
        }
        addLog(`${d.ran.stage} ${d.ran.targetId}: ${d.ran.outcome}${d.error ? ` — ${d.error.slice(0, 140)}` : ""}`);
        if (d.error) lastError.current = `${d.ran.stage} ${d.ran.targetId}: ${d.error.slice(0, 300)}`;
        errors = d.ran.outcome === "done" ? 0 : errors + (d.ran.outcome === "failed" ? 0 : 1);
        if (errors >= 3) {
          addLog("Stopped after repeated errors. Check the model in Admin → Settings.");
          setNotice(`Stopped after repeated errors. ${lastError.current} Check the model in Admin → Settings, then press Resume to try again.`);
          break;
        }
        if (Date.now() - lastMutate.current > 1500) { lastMutate.current = Date.now(); mutate(); }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    live.current = false; setRunning(false); mutate();
  }, [runId, concurrency, mutate, addLog]);

  const pause = () => { live.current = false; setNotice("Pausing. A step already in progress will finish first. Press Resume to continue."); };

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/codex/runs/${runId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, d: await res.json() };
  }

  async function decide(q: CodexQuestion, action: "approve" | "reject", override = false) {
    const { ok, d } = await post("questions", { action, questionId: q.id, override });
    if (!ok) setNotice(d.error ?? "Could not record the decision");
    mutate();
  }

  async function approvePassed() {
    const { d } = await post("questions", { action: "approve_passed" });
    setNotice(`Approved ${d.approved ?? 0} question(s) that passed the AI check.`);
    mutate();
  }

  async function approveDrafts() {
    if (!confirm(`Approve all ${data?.progress.questions.draft ?? 0} unchecked question(s)? No AI check was run on them, so only do this if you have read them or trust them.`)) return;
    const { ok, d } = await post("questions", { action: "approve_drafts" });
    setNotice(ok ? `Approved ${d.approved ?? 0} unchecked question(s). They are ready to practice in Study.` : (d.error ?? "Could not approve"));
    mutate();
  }

  async function retry() {
    await fetch(`/api/codex/runs/${runId}/retry`, { method: "POST" });
    mutate();
  }

  async function saveToDatabase() {
    if (!confirm("Save this run's approved questions to the question database? The run will be locked and its sections will disappear from the new-run list until you remove it from the database.")) return;
    setNotice("Saving to the question database…");
    const { ok, d } = await post("bank", {});
    setNotice(ok ? `Saved ${d.questions} question(s) to the database. This run is now locked.` : (d.errors ?? [d.error]).join(" "));
    mutate();
  }

  async function removeFromDatabase() {
    if (!confirm("Remove this run's questions from the question database? The run unlocks and its sections return to the new-run list.")) return;
    const res = await fetch(`/api/codex/runs/${runId}/bank`, { method: "DELETE" });
    const d = await res.json();
    setNotice(res.ok ? `Removed ${d.removed} question(s) from the database. This run is unlocked.` : (d.error ?? "Could not remove"));
    mutate();
  }

  async function saveTopics() {
    if (!confirm("Save these topics to the topic database? This is permanent: the sections cannot be re-planned or re-split, and they become the shared set that Codex questions and Lessons are built from. The run will be locked.")) return;
    setNotice("Saving to the topic database…");
    const { ok, d } = await post("topic-bank", {});
    setNotice(ok ? `Saved ${d.topics} topic(s) across ${d.sections} section(s) to the topic database. This run is now locked.` : (d.errors ?? [d.error]).join(" "));
    mutate();
  }

  async function saveSnapshot() {
    setNotice("Saving a snapshot to Firebase Storage…");
    const res = await fetch(`/api/codex/runs/${runId}/export?save=1&approved=1`);
    const d = await res.json();
    setNotice(res.ok ? `Saved to Firebase Storage: ${d.saved.path}` : (d.error ?? "Could not save"));
  }

  if (error) return <Shell><p style={{ color: "var(--accent-red)" }}>{error.message}</p></Shell>;
  if (!data) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;

  const { run, topics, questions, progress, failedTasks, retrying, bankBlockers, topicSaveBlockers } = data;
  const topicsRun = run.depth === "topics";
  const banked = run.banked;
  const topicsSaved = run.topicsSaved;
  const locked = !!banked || !!topicsSaved;
  const counts = progress.questions;
  const auto = run.depth === "parentsChecked";                  // writes, checks, approves and saves on its own
  const canSaveQuestions = run.depth === "verified";            // saved with a button (parentsChecked saves itself)
  const unchecked = (run.depth === "parents" || run.depth === "atomics") && counts.draft > 0;
  const current = (qid: string) => questions.find((q) => q.qid === qid && q.current);
  const atomsOf = (id: string) => questions.filter((q) => q.parentId === id).sort((a, b) => a.qid.localeCompare(b.qid, undefined, { numeric: true }));

  // One bar for the whole run, and a line naming each step that has work.
  const steps = STEPS.map((s) => ({ ...s, t: progress.tasks[s.key] })).map((s) => ({ ...s, total: s.t.queued + s.t.running + s.t.done + s.t.failed })).filter((s) => s.total > 0);
  const done = steps.reduce((n, s) => n + s.t.done, 0);
  const total = steps.reduce((n, s) => n + s.total, 0);
  const left = steps.reduce((n, s) => n + s.t.queued + s.t.running, 0);
  const stage = (k: keyof Progress["tasks"]) => { const t = progress.tasks[k]; return { done: t.done, total: t.queued + t.running + t.done + t.failed }; };
  const written = { done: stage("parent").done + stage("atomic").done, total: stage("parent").total + stage("atomic").total };
  const checks = stage("verify");
  const savedTotal = Math.max(progress.saved, progress.topics - counts.rejected);
  const unfinished = progress.active && !locked;
  const phase = locked ? "locked" : running ? "running" : unfinished ? (done > 0 ? "paused" : "ready") : total === 0 ? "empty" : "finished";

  const statusText: Record<string, string> = {
    locked: banked ? (auto ? "Complete. Every question was written, checked, approved and saved to the question database." : "Saved to the question database. This run is locked.") : "Topics saved to the topic database. This run is locked.",
    running: "Running. Keep this page open; it is safe to pause.",
    paused: `Not running. ${left} step${left === 1 ? "" : "s"} left. Press Resume to continue.`,
    ready: auto
      ? `Ready. ${left} step${left === 1 ? "" : "s"} queued. Press Start: questions are written, checked, approved and saved automatically.`
      : `Ready. ${left} step${left === 1 ? "" : "s"} queued. Nothing runs until you press Start.`,
    empty: "Nothing to do.",
    finished: topicsRun
      ? "Finished. Planning and splitting are done. Save the topics to the database to build questions and lessons from them."
      : auto && counts.flagged > 0 ? `Finished. ${counts.flagged} question${counts.flagged === 1 ? " needs" : "s need"} your decision below; once decided ${counts.flagged === 1 ? "it is" : "they are"} saved automatically.`
        : counts.auto_passed + counts.flagged + counts.draft > 0 ? "Finished writing and checking. Some questions are waiting for you below." : "Finished.",
  };

  const summary = topicsRun
    ? `${progress.topics} topic${progress.topics === 1 ? "" : "s"} after splitting`
    : [`${counts.approved} approved`, counts.auto_passed > 0 && `${counts.auto_passed} awaiting you`, counts.draft > 0 && `${counts.draft} unchecked`, counts.flagged > 0 && `${counts.flagged} flagged`, counts.rejected > 0 && `${counts.rejected} rejected`].filter(Boolean).join(" · ");

  const download = () => { window.location.href = `/api/codex/runs/${runId}/export${dlApproved && !topicsRun ? "?approved=1" : ""}`; };

  return (
    <Shell>
      <div className="mb-4">
        <Link href="/codex" className="text-xs" style={{ color: "var(--text-muted)" }}>← All runs</Link>
        <h1 className="text-2xl" style={{ color: "var(--text-primary)" }}>{run.subject}</h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{DEPTH_LABELS[run.depth]} · started {new Date(run.createdAt).toLocaleString()}</p>
      </div>

      {banked && (
        <div className="p-3 mb-4 text-sm flex flex-wrap items-center justify-between gap-2" style={{ ...card, borderColor: TEAL }}>
          <span style={{ color: "var(--text-secondary)" }}>
            <b style={{ color: TEAL }}>In the question database</b> · {banked.questions} question(s) saved {new Date(banked.at).toLocaleString()}. Its sections are hidden from the new-run list.
          </span>
          <button style={btn("ghost")} onClick={removeFromDatabase}>Remove from database</button>
        </div>
      )}

      {topicsSaved && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: TEAL }}>
          <span style={{ color: "var(--text-secondary)" }}>
            <b style={{ color: TEAL }}>Topics saved to the database</b> · {topicsSaved.topics} topic(s) saved {new Date(topicsSaved.at).toLocaleString()}. This is permanent. Build questions here in Codex, or lessons in MCAT Lessons, from them.
          </span>
        </div>
      )}

      <section className="p-4 mb-4 space-y-3" style={card} aria-label="Run controls">
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            <button style={btn("primary", running || !unfinished)} disabled={running || !unfinished} onClick={start}>{phase === "paused" ? "Resume" : "Start"}</button>
            <button style={btn("ghost", !running)} disabled={!running} onClick={pause}>Pause</button>
            <span className="flex-1" />
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>Parallel
              <select value={concurrency} disabled={running} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ ...input, width: 64, marginLeft: 6, padding: "6px 8px" }}>
                {[1, 2, 3].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}

        <p className="text-sm" style={{ color: phase === "running" ? TEAL : "var(--text-secondary)" }}>{statusText[phase]}</p>

        {total > 0 && (
          <div className="space-y-3">
            {(topicsRun || run.depth === "parents" || run.depth === "atomics") ? (
              <Bar label="Progress" value={done} total={total} text={`${done}/${total} steps`} color={TEAL} />
            ) : (
              <>
                <Bar label="Writing" value={written.done} total={written.total} text={`${written.done}/${written.total} written`} color={TEAL} />
                <Bar label="AI check and approval" value={checks.done} total={checks.total} text={`${checks.done}/${checks.total} checked · ${counts.approved} approved${counts.flagged > 0 ? ` · ${counts.flagged} need you` : ""}`} color="#2563eb" />
                <Bar label="Saved to the question database" value={progress.saved} total={savedTotal} text={`${progress.saved}/${savedTotal} saved`} color="#16a34a" />
              </>
            )}
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{steps.map((s) => `${s.label} ${s.t.done}/${s.total}`).join(" · ")}</p>
            {summary && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{summary}</p>}
          </div>
        )}

        {/* The next thing to do, only when there is something to do. */}
        {(!locked && ((topicsRun && progress.topics > 0) || (!auto && counts.auto_passed > 0) || unchecked || (canSaveQuestions && counts.approved > 0))) && (
          <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            {topicsRun && <button style={btn("primary", topicSaveBlockers.length > 0)} disabled={topicSaveBlockers.length > 0} onClick={saveTopics}>Save topics to database</button>}
            {!auto && counts.auto_passed > 0 && <button style={btn("primary")} onClick={approvePassed}>Approve all that passed the AI check ({counts.auto_passed})</button>}
            {unchecked && <button style={btn("ghost")} onClick={approveDrafts}>Approve all unchecked ({counts.draft})</button>}
            {!topicsRun && canSaveQuestions && counts.approved > 0 && <button style={btn("primary", bankBlockers.length > 0)} disabled={bankBlockers.length > 0} onClick={saveToDatabase}>Save to question database</button>}
            {topicsRun && topicSaveBlockers.length > 0 && <p className="basis-full text-xs" style={{ color: "var(--text-muted)" }}>Before you can save: {topicSaveBlockers[0]}</p>}
            {!topicsRun && canSaveQuestions && counts.approved > 0 && bankBlockers.length > 0 && <p className="basis-full text-xs" style={{ color: "var(--text-muted)" }}>Before you can save to the question database: {bankBlockers[0]}</p>}
          </div>
        )}

        <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="text-xs font-semibold" style={{ color: "var(--text-muted)" }} aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
            Advanced {advanced ? "▾" : "▸"}
          </button>
          {advanced && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button style={btn("ghost")} onClick={download}>Download{topicsRun ? " topics" : ""}</button>
              {!topicsRun && <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={dlApproved} onChange={(e) => setDlApproved(e.target.checked)} />Approved only</label>}
              {!topicsRun && <button style={btn("ghost", counts.approved === 0)} disabled={counts.approved === 0} onClick={saveSnapshot}>Save approved to Firebase Storage</button>}
            </div>
          )}
        </div>
      </section>

      {notice && <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{notice}</p>}

      {retrying.length > 0 && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: "#d97706" }}>
          <b style={{ color: "#d97706" }}>A step is failing and will be retried</b>
          <ul className="mt-2 text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
            {retrying.map((t) => <li key={t.id}><code>{t.id}</code>: {t.error}</li>)}
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>If this keeps happening, check the model settings in Admin → Settings.</p>
        </div>
      )}

      {failedTasks.length > 0 && (
        <div className="p-3 mb-4 text-sm" style={{ ...card, borderColor: "var(--accent-red)" }}>
          <div className="flex items-center justify-between gap-2">
            <b style={{ color: "var(--accent-red)" }}>{failedTasks.length} step(s) failed</b>
            <button style={btn("ghost", !!banked)} disabled={!!banked} onClick={retry}>Retry failed</button>
          </div>
          <ul className="mt-2 text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
            {failedTasks.slice(0, 5).map((t) => <li key={t.id}><code>{t.id}</code> — {t.error}</li>)}
          </ul>
        </div>
      )}

      {auto && progress.saved > 0 && (
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          {progress.saved} question{progress.saved === 1 ? " is" : "s are"} saved to the database and {showSaved ? "shown" : "hidden from this list"}.{" "}
          <button className="underline" style={{ color: TEAL }} onClick={() => setShowSaved((v) => !v)}>{showSaved ? "Hide them" : "Show them"}</button>
        </p>
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
                  {topics.filter((t) => t.subsectionId === ss.id).filter((t) => showSaved || !(auto && current(t.id)?.savedAt)).map((t) => {
                    const parent = current(t.id);
                    const atoms = atomsOf(t.id);
                    const open = openTopic === t.id;
                    const status = topicsRun ? "" : parent ? `1 question${atoms.length ? ` · ${atoms.length} atomic` : ""}` : "no question yet";
                    return (
                      <div key={t.id} style={card}>
                        <button className="w-full text-left p-3 flex items-start gap-2" aria-expanded={open} onClick={() => setOpenTopic(open ? null : t.id)}>
                          <span className="text-xs font-mono mt-0.5 shrink-0" style={{ color: "var(--text-muted)", minWidth: 88 }}>{t.id}</span>
                          <span className="flex-1 min-w-0">
                            {t.groupTitle && <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{t.groupTitle}</span>}
                            <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t.title}</span>
                            {status && <span className="block sm:hidden text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{status}</span>}
                          </span>
                          {status && <span className="hidden sm:inline text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{status}</span>}
                        </button>
                        {open && (
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}><b>Scope:</b> {t.scope} <b>Target:</b> {t.primaryLearningTarget}</p>
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

function Bar({ label, value, total, text, color }: { label: string; value: number; total: number; text: string; color: string }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-muted)" }}><span>{label}</span><span>{text}</span></div>
      <div className="h-1.5 rounded-full" style={{ background: "var(--bg-input)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
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

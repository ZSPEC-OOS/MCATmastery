"use client";
// Codex study mode. Mirrors Mastery's practice flow (config → active → complete), with a teaching loop:
// answer the concept (parent) question; if it is missed, work through its foundation (atomic) questions in
// order, then try the concept question again. Only questions you approved in the Build tab appear here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import CodexNavbar from "../_components/CodexNavbar";
import { TEAL, fetcher } from "../_components/ui";
import { PassageRenderer } from "../../components/PassageRenderer";
import type { CatalogRun, StudyFocus, StudyMode, StudyQuestion, StudyTopic } from "../../../lib/codex/study";

type Answer = "A" | "B" | "C" | "D";
type Phase = "config" | "loading" | "active" | "complete" | "error";
type Kind = "parent" | "foundation" | "retry";
interface Step { kind: Kind; q: StudyQuestion; topicIdx: number; n?: number; of?: number }
interface LogEntry { topicIdx: number; kind: Kind; qid: string; correct: boolean }

const S = { card: { background: "var(--bg-card)", border: "1px solid var(--border)" } as React.CSSProperties };
const GOOD = "#4ade80";
const BAD = "#f87171";
const DIFF_COLOR: Record<string, string> = { foundational: "#38bdf8", easy: "#4ade80", medium: "#f0a500", hard: "#f87171" };

const MODES: { id: StudyMode; label: string; blurb: string }[] = [
  { id: "teach", label: "Teach me", blurb: "Concept question first. Miss it and you work through its foundations, then try again." },
  { id: "parents", label: "Concepts only", blurb: "Just the concept questions." },
  { id: "foundations", label: "Foundations only", blurb: "Just the prerequisite building blocks." },
];
const FOCUS: { id: StudyFocus; label: string }[] = [
  { id: "all", label: "Everything" }, { id: "unmastered", label: "Not mastered yet" }, { id: "missed", label: "Missed before" },
];

// Module-level on purpose: a component defined inside StudyPage would remount on every state change.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <CodexNavbar />
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">{children}</main>
    </div>
  );
}

const kindLabel = (s: Step) => (s.kind === "parent" ? "Concept question" : s.kind === "retry" ? "Try the concept question again" : `Foundation ${s.n} of ${s.of}`);

export default function StudyPage() {
  const { data: catalog, error: catalogError } = useSWR<{ runs: CatalogRun[] }>("/api/codex/study", fetcher, { revalidateOnFocus: false });

  const [runId, setRunId] = useState("");
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [mode, setMode] = useState<StudyMode>("teach");
  const [focus, setFocus] = useState<StudyFocus>("all");
  const [count, setCount] = useState(10);
  const [shuffle, setShuffle] = useState(false);

  const [phase, setPhase] = useState<Phase>("config");
  const [errorMsg, setErrorMsg] = useState("");
  const [items, setItems] = useState<StudyTopic[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Answer | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [mastered, setMastered] = useState<Record<string, boolean>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [showPassageModal, setShowPassageModal] = useState(false);
  const passageRef = useRef<HTMLDivElement>(null);

  const run = useMemo(() => catalog?.runs.find((r) => r.id === runId) ?? catalog?.runs[0], [catalog, runId]);
  useEffect(() => { if (run && run.id !== runId) { setRunId(run.id); setSectionIds(run.sections.filter((s) => s.approvedParents + s.approvedAtoms > 0).map((s) => s.id)); } }, [run, runId]);

  const step = steps[idx] ?? null;
  const q = step?.q ?? null;

  useEffect(() => { if (passageRef.current) passageRef.current.scrollTop = 0; }, [idx]);

  function buildSteps(list: StudyTopic[], m: StudyMode): Step[] {
    return list.flatMap((t, topicIdx): Step[] =>
      m === "foundations"
        ? t.atoms.map((q, i) => ({ kind: "foundation" as const, q, topicIdx, n: i + 1, of: t.atoms.length }))
        : t.parent ? [{ kind: "parent" as const, q: t.parent, topicIdx }] : [],
    );
  }

  const start = useCallback(async () => {
    setPhase("loading"); setErrorMsg("");
    try {
      const res = await fetch("/api/codex/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, sectionIds, mode, focus, count, shuffle }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not start the session");
      if (!d.items.length) { setErrorMsg("Nothing matches those choices. Try other sections, a different focus, or approve more questions in the Build tab."); setPhase("error"); return; }
      setItems(d.items); setSteps(buildSteps(d.items, mode)); setIdx(0); setSelected(null); setSubmitted(false);
      setLog([]); setMastered({}); setFlagged(new Set()); setPhase("active");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong. Please try again."); setPhase("error");
    }
  }, [runId, sectionIds, mode, focus, count, shuffle]);

  const handleSubmit = useCallback(() => {
    if (!selected || !step) return;
    const correct = selected === step.q.correctKey;
    setSubmitted(true);
    setLog((l) => [...l, { topicIdx: step.topicIdx, kind: step.kind, qid: step.q.qid, correct }]);

    // Teach loop: a missed concept question leads into its foundations, then a retry.
    const topic = items[step.topicIdx];
    if (mode === "teach" && step.kind === "parent" && !correct && topic.atoms.length > 0) {
      const foundations: Step[] = topic.atoms.map((a, i) => ({ kind: "foundation", q: a, topicIdx: step.topicIdx, n: i + 1, of: topic.atoms.length }));
      setSteps((prev) => [...prev.slice(0, idx + 1), ...foundations, { kind: "retry", q: step.q, topicIdx: step.topicIdx }, ...prev.slice(idx + 1)]);
    }

    // The server grades again and records progress; it is not trusted to the client.
    fetch("/api/codex/study/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, questionId: step.q.id, answer: selected }) })
      .then((r) => r.json())
      .then((d: { ok?: boolean; mastered?: boolean }) => { if (d.ok && step.kind !== "foundation") setMastered((m) => ({ ...m, [topic.topicId]: !!d.mastered })); })
      .catch(() => {});
  }, [selected, step, items, mode, idx, runId]);

  const handleNext = useCallback(() => {
    if (idx >= steps.length - 1) { setPhase("complete"); return; }
    setIdx((i) => i + 1); setSelected(null); setSubmitted(false);
  }, [idx, steps.length]);

  useEffect(() => {
    if (phase !== "active") return;
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "1": case "a": case "A": if (!submitted) setSelected("A"); break;
        case "2": case "b": case "B": if (!submitted) setSelected("B"); break;
        case "3": case "c": case "C": if (!submitted) setSelected("C"); break;
        case "4": case "d": case "D": if (!submitted) setSelected("D"); break;
        case "Enter": if (!submitted && selected) handleSubmit(); else if (submitted) handleNext(); break;
        case "p": case "P": if (q?.passage) setShowPassageModal((p) => !p); break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, submitted, selected, q, handleSubmit, handleNext]);

  const primary: React.CSSProperties = { background: TEAL, color: "#fff", border: "none" };

  // ── CONFIG ──────────────────────────────────────────────────────────────────
  if (phase === "config") {
    if (catalogError) return <Shell><p style={{ color: BAD }}>{catalogError.message}</p></Shell>;
    if (!catalog) return <Shell><p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;
    if (!run) return (
      <Shell>
        <div className="w-full max-w-md rounded-xl p-8 text-center space-y-3" style={S.card}>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Nothing to study yet</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Study mode uses questions you have approved. Build a run, review its questions, and approve the good ones.</p>
          <Link href="/codex" className="inline-block px-5 py-2 rounded text-sm font-semibold" style={primary}>Go to Build</Link>
        </div>
      </Shell>
    );
    const usable = run.sections.filter((s) => (mode === "foundations" ? s.approvedAtoms : s.approvedParents) > 0);
    const toggle = (id: string) => setSectionIds((p) => (p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : [...p, id]));
    return (
      <Shell>
        <div className="w-full max-w-lg rounded-xl p-6 space-y-5" style={S.card}>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Configure Study Session</h1>

          {catalog.runs.length > 1 && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Subject</label>
              <select value={run.id} onChange={(e) => setRunId(e.target.value)} className="w-full px-3 py-2 rounded text-sm" style={{ background: "var(--bg-card-hover)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                {catalog.runs.map((r) => <option key={r.id} value={r.id}>{r.subject} · {new Date(r.createdAt).toLocaleDateString()}</option>)}
              </select>
            </div>
          )}
          {catalog.runs.length === 1 && <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{run.subject}</p>}

          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Major sections <span style={{ fontWeight: 400 }}>({sectionIds.length} selected)</span></label>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {run.sections.map((s) => {
                const avail = mode === "foundations" ? s.approvedAtoms : s.approvedParents;
                const active = sectionIds.includes(s.id) && avail > 0;
                return (
                  <button key={s.id} disabled={avail === 0} onClick={() => toggle(s.id)} className="w-full py-2 px-3 rounded text-sm text-left flex items-center gap-2"
                    style={{ background: active ? TEAL : "var(--bg-card-hover)", color: active ? "#fff" : "var(--text-secondary)", border: `1px solid ${active ? TEAL : "var(--border)"}`, opacity: avail === 0 ? 0.4 : 1 }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-xs" style={{ background: active ? "rgba(255,255,255,0.25)" : "var(--border)" }}>{active ? "✓" : ""}</span>
                    <span className="flex-1">{s.id} · {s.title}</span>
                    <span className="text-xs" style={{ opacity: 0.85 }}>{s.masteredParents}/{s.approvedParents} mastered</span>
                  </button>
                );
              })}
            </div>
            {usable.length === 0 && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>No approved questions of this kind yet.</p>}
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>How to study</label>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)} className="py-2 rounded text-xs font-medium"
                  style={{ background: mode === m.id ? TEAL : "transparent", color: mode === m.id ? "#fff" : "var(--text-secondary)", border: `1px solid ${mode === m.id ? TEAL : "var(--border)"}` }}>{m.label}</button>
              ))}
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>{MODES.find((m) => m.id === mode)!.blurb}</p>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Focus</label>
            <div className="flex gap-2">
              {FOCUS.map((f) => (
                <button key={f.id} onClick={() => setFocus(f.id)} className="px-3 py-2 rounded text-sm font-medium"
                  style={{ background: focus === f.id ? "rgba(13,148,136,0.15)" : "var(--bg-card-hover)", color: focus === f.id ? TEAL : "var(--text-secondary)", border: `1px solid ${focus === f.id ? TEAL : "var(--border)"}` }}>{f.label}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Topics: <strong style={{ color: "var(--text-primary)" }}>{count}</strong></label>
            <input type="range" min={1} max={50} value={count} onChange={(e) => setCount(+e.target.value)} className="w-full" style={{ accentColor: TEAL }} />
            <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-muted)" }}><span>1</span><span>10</span><span>25</span><span>50</span></div>
          </div>

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} style={{ accentColor: TEAL }} />
            Shuffle (otherwise topics follow the curriculum order; missed topics always come first)
          </label>

          <button onClick={start} disabled={usable.length === 0} className="w-full py-2.5 rounded text-sm font-semibold" style={{ ...primary, opacity: usable.length === 0 ? 0.5 : 1 }}>Start Studying</button>
        </div>
      </Shell>
    );
  }

  if (phase === "error") return (
    <Shell>
      <div className="w-full max-w-md rounded-xl p-8 text-center space-y-4" style={S.card}>
        <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Couldn&apos;t Start Session</h2>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{errorMsg}</p>
        <button onClick={() => setPhase("config")} className="w-full py-2.5 rounded text-sm font-semibold" style={primary}>← Back to Configure</button>
      </div>
    </Shell>
  );

  if (phase === "loading") return (
    <Shell>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: TEAL, borderTopColor: "transparent" }} />
      <p className="text-sm mt-4" style={{ color: "var(--text-primary)" }}>Building your session…</p>
    </Shell>
  );

  // ── COMPLETE ────────────────────────────────────────────────────────────────
  if (phase === "complete") {
    const scored = log.filter((l) => (mode === "foundations" ? l.kind === "foundation" : l.kind === "parent"));
    const right = scored.filter((l) => l.correct).length;
    const pct = scored.length ? Math.round((right / scored.length) * 100) : 0;
    const perTopic = items.map((t, i) => {
      const mine = log.filter((l) => l.topicIdx === i);
      const first = mine.find((l) => (mode === "foundations" ? l.kind === "foundation" : l.kind === "parent"));
      const retry = mine.find((l) => l.kind === "retry");
      return { t, first, retry, foundationsMissed: mine.filter((l) => l.kind === "foundation" && !l.correct).length, answered: mine.length > 0 };
    }).filter((x) => x.answered);
    const revisit = perTopic.filter((x) => x.first && !x.first.correct);
    const flaggedQs = steps.filter((s) => flagged.has(s.q.qid));
    return (
      <Shell>
        <div className="rounded-xl p-8 w-full max-w-md text-center" style={S.card}>
          <div className="text-5xl font-bold mb-2" style={{ color: pct >= 70 ? GOOD : BAD }}>{pct}%</div>
          <p className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>{right} / {scored.length} correct on the first try</p>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Mastery needs the same question right twice in a row, across sessions.</p>

          <div className="flex flex-wrap gap-2 justify-center mb-4">
            {steps.map((s, i) => {
              const l = log.find((x) => x.qid === s.q.qid && x.kind === s.kind && x.topicIdx === s.topicIdx);
              return (
                <div key={i} title={`${s.q.qid} · ${kindLabel(s)}`} className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold relative"
                  style={{ background: !l ? "var(--bg-card-hover)" : l.correct ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)", color: !l ? "var(--text-muted)" : l.correct ? GOOD : BAD, border: `1px solid ${!l ? "var(--border)" : l.correct ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)"}` }}>
                  {i + 1}
                  {flagged.has(s.q.qid) && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center" style={{ background: "#f59e0b", fontSize: 7 }}>★</span>}
                </div>
              );
            })}
          </div>

          {revisit.length > 0 && (
            <div className="text-left rounded-xl p-3 mb-4" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: BAD }}>Topics to revisit ({revisit.length})</p>
              <ul className="space-y-1.5">
                {revisit.map(({ t, retry, foundationsMissed }) => (
                  <li key={t.topicId} className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>
                    <b>{t.title}</b>
                    {mode === "teach" && <span> — {foundationsMissed > 0 ? `${foundationsMissed} foundation(s) missed` : "foundations solid"}{retry ? (retry.correct ? ", then got it on the retry" : ", retry still missed") : ""}</span>}
                    {mastered[t.topicId] && <span style={{ color: GOOD }}> ✓ mastered</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {flaggedQs.length > 0 && (
            <div className="text-left rounded-xl p-3 mb-4" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "#f59e0b" }}>★ Flagged ({flaggedQs.length})</p>
              {flaggedQs.map((s, i) => <p key={i} className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>{s.q.stem.length > 80 ? s.q.stem.slice(0, 80) + "…" : s.q.stem}</p>)}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setPhase("config"); }} className="flex-1 py-2 rounded text-sm font-semibold" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Setup</button>
            <button onClick={start} className="flex-1 py-2 rounded text-sm font-semibold" style={primary}>Study More</button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── ACTIVE ──────────────────────────────────────────────────────────────────
  if (!q || !step) return <Shell><button onClick={() => setPhase("config")} className="px-5 py-2 rounded text-sm font-semibold" style={primary}>← Configure Session</button></Shell>;
  const topic = items[step.topicIdx];
  const missedParent = submitted && mode === "teach" && step.kind === "parent" && selected !== q.correctKey && topic.atoms.length > 0;

  return (
    <div className="flex flex-col min-h-screen">
      <CodexNavbar />
      <div className="px-6 py-2 flex items-center gap-3 text-xs" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
        <span className="truncate" style={{ color: "var(--text-muted)" }}>{topic.sectionTitle} · {topic.title}</span>
        <span className="px-2 py-0.5 rounded whitespace-nowrap" style={{ background: step.kind === "foundation" ? "rgba(56,189,248,0.12)" : "rgba(13,148,136,0.12)", color: step.kind === "foundation" ? "#38bdf8" : TEAL, border: `1px solid ${step.kind === "foundation" ? "rgba(56,189,248,0.3)" : "rgba(13,148,136,0.3)"}` }}>{kindLabel(step)}</span>
        {q.passage && (
          <button onClick={() => setShowPassageModal(true)} className="flex md:hidden items-center gap-1.5 px-2.5 py-1 rounded font-medium" style={{ background: "rgba(13,148,136,0.12)", border: "1px solid rgba(13,148,136,0.35)", color: TEAL }}>Passage</button>
        )}
        <span className="ml-auto whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>Topic {step.topicIdx + 1} / {items.length}</span>
        <button onClick={() => setPhase("complete")} className="px-2 py-0.5 rounded" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>End</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {q.passage && (
          <div className="hidden md:flex flex-col flex-shrink-0 overflow-hidden" style={{ width: "50%", borderRight: "1px solid var(--border)", background: "var(--bg-card)" }}>
            <div className="flex-shrink-0 px-9 pt-6 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)", letterSpacing: "0.12em" }}>Passage</span>
            </div>
            <div ref={passageRef} className="flex-1 overflow-y-auto px-9 py-7">
              <PassageRenderer text={q.passage} style={{ color: "var(--text-primary)", fontSize: "0.875rem", lineHeight: 1.85 }} />
            </div>
          </div>
        )}

        <div className={`flex-1 overflow-y-auto flex flex-col ${q.passage ? "" : "md:items-center"}`}>
          <div className={`flex flex-col flex-1 w-full px-7 py-6 ${q.passage ? "" : "md:max-w-2xl"}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: `${DIFF_COLOR[q.difficulty] ?? "#6366f1"}15`, color: DIFF_COLOR[q.difficulty] ?? "#6366f1", border: `1px solid ${DIFF_COLOR[q.difficulty] ?? "#6366f1"}40` }}>{q.difficulty}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{topic.subsectionTitle}</span>
              <button
                onClick={() => setFlagged((prev) => { const next = new Set(prev); if (next.has(q.qid)) next.delete(q.qid); else next.add(q.qid); return next; })}
                className="ml-auto text-xs px-2 py-0.5 rounded"
                style={{ background: flagged.has(q.qid) ? "rgba(245,158,11,0.12)" : "transparent", color: flagged.has(q.qid) ? "#f59e0b" : "var(--text-muted)", border: `1px solid ${flagged.has(q.qid) ? "rgba(245,158,11,0.35)" : "var(--border)"}` }}>
                {flagged.has(q.qid) ? "★ Flagged" : "☆ Flag"}
              </button>
            </div>

            {step.kind === "foundation" && q.purpose && (
              <p className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)", color: "var(--text-secondary)" }}>
                <b>Why this matters:</b> {q.purpose}
              </p>
            )}
            {step.kind === "retry" && <p className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.25)", color: "var(--text-secondary)" }}>You have worked through the foundations. Try the concept question again.</p>}

            <p className="text-sm leading-relaxed mb-5 font-medium" style={{ color: "var(--text-primary)" }}>{q.stem}</p>

            <div className="space-y-3 mb-6">
              {q.options.map((o) => {
                const opt = o.key as Answer;
                let bg = "var(--bg-card)", border = "var(--border)", color = "var(--text-primary)";
                if (submitted) {
                  if (opt === q.correctKey) { bg = "rgba(74,222,128,0.1)"; border = GOOD; color = GOOD; }
                  else if (opt === selected) { bg = "rgba(248,113,113,0.1)"; border = BAD; color = BAD; }
                } else if (selected === opt) { bg = "rgba(13,148,136,0.1)"; border = TEAL; }
                const filled = (selected === opt && !submitted) || (submitted && opt === q.correctKey);
                return (
                  <div key={opt} onClick={() => !submitted && setSelected(opt)} className="rounded-xl p-3 flex items-start gap-3" style={{ background: bg, border: `1px solid ${border}`, cursor: submitted ? "default" : "pointer", transition: "all 0.15s" }}>
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: filled ? (submitted && opt === q.correctKey ? GOOD : TEAL) : "transparent", border: `2px solid ${filled ? border : "var(--border)"}` }}>
                      {filled && <div className="w-2 h-2 rounded-full" style={{ background: "#fff" }} />}
                    </div>
                    <span className="text-sm" style={{ color }}><strong>{opt}.</strong> {o.text}</span>
                  </div>
                );
              })}
            </div>

            {submitted && (
              <>
                <div className="rounded-xl p-4 mb-3" style={{ background: "rgba(13,148,136,0.06)", border: "1px solid rgba(13,148,136,0.25)" }}>
                  <p className="text-xs font-semibold uppercase mb-2" style={{ color: TEAL }}>{selected === q.correctKey ? "Correct — explanation" : "Explanation"}</p>
                  <PassageRenderer text={q.explanation} style={{ color: "var(--text-secondary)", fontFamily: "inherit", lineHeight: 1.7 }} />
                </div>
                {q.options.some((o) => o.key !== q.correctKey && o.rationale) && (
                  <div className="rounded-xl p-4 mb-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <p className="text-xs font-semibold uppercase mb-2" style={{ color: "var(--text-muted)" }}>Why the other choices are wrong</p>
                    <ul className="space-y-1.5">
                      {q.options.filter((o) => o.key !== q.correctKey && o.rationale).map((o) => (
                        <li key={o.key} className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}><b>{o.key}.</b> {o.rationale}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {missedParent && (
                  <p className="text-sm rounded-xl p-3 mb-3" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)", color: "var(--text-secondary)" }}>
                    Let&apos;s build up to it: {topic.atoms.length} foundation question{topic.atoms.length === 1 ? "" : "s"} next, then you will try this question again.
                  </p>
                )}
              </>
            )}

            <div className="flex-1" />
            <div className="sticky bottom-0 py-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--border)", background: "var(--bg-primary)" }}>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Keys: A–D to choose · Enter to submit/continue{q.passage ? " · P for passage" : ""}</span>
              {!submitted ? (
                <button onClick={handleSubmit} disabled={!selected} className="px-5 py-1.5 rounded text-sm font-semibold" style={{ ...primary, opacity: selected ? 1 : 0.5 }}>Submit</button>
              ) : (
                <button onClick={handleNext} className="px-5 py-1.5 rounded text-sm font-semibold" style={primary}>
                  {idx >= steps.length - 1 && !missedParent ? "Finish" : missedParent ? "Start foundations →" : "Next →"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPassageModal && q.passage && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} onClick={() => setShowPassageModal(false)}>
          <div className="w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--bg-card)", maxHeight: "82vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Passage</p>
              <button onClick={() => setShowPassageModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none" style={{ background: "var(--bg-card-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>×</button>
            </div>
            <div className="px-5 py-5 overflow-y-auto"><PassageRenderer text={q.passage} style={{ color: "var(--text-secondary)" }} /></div>
            <div className="px-5 py-3 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setShowPassageModal(false)} className="w-full py-2.5 rounded-lg text-sm font-semibold" style={primary}>Back to Question</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

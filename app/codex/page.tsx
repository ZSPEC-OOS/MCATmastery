"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import CodexNavbar from "./_components/CodexNavbar";
import { Badge, TEAL, btn, card, fetcher, input } from "./_components/ui";
import { parseSubCodex } from "../../lib/codex/subcodex";
import { DEPTH_LABELS } from "../../lib/codex/types";
import { SUBCODEX_PRESETS, presetText } from "../../lib/codex/presets";
import type { CodexDepth } from "../../lib/codex/types";

interface RunRow {
  id: string; subject: string; depth: CodexDepth; status: string; createdAt: string; sections: number;
  banked: { at: string; questions: number } | null; bankedSections: number[];
  topicsSaved: { at: string; topics: number } | null;
  progress: { active: boolean; failed: number; topics: number; questions: Record<string, number> };
}

// One plain sentence per choice, shown under the selector.
const DEPTH_HELP: Record<CodexDepth, string> = {
  topics: "Plans each major section and splits it into single-idea topics. No questions. Save the result to the topic database: this is the first step for everything else.",
  parents: "One parent question per saved topic. No AI check; you approve them (one button approves them all).",
  parentsChecked: "One parent question per saved topic, checked by AI and approved automatically when it passes. The fastest way to get questions to practice.",
  atomics: "Parent questions plus the small prerequisite questions behind each one. No AI check; you approve them.",
  verified: "Everything: parent and atomic questions, the AI check with corrections, then your approval.",
};

export default function CodexHome() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ runs: RunRow[] }>("/api/codex/runs", fetcher);
  const [preset, setPreset] = useState("");   // index into SUBCODEX_PRESETS; "" = nothing chosen
  const [depth, setDepth] = useState<CodexDepth>("topics");
  const [picked, setPicked] = useState<Set<number> | null>(null); // null = all sections
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const text = useMemo(() => (preset === "" ? "" : presetText(SUBCODEX_PRESETS[Number(preset)])), [preset]);
  const parsed = useMemo(() => (text ? parseSubCodex(text) : null), [text]);
  // The shared topic database decides what can be built. Topics only: sections not saved yet (saving is permanent).
  // Every other depth: sections whose topics are saved. Sections whose questions are in the question database are hidden.
  const { data: bankData } = useSWR<{ sections: { number: number }[] }>(parsed?.ok ? `/api/codex/topic-bank?subject=${encodeURIComponent(parsed.subject ?? "")}` : null, fetcher);
  const savedTopics = useMemo(() => new Set((bankData?.sections ?? []).map((s) => s.number)), [bankData]);
  const bankedNumbers = useMemo(() => {
    const out = new Set<number>();
    if (parsed?.ok) for (const r of data?.runs ?? []) if (r.banked && r.subject === parsed.subject) r.bankedSections.forEach((n) => out.add(n));
    return out;
  }, [data, parsed]);
  const topicsOnly = depth === "topics";
  const available = parsed?.ok ? parsed.sections.filter((s) => (topicsOnly ? !savedTopics.has(s.number) : savedTopics.has(s.number) && !bankedNumbers.has(s.number))) : [];
  const availableNumbers = new Set(available.map((s) => s.number));
  const selected = parsed?.ok ? new Set((picked ? [...picked] : available.map((s) => s.number)).filter((n) => availableNumbers.has(n))) : new Set<number>();

  async function start() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/codex/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: text, depth, sectionNumbers: [...selected] }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.issues?.[0]?.message ?? d.error ?? "Could not start the run");
      router.push(`/codex/${d.run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run");
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const r = data?.runs.find((x) => x.id === id);
    const unsavedTopics = r?.depth === "topics" && !r.topicsSaved;
    if (!confirm(unsavedTopics
      ? "Delete this run? Its topics are NOT saved to the topic database, so the planning and splitting work will be lost and have to be paid for again."
      : r?.depth === "topics" ? "Delete this run? Its topics are already saved to the topic database and are not affected."
        : "Delete this run and every question it generated? Saved topics are not affected. This cannot be undone.")) return;
    await fetch(`/api/codex/runs/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="flex flex-col min-h-screen">
      <CodexNavbar />
      <main className="max-w-6xl mx-auto w-full px-4 md:px-6 py-6 flex-1 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3 p-5 space-y-4" style={card}>
          <select
            value={preset} style={{ ...input, fontSize: 15 }} aria-label="Choose a subject"
            onChange={(e) => { setPreset(e.target.value); setPicked(null); }}
          >
            <option value="" disabled>Choose a subject…</option>
            {SUBCODEX_PRESETS.map((p, i) => <option key={p.subject} value={i}>{p.subject} ({p.sections.length} sections)</option>)}
          </select>

          {parsed?.ok && (
            <div className="space-y-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {parsed.subject} — {available.length} major section{available.length === 1 ? "" : "s"} available
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {topicsOnly
                  ? `${savedTopics.size} of ${parsed.sections.length} section${parsed.sections.length === 1 ? "" : "s"} already saved in the topic database (permanent, so they are not offered here). `
                  : `Only sections saved in the topic database can be built into questions: ${savedTopics.size} of ${parsed.sections.length}. Run Topics only and save it to the database first for the rest. `}
                {bankedNumbers.size > 0 && !topicsOnly && `${bankedNumbers.size} more are hidden because their questions are saved to the question database.`}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>{selected.size} of {available.length} selected</span>
                <button type="button" style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => setPicked(new Set(available.map((s) => s.number)))}>Select all</button>
                <button type="button" style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => setPicked(new Set())}>Clear</button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {available.map((s) => (
                  <label key={s.number} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox" checked={selected.has(s.number)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(s.number); else next.delete(s.number);
                        setPicked(next);
                      }}
                    />
                    <span><b>{s.id}</b> {s.title}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Tip: build one major section first to check quality and cost before building the rest.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>What to build</label>
              <select value={depth} onChange={(e) => { setDepth(e.target.value as CodexDepth); setPicked(null); }} style={input}>
                {(Object.keys(DEPTH_LABELS) as CodexDepth[]).map((d) => <option key={d} value={d}>{DEPTH_LABELS[d]}</option>)}
              </select>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>{DEPTH_HELP[depth]}</p>
            </div>
            <button style={btn("primary", busy || !parsed?.ok || selected.size === 0)} disabled={busy || !parsed?.ok || selected.size === 0} onClick={start}>
              {busy ? "Starting…" : "Create run"}
            </button>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>}
        </section>

        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-lg" style={{ color: "var(--text-primary)" }}>Runs</h2>
          {!data && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}
          {data && data.runs.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No runs yet.</p>}
          {data?.runs.map((r) => {
            const q = r.progress.questions;
            return (
              <div key={r.id} className="p-4" style={card}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/codex/${r.id}`} className="font-semibold" style={{ color: TEAL }}>{r.subject}</Link>
                  {r.banked
                    ? <span className="text-xs" style={{ color: TEAL }}>In database</span>
                    : <button style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => remove(r.id)}>Delete</button>}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {new Date(r.createdAt).toLocaleString()} · {r.sections} section{r.sections === 1 ? "" : "s"} · {DEPTH_LABELS[r.depth]}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{r.progress.topics} topics</span>
                  {q.approved > 0 && <Badge status="approved" />}
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {q.approved} approved · {q.auto_passed} awaiting you · {q.flagged} flagged
                  </span>
                  {r.topicsSaved && <span className="text-xs" style={{ color: TEAL }}>Topics in database ({r.topicsSaved.topics})</span>}
                  {r.progress.failed > 0 && <span className="text-xs" style={{ color: "var(--accent-red)" }}>{r.progress.failed} task(s) failed</span>}
                  {r.progress.active && !r.banked && !r.topicsSaved && <span className="text-xs" style={{ color: "#d97706" }}>unfinished</span>}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}

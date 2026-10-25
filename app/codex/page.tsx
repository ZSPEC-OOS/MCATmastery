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
  progress: { active: boolean; failed: number; topics: number; questions: Record<string, number> };
}

export default function CodexHome() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ runs: RunRow[] }>("/api/codex/runs", fetcher);
  const [preset, setPreset] = useState("");   // index into SUBCODEX_PRESETS; "" = nothing chosen
  const [depth, setDepth] = useState<CodexDepth>("verified");
  const [picked, setPicked] = useState<Set<number> | null>(null); // null = all sections
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const text = useMemo(() => (preset === "" ? "" : presetText(SUBCODEX_PRESETS[Number(preset)])), [preset]);
  const parsed = useMemo(() => (text ? parseSubCodex(text) : null), [text]);
  // Sections already saved to the database are not offered; Remove from database (on the run) brings them back.
  const bankedNumbers = useMemo(() => {
    const out = new Set<number>();
    if (parsed?.ok) for (const r of data?.runs ?? []) if (r.banked && r.subject === parsed.subject) r.bankedSections.forEach((n) => out.add(n));
    return out;
  }, [data, parsed]);
  const available = parsed?.ok ? parsed.sections.filter((s) => !bankedNumbers.has(s.number)) : [];
  const selected = parsed?.ok ? new Set((picked ? [...picked] : available.map((s) => s.number)).filter((n) => !bankedNumbers.has(n))) : new Set<number>();

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
    if (!confirm("Delete this run and every question it generated? This cannot be undone.")) return;
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
              {bankedNumbers.size > 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {bankedNumbers.size} section{bankedNumbers.size === 1 ? " is" : "s are"} saved in the database and hidden here. To bring one back, open its run and choose Remove from database.
                </p>
              )}
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
              <label className="block text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>How far to go</label>
              <select value={depth} onChange={(e) => setDepth(e.target.value as CodexDepth)} style={input}>
                {(Object.keys(DEPTH_LABELS) as CodexDepth[]).map((d) => <option key={d} value={d}>{DEPTH_LABELS[d]}</option>)}
              </select>
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
                  {r.progress.failed > 0 && <span className="text-xs" style={{ color: "var(--accent-red)" }}>{r.progress.failed} task(s) failed</span>}
                  {r.progress.active && <span className="text-xs" style={{ color: "#d97706" }}>unfinished</span>}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}

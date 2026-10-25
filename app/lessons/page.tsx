"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "./_components/LessonsNavbar";
import { ACCENT, btn, card, fetcher, input } from "./_components/ui";
import { parseSubCodex } from "../../lib/codex/subcodex";
import { SUBCODEX_PRESETS, presetText } from "../../lib/codex/presets";

interface RunRow {
  id: string; subject: string; status: string; createdAt: string; sections: number;
  progress: { active: boolean; failed: number; topics: number; lessons: { inRun: number; complete: number; aiApproved: number; flagged: number; approved: number; rejected: number } };
}

export default function LessonsHome() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ runs: RunRow[] }>("/api/lessons/runs", fetcher);
  const [preset, setPreset] = useState("");   // index into SUBCODEX_PRESETS; "" = nothing chosen
  const [picked, setPicked] = useState<Set<number> | null>(null); // null = all sections
  const [pickedLessons, setPickedLessons] = useState<Set<string> | null>(null); // null = every lesson of the chosen sections
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const text = useMemo(() => (preset === "" ? "" : presetText(SUBCODEX_PRESETS[Number(preset)])), [preset]);
  const parsed = useMemo(() => (text ? parseSubCodex(text) : null), [text]);
  // Lessons are written from the shared topic database: only sections saved there (Codex → Topics only → Save) can be built.
  const { data: bankData } = useSWR<{ sections: { number: number; id: string; subsections: { id: string; title: string }[] }[] }>(parsed?.ok ? `/api/codex/topic-bank?subject=${encodeURIComponent(parsed.subject ?? "")}` : null, fetcher);
  const savedNumbers = useMemo(() => new Set((bankData?.sections ?? []).map((s) => s.number)), [bankData]);
  const available = parsed?.ok ? parsed.sections.filter((s) => savedNumbers.has(s.number)) : [];
  const availableNumbers = new Set(available.map((s) => s.number));
  const selected = parsed?.ok ? new Set((picked ? [...picked] : available.map((s) => s.number)).filter((n) => availableNumbers.has(n))) : new Set<number>();

  // Each chosen section lists its subsections (one lesson each) to pick from. Everything is ticked by default.
  const lessonChoices = (bankData?.sections ?? []).filter((s) => selected.has(s.number));
  const lessonIds = lessonChoices.flatMap((s) => s.subsections.map((ss) => ss.id));
  const chosenLessons = lessonIds.filter((id) => (pickedLessons ? pickedLessons.has(id) : true));

  async function start() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/lessons/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: text, sectionNumbers: [...selected], subsectionIds: chosenLessons }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.issues?.[0]?.message ?? d.error ?? "Could not start the run");
      router.push(`/lessons/${d.run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run");
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this run and every lesson it generated? This cannot be undone.")) return;
    await fetch(`/api/lessons/runs/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <main className="max-w-6xl mx-auto w-full px-4 md:px-6 py-6 flex-1 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3 p-5 space-y-4" style={card}>
          <div>
            <h1 className="text-xl" style={{ color: "var(--text-primary)" }}>Develop MCAT lessons</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Choose a subject and the major sections to write. Each subsection (MS-1-SS-1 and so on) becomes one reading lesson that holds every split topic from the shared topic database (planned and split once, in Codex) as an organized part. No questions are generated.
            </p>
          </div>
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
                {parsed.subject}: {available.length} of {parsed.sections.length} major section{parsed.sections.length === 1 ? "" : "s"} ready
              </p>
              {bankData && available.length === 0 && (
                <p className="text-sm" style={{ color: "var(--accent-red)" }}>
                  No sections of {parsed.subject} are in the topic database yet. In Codex, run Topics only and save it to the database first.
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
                Sections not listed are not saved in the topic database yet. Tip: build one major section first to check quality and cost before building the rest.
              </p>
            </div>
          )}

          {parsed?.ok && lessonChoices.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Lessons to include</p>
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>{chosenLessons.length} of {lessonIds.length} lessons selected</span>
                <button type="button" style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => setPickedLessons(null)}>Select all</button>
                <button type="button" style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => setPickedLessons(new Set())}>Clear</button>
              </div>
              {lessonChoices.map((s) => (
                <div key={s.number} className="p-3" style={card}>
                  <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{s.id}</p>
                  <ul>
                    {s.subsections.map((ss) => (
                      <li key={ss.id}>
                        <label className="flex items-start gap-2 py-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                          <input
                            type="checkbox" className="mt-1" checked={chosenLessons.includes(ss.id)}
                            onChange={(e) => setPickedLessons(() => { const n = new Set(chosenLessons); if (e.target.checked) n.add(ss.id); else n.delete(ss.id); return n; })}
                          />
                          <span><span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{ss.id}</span>{ss.title}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Creating the run only queues these lessons. Nothing is written until you press Start on the run page, where you can also Pause or Stop.
              </p>
            </div>
          )}

          <div className="flex items-end gap-3">
            <button style={btn("primary", busy || !parsed?.ok || selected.size === 0 || chosenLessons.length === 0)} disabled={busy || !parsed?.ok || selected.size === 0 || chosenLessons.length === 0} onClick={start}>
              {busy ? "Starting…" : "Create run"}
            </button>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>}
        </section>

        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-lg" style={{ color: "var(--text-primary)" }}>Runs</h2>
          {!data && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}
          {data && data.runs.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No runs yet.</p>}
          {data?.runs.map((r) => (
            <div key={r.id} className="p-4" style={card}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/lessons/${r.id}`} className="font-semibold" style={{ color: ACCENT }}>{r.subject}</Link>
                <button style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }} onClick={() => remove(r.id)}>Delete</button>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {new Date(r.createdAt).toLocaleString()} · {r.sections} section{r.sections === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 items-center text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>{r.progress.topics} topics</span>
                <span>{r.progress.lessons.complete}/{r.progress.lessons.inRun} lessons written · {r.progress.lessons.aiApproved + r.progress.lessons.approved} approved{r.progress.lessons.flagged > 0 ? ` · ${r.progress.lessons.flagged} flagged` : ""}</span>
                {r.progress.failed > 0 && <span style={{ color: "var(--accent-red)" }}>{r.progress.failed} task(s) failed</span>}
                {r.progress.active && <span style={{ color: "#d97706" }}>unfinished</span>}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

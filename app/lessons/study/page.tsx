"use client";
import Link from "next/link";
import useSWR from "swr";
import LessonsNavbar from "../_components/LessonsNavbar";
import { ACCENT, card, fetcher } from "../_components/ui";
import type { StudyLibrary } from "../../../lib/lessons/study";

// The study library: every lesson that has been approved, with your reading progress.
export default function StudyLibraryPage() {
  const { data, error } = useSWR<StudyLibrary>("/api/lessons/study", fetcher);
  const all = data?.subjects.flatMap((s) => s.sections.flatMap((x) => x.lessons)) ?? [];
  const parts = all.reduce((n, l) => n + l.parts, 0);
  const read = all.reduce((n, l) => n + l.readParts, 0);

  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <main className="max-w-3xl mx-auto w-full px-4 md:px-6 py-8 flex-1">
        <h1 className="text-2xl mb-1" style={{ color: "var(--text-primary)" }}>Study</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          {all.length > 0 ? `${all.length} lesson${all.length === 1 ? "" : "s"} · ${read} of ${parts} parts read` : "Lessons you can read appear here once they are approved."}
        </p>

        {error && <p style={{ color: "var(--accent-red)" }}>{error.message}</p>}
        {!data && !error && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}
        {data && all.length === 0 && (
          <div className="p-5 text-sm" style={{ ...card, color: "var(--text-secondary)" }}>
            Nothing to study yet. A lesson shows up here when it has passed the AI check or you have approved it. Write lessons in the <Link href="/lessons" style={{ color: ACCENT }}>Build</Link> tab.
          </div>
        )}

        <div className="space-y-8">
          {data?.subjects.map((subj) => (
            <section key={subj.subject}>
              {data.subjects.length > 1 && <h2 className="text-xl mb-3" style={{ color: "var(--text-primary)" }}>{subj.subject}</h2>}
              <div className="space-y-6">
                {subj.sections.map((sec) => (
                  <div key={sec.id}>
                    <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-mono text-xs mr-2" style={{ color: "var(--text-muted)" }}>{sec.id}</span>{sec.title}
                    </h3>
                    <div className="space-y-2">
                      {sec.lessons.map((l) => {
                        const pct = l.parts ? Math.round((l.readParts / l.parts) * 100) : 0;
                        const done = l.parts > 0 && l.readParts >= l.parts;
                        return (
                          <Link key={`${l.runId}-${l.subsectionId}`} href={`/lessons/study/${l.runId}/${l.subsectionId}`} className="block p-4" style={card}>
                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <div className="text-xs font-mono mb-0.5" style={{ color: "var(--text-muted)" }}>{l.subsectionId}</div>
                                <div className="text-base" style={{ color: "var(--text-primary)" }}>{l.title}</div>
                                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{l.parts} parts · about {l.minutes} min read</div>
                              </div>
                              <span className="text-sm font-semibold whitespace-nowrap mt-1" style={{ color: ACCENT }}>{done ? "Read again" : l.readParts > 0 ? "Continue" : "Start"} →</span>
                            </div>
                            <div className="h-1 rounded-full mt-3" style={{ background: "var(--bg-input)" }}><div className="h-1 rounded-full" style={{ width: `${pct}%`, background: done ? "#16a34a" : ACCENT }} /></div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

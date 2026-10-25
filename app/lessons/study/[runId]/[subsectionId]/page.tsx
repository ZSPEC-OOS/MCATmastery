"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import LessonsNavbar from "../../../_components/LessonsNavbar";
import { ACCENT, fetcher } from "../../../_components/ui";
import type { StudyLesson } from "../../../../../lib/lessons/study";
import type { LessonPart, LessonTopic } from "../../../../../lib/lessons/types";

// A comfortable reader: one calm column, large type, generous spacing, your place saved. Reading settings stay in
// this browser; reading progress is saved to your account.

interface Settings { size: number; font: "serif" | "sans"; page: "site" | "paper" }
const DEFAULTS: Settings = { size: 19, font: "serif", page: "site" };
const KEY = "lessons.reader";
const SIZE_MIN = 15, SIZE_MAX = 27;

const FONTS = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
  sans: 'var(--font-roboto), system-ui, -apple-system, "Segoe UI", sans-serif',
};

const PAGES = {
  site: { bg: "transparent", fg: "var(--text-primary)", soft: "var(--text-secondary)", muted: "var(--text-muted)", line: "var(--border)", card: "rgba(127,127,127,0.08)" },
  paper: { bg: "#f5efe0", fg: "#33291a", soft: "#4d4129", muted: "#7a6a4f", line: "rgba(90,70,30,0.22)", card: "rgba(120,90,30,0.08)" },
};

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return {
        size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(s.size) || DEFAULTS.size)),
        font: s.font === "sans" ? "sans" : "serif",
        page: s.page === "paper" ? "paper" : "site",
      };
    }
  } catch { /* private window or blocked storage: use the defaults */ }
  return DEFAULTS;
}

const paragraphs = (s: string) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

export default function Reader() {
  const { runId, subsectionId } = useParams<{ runId: string; subsectionId: string }>();
  const { data, error } = useSWR<StudyLesson>(`/api/lessons/study/lesson?runId=${encodeURIComponent(runId)}&subsectionId=${encodeURIComponent(subsectionId)}`, fetcher, { revalidateOnFocus: false });

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [panel, setPanel] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const loaded = useRef(false);
  const dirty = useRef(false);

  useEffect(() => { setSettings(loadSettings()); }, []);
  const update = (patch: Partial<Settings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: setting still applies for this visit */ }
    return next;
  });

  // Start from the saved progress once the lesson arrives.
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    setRead(new Set(data.reading?.readParts ?? []));
  }, [data]);

  const parts = useMemo(() => (data?.lesson.parts ?? []).filter((p): p is { topic: LessonTopic; part: LessonPart } => !!p.part), [data]);

  // Save progress a moment after it changes.
  useEffect(() => {
    if (!loaded.current || !dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      fetch("/api/lessons/study/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, subsectionId, readParts: [...read], lastPart: current ?? undefined }) }).catch(() => { dirty.current = true; });
    }, 1200);
    return () => clearTimeout(t);
  }, [read, current, runId, subsectionId]);

  const markRead = useCallback((id: string, on = true) => {
    dirty.current = true;
    setRead((r) => { const n = new Set(r); if (on) n.add(id); else n.delete(id); return n; });
  }, []);

  // Which part you are in, and when you have scrolled past the end of one (it counts as read).
  useEffect(() => {
    if (parts.length === 0) return;
    const heads = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const id = (e.target as HTMLElement).dataset.part; if (id) { dirty.current = true; setCurrent(id); } }
    }, { rootMargin: "-15% 0px -75% 0px" });
    const ends = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.end;
        if (id && (e.isIntersecting || e.boundingClientRect.top < 0)) markRead(id);
      }
    });
    parts.forEach(({ topic }) => {
      const h = document.getElementById(`part-${topic.id}`); if (h) heads.observe(h);
      const s = document.getElementById(`end-${topic.id}`); if (s) ends.observe(s);
    });
    return () => { heads.disconnect(); ends.disconnect(); };
  }, [parts, markRead]);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScroll(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [data]);

  const jump = (id: string) => document.getElementById(`part-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const pg = PAGES[settings.page];
  const family = FONTS[settings.font];
  const body = settings.size;

  if (error) return <Frame><p style={{ color: "var(--accent-red)" }}>{error.message}</p><Link href="/lessons/study" style={{ color: ACCENT }}>← Back to the library</Link></Frame>;
  if (!data) return <Frame><p style={{ color: "var(--text-muted)" }}>Loading…</p></Frame>;

  const { lesson } = data;
  const resume = data.reading?.lastPart && read.size > 0 && !read.has(parts[parts.length - 1]?.topic.id ?? "") ? parts.find((p) => p.topic.id === data.reading!.lastPart) : undefined;
  const readCount = parts.filter((p) => read.has(p.topic.id)).length;

  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <div className="sticky z-40" style={{ top: 56, height: 3, background: "rgba(127,127,127,0.18)" }} aria-hidden>
        <div style={{ height: 3, width: `${Math.round(scroll * 100)}%`, background: ACCENT }} />
      </div>

      <div className="flex-1" style={{ background: pg.bg, color: pg.fg }}>
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          {/* Contents */}
          <aside className="mb-6 lg:mb-0">
            <div className="lg:sticky lg:top-24">
              <details className="lg:hidden rounded-lg px-3 py-2" style={{ background: pg.card, border: `1px solid ${pg.line}` }}>
                <summary className="text-sm cursor-pointer" style={{ color: pg.soft }}>Contents · {readCount}/{parts.length} read</summary>
                <Toc parts={parts} read={read} current={current} jump={jump} pg={pg} />
              </details>
              <div className="hidden lg:block">
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: pg.muted }}>Contents · {readCount}/{parts.length} read</p>
                <Toc parts={parts} read={read} current={current} jump={jump} pg={pg} />
              </div>
            </div>
          </aside>

          {/* Article */}
          <article style={{ fontFamily: family, fontSize: body, lineHeight: 1.8, maxWidth: "42rem", width: "100%", margin: "0 auto" }}>
            <div className="flex items-center justify-between gap-3 mb-6" style={{ fontFamily: FONTS.sans, fontSize: 13, color: pg.muted }}>
              <Link href="/lessons/study" style={{ color: pg.muted }}>← Library</Link>
              <button onClick={() => setPanel((v) => !v)} aria-expanded={panel} className="px-3 py-1 rounded-lg font-semibold" style={{ border: `1px solid ${pg.line}`, color: pg.soft }}>Aa Reading settings</button>
            </div>

            {panel && (
              <div className="mb-8 p-4 rounded-xl space-y-3" style={{ background: pg.card, border: `1px solid ${pg.line}`, fontFamily: FONTS.sans, fontSize: 14, color: pg.soft }}>
                <div className="flex items-center gap-3">
                  <span className="w-24">Text size</span>
                  <button className="px-3 py-1 rounded-lg" style={{ border: `1px solid ${pg.line}` }} onClick={() => update({ size: Math.max(SIZE_MIN, settings.size - 1) })} aria-label="Smaller text">A−</button>
                  <span className="w-10 text-center">{settings.size}</span>
                  <button className="px-3 py-1 rounded-lg" style={{ border: `1px solid ${pg.line}` }} onClick={() => update({ size: Math.min(SIZE_MAX, settings.size + 1) })} aria-label="Larger text">A+</button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-24">Typeface</span>
                  {(["serif", "sans"] as const).map((f) => (
                    <button key={f} className="px-3 py-1 rounded-lg" style={{ border: `1px solid ${settings.font === f ? ACCENT : pg.line}`, color: settings.font === f ? ACCENT : undefined, fontFamily: FONTS[f] }} onClick={() => update({ font: f })}>{f === "serif" ? "Serif" : "Sans"}</button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-24">Page</span>
                  {(["site", "paper"] as const).map((p) => (
                    <button key={p} className="px-3 py-1 rounded-lg" style={{ border: `1px solid ${settings.page === p ? ACCENT : pg.line}`, color: settings.page === p ? ACCENT : undefined }} onClick={() => update({ page: p })}>{p === "site" ? "Match the app" : "Paper"}</button>
                  ))}
                </div>
              </div>
            )}

            <header className="mb-10">
              <p style={{ fontFamily: FONTS.sans, fontSize: 13, color: pg.muted }}>{data.subject} · {data.sectionTitle}</p>
              <p className="mt-1" style={{ fontFamily: FONTS.sans, fontSize: 13, color: pg.muted }}>{lesson.subsectionId}</p>
              <h1 className="mt-2" style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontSize: Math.round(body * 1.9), lineHeight: 1.2, color: pg.fg }}>{lesson.title}</h1>
              <p className="mt-3" style={{ fontFamily: FONTS.sans, fontSize: 13, color: pg.muted }}>{parts.length} parts · about {data.minutes} min read</p>
              {lesson.scope && <p className="mt-5" style={{ color: pg.soft, fontStyle: "italic" }}>{lesson.scope}</p>}
              {resume && (
                <button className="mt-5 px-4 py-2 rounded-lg font-semibold" style={{ fontFamily: FONTS.sans, fontSize: 14, border: `1px solid ${ACCENT}`, color: ACCENT }} onClick={() => jump(resume.topic.id)}>
                  Continue where you left off: {resume.topic.title}
                </button>
              )}
            </header>

            {parts.map(({ topic, part }, i) => (
              <section key={topic.id} className="mb-16" aria-labelledby={`part-${topic.id}`}>
                <p style={{ fontFamily: FONTS.sans, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: ACCENT }}>Part {i + 1} of {parts.length}</p>
                <h2 id={`part-${topic.id}`} data-part={topic.id} className="mt-1 mb-5" style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontSize: Math.round(body * 1.45), lineHeight: 1.3, color: pg.fg, scrollMarginTop: 90 }}>{topic.title}</h2>
                <PartView part={part} pg={pg} body={body} />
                <div id={`end-${topic.id}`} data-end={topic.id} />
                <div className="mt-6 flex items-center gap-3" style={{ fontFamily: FONTS.sans, fontSize: 13 }}>
                  <button className="px-3 py-1.5 rounded-lg font-semibold" style={{ border: `1px solid ${read.has(topic.id) ? "#16a34a" : pg.line}`, color: read.has(topic.id) ? "#16a34a" : pg.soft }} onClick={() => markRead(topic.id, !read.has(topic.id))}>
                    {read.has(topic.id) ? "✓ Read" : "Mark as read"}
                  </button>
                  {i < parts.length - 1 && <button style={{ color: pg.muted }} onClick={() => jump(parts[i + 1].topic.id)}>Next: {parts[i + 1].topic.title} ↓</button>}
                </div>
              </section>
            ))}

            <footer className="mt-4 pt-8 pb-16" style={{ borderTop: `1px solid ${pg.line}`, fontFamily: FONTS.sans }}>
              <p className="text-lg mb-1" style={{ color: pg.fg }}>{readCount >= parts.length ? "You have finished this lesson." : "End of lesson."}</p>
              <p className="text-sm mb-4" style={{ color: pg.muted }}>{readCount} of {parts.length} parts read.</p>
              <div className="flex flex-wrap gap-3 text-sm">
                {data.prev && <Link href={`/lessons/study/${data.prev.runId}/${data.prev.subsectionId}`} style={{ color: pg.soft }}>← {data.prev.title}</Link>}
                <Link href="/lessons/study" style={{ color: pg.soft }}>Library</Link>
                {data.next && <Link href={`/lessons/study/${data.next.runId}/${data.next.subsectionId}`} className="font-semibold" style={{ color: ACCENT }}>Next lesson: {data.next.title} →</Link>}
              </div>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}

type Page = typeof PAGES.site;

function Toc({ parts, read, current, jump, pg }: { parts: { topic: LessonTopic }[]; read: Set<string>; current: string | null; jump: (id: string) => void; pg: Page }) {
  return (
    <ol className="space-y-0.5 mt-1" style={{ fontFamily: FONTS.sans, fontSize: 13 }}>
      {parts.map(({ topic }, i) => {
        const active = current === topic.id;
        return (
          <li key={topic.id}>
            <button className="w-full text-left flex gap-2 py-1 px-2 rounded-md" style={{ background: active ? "rgba(124,58,237,0.12)" : "transparent", color: active ? ACCENT : pg.soft }} onClick={() => jump(topic.id)} aria-current={active ? "true" : undefined}>
              <span style={{ minWidth: 14, color: read.has(topic.id) ? "#16a34a" : pg.muted }}>{read.has(topic.id) ? "✓" : i + 1}</span>
              <span>{topic.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PartView({ part, pg, body }: { part: LessonPart; pg: Page; body: number }) {
  const c = part.content;
  const small = Math.round(body * 0.9);
  const box = { background: pg.card, border: `1px solid ${pg.line}`, borderRadius: 14, padding: "1rem 1.25rem" } as const;
  const label = { fontFamily: FONTS.sans, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: pg.muted, marginBottom: 6 } as const;
  const p = { margin: "0 0 1.1em", color: pg.fg } as const;
  return (
    <div>
      {c.objectives.length > 0 && (
        <div style={{ ...box, marginBottom: "1.6em" }}>
          <p style={label}>What you will learn</p>
          <ul style={{ paddingLeft: "1.2em", margin: 0, color: pg.soft, fontSize: small }}>{c.objectives.map((o, i) => <li key={i} style={{ marginBottom: 4 }}>{o}</li>)}</ul>
        </div>
      )}
      {c.whyItMatters && <p style={{ ...p, color: pg.soft, fontStyle: "italic" }}>{c.whyItMatters}</p>}

      {c.sections.map((s, i) => (
        <div key={i} style={{ marginTop: "1.8em" }}>
          <h3 style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontSize: Math.round(body * 1.15), lineHeight: 1.35, margin: "0 0 0.6em", color: pg.fg }}>{s.heading}</h3>
          {paragraphs(s.body).map((t, j) => <p key={j} style={p}>{t}</p>)}
        </div>
      ))}

      {c.keyTerms.length > 0 && (
        <div style={{ ...box, marginTop: "2em" }}>
          <p style={label}>Key terms</p>
          <dl style={{ margin: 0, fontSize: small }}>
            {c.keyTerms.map((k, i) => (
              <div key={i} style={{ marginBottom: 8 }}><dt style={{ fontWeight: 700, color: pg.fg }}>{k.term}</dt><dd style={{ margin: 0, color: pg.soft }}>{k.definition}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {c.misconceptions.length > 0 && (
        <div style={{ ...box, marginTop: "1.2em", borderLeft: "4px solid #d97706" }}>
          <p style={label}>Watch out</p>
          <ul style={{ paddingLeft: "1.2em", margin: 0, fontSize: small, color: pg.soft }}>
            {c.misconceptions.map((m, i) => <li key={i} style={{ marginBottom: 6 }}><em>{m.misconception}</em> {m.correction}</li>)}
          </ul>
        </div>
      )}

      {c.mcatFocus && (
        <div style={{ ...box, marginTop: "1.2em", borderLeft: `4px solid ${ACCENT}` }}>
          <p style={label}>On the MCAT</p>
          <p style={{ margin: 0, fontSize: small, color: pg.soft }}>{c.mcatFocus}</p>
        </div>
      )}

      {c.summary && (
        <div style={{ marginTop: "1.8em", paddingTop: "1em", borderTop: `1px solid ${pg.line}` }}>
          <p style={label}>Recap</p>
          <p style={{ ...p, margin: 0 }}>{c.summary}</p>
        </div>
      )}

      {(c.references.length > 0 || c.sourceBasis) && (
        <details style={{ marginTop: "1.2em", fontFamily: FONTS.sans, fontSize: 12, color: pg.muted }}>
          <summary style={{ cursor: "pointer" }}>Sources</summary>
          <p style={{ margin: "6px 0 0" }}>{c.sourceBasis}</p>
          {c.references.length > 0 && <p style={{ margin: "6px 0 0" }}>Model-stated references, not verified: {c.references.map((r) => r.citation).join("; ")}</p>}
        </details>
      )}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <LessonsNavbar />
      <main className="max-w-3xl mx-auto w-full px-4 md:px-6 py-8 flex-1 space-y-3">{children}</main>
    </div>
  );
}

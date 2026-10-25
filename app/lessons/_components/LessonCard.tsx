"use client";
import { useState } from "react";
import { Badge, btn } from "./ui";
import type { Lesson } from "../../../lib/lessons/types";

const STATUS_LABEL: Record<string, string> = { writing: "Writing", draft: "draft", approved: "approved", rejected: "rejected" };

/** One lesson = one subsection (MS-1-SS-2), shown as organized parts, one per split topic. */
export default function LessonCard({ lesson, onDecide, defaultOpen = false }: { lesson: Lesson; onDecide: (l: Lesson, action: "approve" | "reject") => Promise<void>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const written = lesson.parts.filter((p) => p.part).length;
  const writing = lesson.status === "writing";

  async function act(action: "approve" | "reject") {
    setBusy(true);
    try { await onDecide(lesson, action); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
      <button className="w-full text-left p-3 flex items-start gap-2" onClick={() => setOpen((v) => !v)}>
        <span className="text-xs font-mono mt-0.5" style={{ color: "var(--text-muted)", minWidth: 84 }}>{lesson.subsectionId}</span>
        <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>{lesson.title}</span>
        <span className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{written}/{lesson.parts.length} parts</span>
        {writing ? <span className="text-xs mt-0.5" style={{ color: "#d97706" }}>{STATUS_LABEL.writing}</span> : <Badge status={lesson.status} />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-4 text-sm" style={{ color: "var(--text-secondary)" }}>
          {lesson.scope && <p className="italic">{lesson.scope}</p>}

          <div>
            <b style={{ color: "var(--text-primary)" }}>In this lesson</b>
            <ol className="list-decimal pl-5 mt-1 space-y-0.5">
              {lesson.parts.map(({ topic, part }) => <li key={topic.id} style={{ color: part ? undefined : "var(--text-muted)" }}>{topic.title}{part ? "" : " (not written yet)"}</li>)}
            </ol>
          </div>

          {lesson.parts.map(({ topic, part }, i) => part && (
            <section key={topic.id} className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <h4 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                <span className="text-xs font-mono mr-2" style={{ color: "var(--text-muted)" }}>Part {i + 1}</span>{topic.title}
              </h4>
              <div>
                <b style={{ color: "var(--text-primary)" }}>Objectives</b>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">{part.content.objectives.map((o, k) => <li key={k}>{o}</li>)}</ul>
              </div>
              {part.content.whyItMatters && <div><b style={{ color: "var(--text-primary)" }}>Why it matters.</b> {part.content.whyItMatters}</div>}
              {part.content.sections.map((s, k) => (
                <div key={k}>
                  <b style={{ color: "var(--text-primary)" }}>{s.heading}</b>
                  {s.body.split(/\n\s*\n/).map((p, j) => <p key={j} className="mt-1.5 leading-relaxed">{p}</p>)}
                </div>
              ))}
              {part.content.keyTerms.length > 0 && (
                <div>
                  <b style={{ color: "var(--text-primary)" }}>Key terms</b>
                  <dl className="mt-1 space-y-1">{part.content.keyTerms.map((k, j) => <div key={j}><dt className="inline font-semibold">{k.term}: </dt><dd className="inline">{k.definition}</dd></div>)}</dl>
                </div>
              )}
              {part.content.misconceptions.length > 0 && (
                <div>
                  <b style={{ color: "var(--text-primary)" }}>Common misconceptions</b>
                  <ul className="list-disc pl-5 mt-1 space-y-1">{part.content.misconceptions.map((m, j) => <li key={j}><i>{m.misconception}</i> {m.correction}</li>)}</ul>
                </div>
              )}
              {part.content.mcatFocus && <div><b style={{ color: "var(--text-primary)" }}>On the MCAT.</b> {part.content.mcatFocus}</div>}
              <div><b style={{ color: "var(--text-primary)" }}>Summary.</b> {part.content.summary}</div>
              <div className="text-xs space-y-0.5" style={{ color: "var(--text-muted)" }}>
                <div>Basis: {part.content.sourceBasis || "not stated"}</div>
                {part.content.references.length > 0 && <div>References (model-stated, not verified): {part.content.references.map((r) => r.citation).join("; ")}</div>}
                {part.findings.map((f, j) => <div key={j} style={{ color: "#d97706" }}>{f.message}</div>)}
                {part.model && <div>Model: {part.model}</div>}
              </div>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button style={btn("primary", busy || writing || lesson.status === "approved")} disabled={busy || writing || lesson.status === "approved"} onClick={() => act("approve")}>{lesson.status === "rejected" ? "Approve instead" : "Approve lesson"}</button>
            <button style={btn("danger", busy || writing || lesson.status === "rejected")} disabled={busy || writing || lesson.status === "rejected"} onClick={() => act("reject")}>Reject lesson</button>
            {writing && <span className="text-xs" style={{ color: "var(--text-muted)" }}>A lesson can be approved once every part is written.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

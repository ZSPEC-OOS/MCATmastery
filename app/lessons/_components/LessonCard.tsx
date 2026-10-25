"use client";
import { useState } from "react";
import { btn } from "./ui";
import { isComplete } from "../../../lib/lessons/types";
import type { Lesson } from "../../../lib/lessons/types";

// Status chip. Everything a lesson can be, in plain words.
const LABEL: Record<string, { text: string; color: string }> = {
  not_chosen: { text: "Not in this run", color: "var(--text-muted)" },
  not_started: { text: "Queued, not started", color: "var(--text-muted)" },
  writing: { text: "Writing", color: "#d97706" },
  incomplete: { text: "Incomplete", color: "#d97706" },
  checking: { text: "Awaiting AI check", color: "#2563eb" },
  ai_approved: { text: "AI approved", color: "#16a34a" },
  flagged: { text: "Flagged for you", color: "#dc2626" },
  approved: { text: "Approved", color: "#16a34a" },
  rejected: { text: "Rejected", color: "#dc2626" },
};

/** One lesson = one subsection (MS-1-SS-2), shown as organized parts, one per split topic. */
export default function LessonCard({ lesson, onDecide, onQueue, defaultOpen = false }: { lesson: Lesson; onDecide: (l: Lesson, action: "approve" | "reject") => Promise<void>; onQueue?: (l: Lesson) => Promise<void>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const written = lesson.parts.filter((p) => p.part).length;
  const notReady = !isComplete(lesson.status) || lesson.status === "checking";
  const chip = LABEL[!lesson.inRun && lesson.status === "not_started" ? "not_chosen" : lesson.status];
  const queued = lesson.status === "not_started" && lesson.pending > 0 ? { text: "Queued", color: "var(--text-muted)" } : null;
  const shown = queued ?? chip;

  // One-click action on the row itself: add a lesson that is not in the run, or rewrite a finished one.
  const quick = !onQueue || lesson.pending > 0 ? null
    : !lesson.inRun ? { label: "Add to run", primary: true, confirm: "" }
      : isComplete(lesson.status) && lesson.status !== "checking" ? { label: "Rewrite", primary: false, confirm: "Write this lesson again? Its AI check and any decision are cleared." }
        : null;

  async function queue() {
    setBusy(true);
    try { await onQueue?.(lesson); } finally { setBusy(false); }
  }

  async function act(action: "approve" | "reject") {
    setBusy(true);
    try { await onDecide(lesson, action); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
      <div className="flex items-start">
        <button className="flex-1 text-left p-3 flex items-start gap-2 min-w-0" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="text-xs font-mono mt-0.5 shrink-0" style={{ color: "var(--text-muted)", minWidth: 68 }}>{lesson.subsectionId}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>{lesson.title}</span>
            <span className="block sm:hidden text-xs font-semibold mt-0.5" style={{ color: shown.color }}>{shown.text} · {written}/{lesson.parts.length} parts</span>
          </span>
          <span className="hidden sm:inline text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{written}/{lesson.parts.length} parts</span>
          <span className="hidden sm:inline text-xs mt-0.5 whitespace-nowrap font-semibold" style={{ color: shown.color }}>{shown.text}</span>
        </button>
        {quick && (
          <button
            className="m-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={quick.primary ? { background: "#7c3aed", color: "#fff", border: "1px solid #7c3aed", opacity: busy ? 0.5 : 1 } : { border: "1px solid var(--border)", color: "var(--text-secondary)", opacity: busy ? 0.5 : 1 }}
            disabled={busy}
            onClick={() => { if (!quick.confirm || confirm(quick.confirm)) queue(); }}
          >
            {quick.label}
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-4 text-sm" style={{ color: "var(--text-secondary)" }}>
          {lesson.scope && <p className="italic">{lesson.scope}</p>}

          {lesson.ai && (
            <div className="rounded-lg p-3 space-y-1.5" style={{ border: `1px solid ${lesson.ai.verdict === "pass" ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)"}`, background: "var(--bg-card)" }}>
              <b style={{ color: lesson.ai.verdict === "pass" ? "#16a34a" : "#dc2626" }}>
                AI check: {lesson.ai.verdict === "pass" ? "passed" : "errors remain, needs your decision"}
                {lesson.ai.round > 0 ? ` (after ${lesson.ai.round} correction round${lesson.ai.round === 1 ? "" : "s"})` : ""}
              </b>
              {lesson.ai.issues.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5 text-xs">
                  {lesson.ai.issues.map((i, k) => (
                    <li key={k} style={{ color: i.severity === "error" ? "#dc2626" : undefined }}>
                      <b>{i.severity === "error" ? "Error" : "Note"}</b>{i.topicId ? ` · ${lesson.parts.find((p) => p.topic.id === i.topicId)?.topic.title ?? i.topicId}` : ""}: {i.message}{i.suggestedFix ? ` Fix: ${i.suggestedFix}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
                {part.model && <div>Model: {part.model}{part.corrections ? ` · rewritten ${part.corrections}× after the AI check` : ""}</div>}
              </div>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button style={btn("primary", busy || notReady || lesson.status === "approved")} disabled={busy || notReady || lesson.status === "approved"} onClick={() => act("approve")}>{lesson.status === "rejected" ? "Approve instead" : lesson.status === "ai_approved" ? "Confirm approval" : "Approve lesson"}</button>
            <button style={btn("danger", busy || notReady || lesson.status === "rejected")} disabled={busy || notReady || lesson.status === "rejected"} onClick={() => act("reject")}>Reject lesson</button>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{notReady ? "Available once every part is written and the AI check is done." : "Your decision is optional and overrides the AI check."}</span>
          </div>
        </div>
      )}
    </div>
  );
}

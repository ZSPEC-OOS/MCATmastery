"use client";
import { useState } from "react";
import { Badge, btn } from "./ui";
import type { LessonDoc } from "../../../lib/lessons/types";

export default function LessonCard({ c, onDecide, defaultOpen = false }: { c: LessonDoc; onDecide: (c: LessonDoc, action: "approve" | "reject") => Promise<void>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const l = c.content;

  async function act(action: "approve" | "reject") {
    setBusy(true);
    try { await onDecide(c, action); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
      <button className="w-full text-left p-3 flex items-start gap-2" onClick={() => setOpen((v) => !v)}>
        <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{l.title}</span>
        <Badge status={c.status} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <div>
            <b style={{ color: "var(--text-primary)" }}>Objectives</b>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">{l.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </div>

          {l.whyItMatters && <div><b style={{ color: "var(--text-primary)" }}>Why it matters.</b> {l.whyItMatters}</div>}

          {l.sections.map((s, i) => (
            <div key={i}>
              <b style={{ color: "var(--text-primary)" }}>{s.heading}</b>
              {s.body.split(/\n\s*\n/).map((p, j) => <p key={j} className="mt-1.5 leading-relaxed">{p}</p>)}
            </div>
          ))}

          {l.keyTerms.length > 0 && (
            <div>
              <b style={{ color: "var(--text-primary)" }}>Key terms</b>
              <dl className="mt-1 space-y-1">{l.keyTerms.map((k, i) => <div key={i}><dt className="inline font-semibold">{k.term}: </dt><dd className="inline">{k.definition}</dd></div>)}</dl>
            </div>
          )}

          {l.misconceptions.length > 0 && (
            <div>
              <b style={{ color: "var(--text-primary)" }}>Common misconceptions</b>
              <ul className="list-disc pl-5 mt-1 space-y-1">{l.misconceptions.map((m, i) => <li key={i}><i>{m.misconception}</i> {m.correction}</li>)}</ul>
            </div>
          )}

          {l.mcatFocus && <div><b style={{ color: "var(--text-primary)" }}>On the MCAT.</b> {l.mcatFocus}</div>}

          <div><b style={{ color: "var(--text-primary)" }}>Summary.</b> {l.summary}</div>

          <div className="text-xs space-y-0.5" style={{ color: "var(--text-muted)" }}>
            <div>Basis: {l.sourceBasis || "not stated"}</div>
            {l.references.length > 0 && <div>References (model-stated, not verified): {l.references.map((r) => r.citation).join("; ")}</div>}
            {c.findings.map((f, i) => <div key={i} style={{ color: "#d97706" }}>{f.message}</div>)}
            {c.model && <div>Model: {c.model}</div>}
          </div>

          <div className="flex gap-2">
            <button style={btn("primary", busy || c.status === "approved")} disabled={busy || c.status === "approved"} onClick={() => act("approve")}>{c.status === "rejected" ? "Approve instead" : "Approve"}</button>
            <button style={btn("danger", busy || c.status === "rejected")} disabled={busy || c.status === "rejected"} onClick={() => act("reject")}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

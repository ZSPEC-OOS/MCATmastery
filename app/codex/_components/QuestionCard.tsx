"use client";
import { useState } from "react";
import { Badge, btn } from "./ui";
import type { CodexQuestion } from "../../../lib/codex/types";

export default function QuestionCard({ q, onDecide }: { q: CodexQuestion; onDecide: (q: CodexQuestion, action: "approve" | "reject", override?: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = q.content;
  const errors = q.findings.filter((f) => f.severity === "error");
  const warnings = q.findings.filter((f) => f.severity === "warning");
  const blind = q.verification?.blind;
  const decided = q.status === "approved" || q.status === "rejected";

  async function act(action: "approve" | "reject") {
    let override = false;
    if (action === "approve" && q.status === "flagged") {
      if (!confirm("This question has an unresolved blocking finding from AI verification. Approve it anyway?")) return;
      override = true;
    }
    setBusy(true);
    try { await onDecide(q, action, override); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
      <button className="w-full text-left p-3 flex items-start gap-2" onClick={() => setOpen((v) => !v)}>
        <span className="text-xs font-mono mt-0.5" style={{ color: "var(--text-muted)", minWidth: 96 }}>{q.qid}</span>
        <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{c.stem.length > 160 && !open ? `${c.stem.slice(0, 160)}…` : c.stem}</span>
        <Badge status={q.status} />
        {q.status === "approved" && q.approvedBy === "ai" && <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>by AI</span>}
        {q.revision > 1 && <span className="text-xs" style={{ color: "var(--text-muted)" }}>r{q.revision}</span>}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {c.purpose && <p className="text-xs italic" style={{ color: "var(--text-secondary)" }}>Purpose: {c.purpose}</p>}

          {c.passage && (
            <blockquote className="text-sm leading-relaxed rounded-lg p-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: "3px solid #0d9488", color: "var(--text-primary)" }}>
              {c.passage}
            </blockquote>
          )}

          <ul className="space-y-1.5">
            {c.options.map((o) => {
              const key = o.key === c.correctKey;
              return (
                <li key={o.key} className="text-sm rounded-lg p-2" style={{ background: key ? "rgba(22,163,74,0.10)" : "var(--bg-card)", border: `1px solid ${key ? "rgba(22,163,74,0.4)" : "var(--border)"}`, color: "var(--text-primary)" }}>
                  <b>{o.key}.</b> {o.text}
                  {o.rationale && <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Why not: {o.rationale}</div>}
                </li>
              );
            })}
          </ul>

          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            <b style={{ color: "var(--text-primary)" }}>Explanation.</b> {c.explanation}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>{c.cognitiveSkill.replace(/_/g, " ")}</span><span>{c.reasoningDemand}</span><span>{c.difficulty}</span>
            {q.model && <span>model: {q.model}</span>}
          </div>
          {c.references.length > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              References (model-asserted, not verified): {c.references.map((r) => r.citation).join("; ")}
            </p>
          )}

          {blind && (
            <p className="text-xs" style={{ color: blind.agrees ? "#16a34a" : "var(--accent-red)" }}>
              Blind solve chose {blind.chosenKey} ({blind.confidence || "no confidence given"}) — {blind.agrees ? "matches the key" : `disagrees with key ${c.correctKey}`}.
            </p>
          )}
          {q.coverage && (
            <p className="text-xs" style={{ color: q.coverage.verdict === "sufficient" ? "#16a34a" : "#d97706" }}>
              Coverage of the parent: {q.coverage.verdict}.
            </p>
          )}

          {errors.length > 0 && (
            <ul className="text-xs space-y-1" style={{ color: "var(--accent-red)" }}>
              {errors.map((f, i) => <li key={i}>● {f.message}{f.suggestedFix ? ` — Suggested fix: ${f.suggestedFix}` : ""}</li>)}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="text-xs space-y-1" style={{ color: "#d97706" }}>
              {warnings.map((f, i) => <li key={i}>○ {f.message}</li>)}
            </ul>
          )}

          <div className="flex gap-2">
            <button style={btn("primary", busy || q.status === "approved")} disabled={busy || q.status === "approved"} onClick={() => act("approve")}>Approve</button>
            <button style={btn("danger", busy || q.status === "rejected")} disabled={busy || q.status === "rejected"} onClick={() => act("reject")}>Reject</button>
            {decided && q.decidedAt && <span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>{new Date(q.decidedAt).toLocaleString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

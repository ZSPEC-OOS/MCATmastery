// Shared style helpers for the Lessons pages. Mastery's CSS variables (so light/dark themes just work) and the
// generic card/input/badge/fetcher helpers come from Codex; the accent colour and buttons are Lessons' own.
import type { CSSProperties } from "react";

export { Badge, card, fetcher, input } from "../../codex/_components/ui";

export const ACCENT = "#7c3aed";

export const btn = (variant: "primary" | "ghost" | "danger" = "ghost", disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  ...(variant === "primary"
    ? { background: ACCENT, color: "#fff", border: `1px solid ${ACCENT}` }
    : variant === "danger"
      ? { background: "transparent", color: "var(--accent-red)", border: "1px solid var(--accent-red)" }
      : { background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)" }),
});

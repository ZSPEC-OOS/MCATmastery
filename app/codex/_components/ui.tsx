// Small shared style helpers for the Codex pages (Mastery's CSS variables, so light/dark themes just work).
import type { CSSProperties } from "react";

export const TEAL = "#0d9488";

export const card: CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14 };

export const input: CSSProperties = {
  background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 10, padding: "8px 12px", fontSize: 14, width: "100%",
};

export const btn = (variant: "primary" | "ghost" | "danger" = "ghost", disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  ...(variant === "primary"
    ? { background: TEAL, color: "#fff", border: `1px solid ${TEAL}` }
    : variant === "danger"
      ? { background: "transparent", color: "var(--accent-red)", border: "1px solid var(--accent-red)" }
      : { background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)" }),
});

export const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft:       { label: "Draft",           color: "#8093B0" },
  auto_passed: { label: "AI review passed", color: "#2563eb" },
  flagged:     { label: "Flagged",         color: "#d97706" },
  approved:    { label: "Approved",        color: "#16a34a" },
  rejected:    { label: "Rejected",        color: "#dc2626" },
  superseded:  { label: "Superseded",      color: "#8093B0" },
};

export function Badge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, color: "#8093B0" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: s.color, background: `${s.color}1f`, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? `Request failed (${r.status})`);
    return d;
  });

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearCurrentUser } from "../../components/PinAuth";
import ThemeToggle from "../../components/ThemeToggle";

export default function CodexNavbar() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-sm" style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/codex" className="text-lg font-bold" style={{ fontFamily: "var(--font-playfair), Georgia, serif", color: "var(--text-primary)" }}>
            MCAT <span style={{ color: "#0d9488" }}>Codex</span>
          </Link>
          <div className="flex items-center gap-0.5">
            {[{ href: "/codex", label: "Build" }, { href: "/codex/study", label: "Study" }].map((l) => {
              const active = l.href === "/codex" ? pathname === "/codex" || (pathname.startsWith("/codex/") && !pathname.startsWith("/codex/study")) : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: active ? "#0d9488" : "var(--text-secondary)", background: active ? "rgba(13,148,136,0.1)" : "transparent", fontWeight: active ? 600 : 500 }}>
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: "var(--text-secondary)" }}>All apps</Link>
          <Link href="/mastery" className="hidden sm:inline px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Mastery</Link>
          <ThemeToggle />
          <button
            onClick={async () => { await clearCurrentUser(); window.location.href = "/"; }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}
          >
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}

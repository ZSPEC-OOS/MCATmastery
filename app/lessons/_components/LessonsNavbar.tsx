"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearCurrentUser } from "../../components/PinAuth";
import ThemeToggle from "../../components/ThemeToggle";
import { ACCENT } from "./ui";

export default function LessonsNavbar() {
  const pathname = usePathname();
  const tabs = [
    { href: "/lessons", label: "Build", active: !pathname.startsWith("/lessons/study") },
    { href: "/lessons/study", label: "Study", active: pathname.startsWith("/lessons/study") },
  ];
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-sm" style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/lessons" className="text-lg font-bold" style={{ fontFamily: "var(--font-playfair), Georgia, serif", color: "var(--text-primary)" }}>
            MCAT <span style={{ color: ACCENT }}>Lessons</span>
          </Link>
          <div className="flex items-center gap-0.5">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: t.active ? ACCENT : "var(--text-secondary)", background: t.active ? "rgba(124,58,237,0.1)" : "transparent", fontWeight: t.active ? 600 : 500 }}>
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/codex/database" className="hidden sm:inline px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Database</Link>
          <Link href="/" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: "var(--text-secondary)" }}>All apps</Link>
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

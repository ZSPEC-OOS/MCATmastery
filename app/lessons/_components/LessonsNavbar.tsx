"use client";
import Link from "next/link";
import { clearCurrentUser } from "../../components/PinAuth";
import ThemeToggle from "../../components/ThemeToggle";
import { ACCENT } from "./ui";

export default function LessonsNavbar() {
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-sm" style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        <Link href="/lessons" className="text-lg font-bold" style={{ fontFamily: "var(--font-playfair), Georgia, serif", color: "var(--text-primary)" }}>
          MCAT <span style={{ color: ACCENT }}>Lessons</span>
        </Link>
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

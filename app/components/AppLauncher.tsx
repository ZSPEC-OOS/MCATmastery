"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { clearCurrentUser, getCurrentUser } from "./PinAuth";
import ThemeToggle from "./ThemeToggle";

const APPS = [
  {
    href: "/mastery",
    title: "MCAT Mastery",
    blurb: "Adaptive practice, review, analytics and the question bank.",
    accent: "#4f46e5",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" />
      </svg>
    ),
  },
  {
    href: "/codex",
    title: "MCAT Codex",
    blurb: "Sub-Codex in, structured parent and atomic questions out — planned, verified and approved by you.",
    accent: "#0d9488",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /><path d="M9 8h6M9 12h6" />
      </svg>
    ),
  },
];

export default function AppLauncher() {
  const [name, setName] = useState("");
  useEffect(() => { setName(getCurrentUser()?.firstName ?? ""); }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-4 md:px-6 h-14 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)", background: "var(--nav-bg)" }}>
        <div className="flex items-center">
          <Image src="/logolight.PNG" alt="MCAT Mastery" width={160} height={40} className="logo-light" style={{ objectFit: "contain", height: "36px", width: "auto" }} priority />
          <Image src="/logodark.PNG" alt="MCAT Mastery" width={160} height={40} className="logo-dark" style={{ objectFit: "contain", height: "36px", width: "auto" }} priority />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={async () => { await clearCurrentUser(); window.location.href = "/"; }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}
          >
            Log out
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <h1 className="text-2xl md:text-3xl mb-1 text-center" style={{ color: "var(--text-primary)" }}>
          {name ? `Welcome, ${name}` : "Welcome"}
        </h1>
        <p className="text-sm mb-8 text-center" style={{ color: "var(--text-muted)" }}>Choose an app to open.</p>

        <div className="grid gap-5 w-full max-w-3xl md:grid-cols-2">
          {APPS.map((app) => (
            <Link
              key={app.href}
              href={app.href}
              className="group rounded-2xl p-7 flex flex-col gap-4 transition-transform hover:-translate-y-0.5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 2px 10px rgba(27,58,107,0.06)" }}
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: `${app.accent}1a`, color: app.accent }}>
                {app.icon}
              </div>
              <div>
                <h2 className="text-xl mb-1" style={{ color: "var(--text-primary)" }}>{app.title}</h2>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{app.blurb}</p>
              </div>
              <span className="text-sm font-semibold mt-auto" style={{ color: app.accent }}>Open →</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

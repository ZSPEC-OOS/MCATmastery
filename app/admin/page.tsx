"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import GenerateTab from "./_components/GenerateTab";
import SettingsTab from "./_components/SettingsTab";
import DatabaseTab from "./_components/DatabaseTab";
import FormattingTab from "./_components/FormattingTab";
import LockedTab from "./_components/LockedTab";
import CurriculumTab from "./_components/CurriculumTab";

type Tab = "generate" | "settings" | "database" | "formatting" | "locked" | "curriculum";

const ADMIN_USER = "admin";
const ADMIN_PASS = "MCATadmin";

function LoginGate({ onAuth }: { onAuth: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(false);
  const [shake, setShake]       = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      sessionStorage.setItem("admin_auth", "1");
      onAuth();
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4">
        <form
          onSubmit={handleSubmit}
          className={`w-full max-w-sm rounded-xl p-8 space-y-5 ${shake ? "animate-shake" : ""}`}
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          <div className="text-center mb-2">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: "rgba(27,58,107,0.15)", border: "1px solid rgba(27,58,107,0.3)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Admin Access</h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Sign in to continue</p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(false); }}
              autoComplete="username"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{
                background: "var(--bg-input)",
                border: `1px solid ${error ? "rgba(224,92,92,0.6)" : "var(--border)"}`,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              autoComplete="current-password"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{
                background: "var(--bg-input)",
                border: `1px solid ${error ? "rgba(224,92,92,0.6)" : "var(--border)"}`,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>

          {error && (
            <p className="text-xs text-center" style={{ color: "#e05c5c" }}>
              Invalid username or password
            </p>
          )}

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "var(--accent-blue)", color: "#fff", border: "none" }}
          >
            Sign In
          </button>
        </form>
      </main>
      <Footer />

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.4s ease; }
      `}</style>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab]     = useState<Tab>("generate");
  const [authed, setAuthed] = useState(false);
  const [ready, setReady]   = useState(false);

  useEffect(() => {
    setAuthed(sessionStorage.getItem("admin_auth") === "1");
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!authed) return <LoginGate onAuth={() => setAuthed(true)} />;

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <div className="max-w-6xl mx-auto w-full px-4 md:px-6 py-6 flex-1">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/mastery" className="text-sm flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Dashboard
          </Link>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Admin Panel</h1>
          <button
            onClick={() => { sessionStorage.removeItem("admin_auth"); setAuthed(false); }}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}
          >
            Sign Out
          </button>
        </div>

        <div
          className="flex gap-0 mb-6 overflow-x-auto sm:overflow-x-visible"
          style={{
            borderBottom: "1px solid var(--border)",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {(["generate", "database", "formatting", "locked", "curriculum", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 sm:px-5 pb-2.5 text-sm font-medium whitespace-nowrap flex-shrink-0"
              style={{
                color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: tab === t ? "2px solid var(--accent-blue)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t === "generate"    ? "Question Generation"
                : t === "database"    ? "Audit"
                : t === "formatting"  ? "Formatting"
                : t === "locked"      ? "Locked"
                : t === "curriculum"  ? "Curriculum"
                : "Settings"}
            </button>
          ))}
        </div>

        {tab === "generate"    && <GenerateTab />}
        {tab === "settings"    && <SettingsTab />}
        {tab === "database"    && <DatabaseTab />}
        {tab === "formatting"  && <FormattingTab />}
        {tab === "locked"      && <LockedTab />}
        {tab === "curriculum"  && <CurriculumTab />}
      </div>

      <Footer />
    </div>
  );
}

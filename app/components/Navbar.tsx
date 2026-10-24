"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clearCurrentUser } from "./PinAuth";
import ThemeToggle from "./ThemeToggle";

const navLinks = [
  { label: "Dashboard",  href: "/mastery" },
  { label: "Practice",   href: "/practice" },
  { label: "Review",     href: "/review" },
  { label: "Analytics",  href: "/analytics" },
  { label: "All apps",   href: "/" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" || href === "/mastery" ? pathname === href : pathname.startsWith(href);

  return (
    <>
      <nav
        style={{
          background: "var(--nav-bg)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 1px 4px rgba(27,58,107,0.06)",
        }}
        className="sticky top-0 z-50 backdrop-blur-sm"
      >
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">

          {/* Logo — swaps with theme */}
          <Link href="/" className="flex items-center">
            <Image
              src="/logolight.PNG"
              alt="MCAT Mastery"
              width={160}
              height={40}
              className="logo-light"
              style={{ objectFit: "contain", height: "36px", width: "auto" }}
              priority
            />
            <Image
              src="/logodark.PNG"
              alt="MCAT Mastery"
              width={160}
              height={40}
              className="logo-dark"
              style={{ objectFit: "contain", height: "36px", width: "auto" }}
              priority
            />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-4 py-1.5 rounded-lg text-sm transition-colors"
                style={{
                  color: isActive(link.href) ? "var(--accent-blue)" : "var(--text-secondary)",
                  background: isActive(link.href) ? "rgba(27,58,107,0.08)" : "transparent",
                  fontWeight: isActive(link.href) ? 600 : 500,
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1">
            {/* Theme toggle — always visible */}
            <ThemeToggle />

            {/* Gear — always visible */}
            <Link
              href="/admin"
              className="w-9 h-9 flex items-center justify-center rounded-lg"
              style={{ color: "var(--text-muted)" }}
              title="Admin Settings"
            >
              <SettingsIcon />
            </Link>

            {/* Logout — always visible */}
            <button
              onClick={async () => { await clearCurrentUser(); window.location.href = "/"; }}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}
              title="Log out"
            >
              <LogoutIcon />
              Log out
            </button>

            {/* Hamburger — mobile only */}
            <button
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg"
              style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div
          className="md:hidden sticky top-14 z-40 w-full"
          style={{
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
            boxShadow: "0 4px 12px rgba(27,58,107,0.08)",
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="flex items-center px-5 py-3.5 text-sm font-medium"
              style={{
                color: isActive(link.href) ? "var(--accent-blue)" : "var(--text-secondary)",
                borderLeft: isActive(link.href) ? "2px solid var(--accent-blue)" : "2px solid transparent",
                background: isActive(link.href) ? "rgba(27,58,107,0.05)" : "transparent",
                borderBottom: "1px solid rgba(27,58,107,0.05)",
              }}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/admin"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-5 py-3.5 text-sm font-medium"
            style={{
              color: pathname.startsWith("/admin") ? "var(--accent-blue)" : "var(--text-muted)",
              borderLeft: pathname.startsWith("/admin") ? "2px solid var(--accent-blue)" : "2px solid transparent",
              background: pathname.startsWith("/admin") ? "rgba(27,58,107,0.05)" : "transparent",
              borderTop: "1px solid var(--border)",
            }}
          >
            <SettingsIcon />
            Admin
          </Link>
          <button
            onClick={async () => { await clearCurrentUser(); window.location.href = "/"; }}
            className="flex items-center gap-2.5 px-5 py-3.5 text-sm font-medium w-full text-left"
            style={{ color: "#e05c5c", borderTop: "1px solid var(--border)" }}
          >
            <LogoutIcon />
            Log out
          </button>
        </div>
      )}
    </>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/topics", label: "Topic Wise", icon: "📑" },
  { href: "/mock", label: "Mock", icon: "📝" },
];

export function BottomNav() {
  const pathname = usePathname();

  // Hidden inside the admin panel and during an attempt — both have their own
  // bottom bars, and an exam shouldn't offer navigation away mid-test.
  if (pathname.startsWith("/admin") || pathname.startsWith("/attempt")) return null;
  if (pathname === "/login") return null;

  return (
    <>
      {/* Spacer so page content can scroll clear of the fixed bar. */}
      <div className="h-20" aria-hidden="true" />
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((tab) => {
            const active =
              tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${
                    active ? "text-brand" : "text-muted"
                  }`}
                >
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full text-base ${
                      active ? "bg-brand/10" : ""
                    }`}
                    aria-hidden="true"
                  >
                    {tab.icon}
                  </span>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

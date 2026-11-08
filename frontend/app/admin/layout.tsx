"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/exams", label: "Exams" },
  { href: "/admin/topics", label: "Topics" },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/papers", label: "Papers" },
  { href: "/admin/upload", label: "CSV upload" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (user.role !== "admin") router.replace("/");
  }, [user, loading, router, pathname]);

  if (loading || !user || user.role !== "admin") return <Spinner label="Checking access…" />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Admin</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-brand hover:underline">
            View app
          </Link>
          <button onClick={logout} className="text-muted hover:underline">
            Sign out
          </button>
        </div>
      </div>

      <nav className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-3">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                active ? "bg-brand text-brand-contrast" : "text-muted hover:bg-surface"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

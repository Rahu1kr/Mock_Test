"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AttemptHistoryItem } from "@/lib/types";
import { Card, EmptyNote, ErrorNote, PageShell, Spinner } from "@/components/ui";

export default function HistoryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<AttemptHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/history");
      return;
    }
    api<AttemptHistoryItem[]>("/attempts")
      .then(setItems)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login?next=/history");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load history");
      });
  }, [authLoading, user, router]);

  return (
    <PageShell
      title="Attempt history"
      subtitle="Synced across your devices"
      back={{ href: "/", label: "Home" }}
    >
      {error && <ErrorNote message={error} />}
      {!items && !error && <Spinner />}
      {items && items.length === 0 && (
        <EmptyNote>You haven&apos;t attempted any papers yet.</EmptyNote>
      )}

      {items && items.length > 0 && (
        <div className="space-y-3">
          {items.map((a) => {
            const href =
              a.status === "in_progress" ? `/attempt/${a._id}` : `/attempt/${a._id}/results`;
            return (
              <Link key={a._id} href={href}>
                <Card className="transition hover:border-brand">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          {a.examId?.name ?? "Deleted section"} ·{" "}
                          {a.session ? `${a.session} ${a.year ?? ""}`.trim() : (a.year ?? "Undated")}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            a.mode === "exam"
                              ? "bg-brand/15 text-brand"
                              : "bg-muted/15 text-muted"
                          }`}
                        >
                          {a.mode === "exam" ? "Exam" : "Practice"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {new Date(a.startedAt).toLocaleString()} ·{" "}
                        {a.status === "in_progress"
                          ? "In progress — tap to resume"
                          : a.status === "auto_submitted"
                            ? "Auto-submitted (time up)"
                            : "Completed"}
                      </p>
                    </div>
                    {a.status !== "in_progress" && (
                      <div className="text-right">
                        <p className="text-lg font-semibold">{a.score ?? 0}</p>
                        <p className="text-xs text-muted">
                          {a.correctCount}✓ {a.wrongCount}✗ {a.skippedCount}–
                        </p>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

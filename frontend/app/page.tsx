"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Exam } from "@/lib/types";
import { SectionTile } from "@/components/SectionTile";
import { Button, EmptyNote, ErrorNote, Spinner } from "@/components/ui";

export default function HomePage() {
  const { user, loading: authLoading, logout } = useAuth();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Exam[]>("/exams")
      .then(setExams)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load sections"));
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Geo PYQ</h1>
          <p className="text-sm text-muted">Previous year questions · practice and exam mode</p>
        </div>
        {authLoading ? null : user ? (
          <div className="flex items-center gap-2">
            <Link href="/history">
              <Button variant="secondary">History</Button>
            </Link>
            {user.role === "admin" && (
              <Link href="/admin">
                <Button variant="secondary">Admin</Button>
              </Link>
            )}
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        ) : (
          <Link href="/login">
            <Button>Sign in</Button>
          </Link>
        )}
      </header>

      {error && <ErrorNote message={error} />}
      {!exams && !error && <Spinner label="Loading…" />}

      {exams && exams.length === 0 && (
        <EmptyNote>
          No sections yet.{" "}
          {user?.role === "admin" ? (
            <Link href="/admin/exams" className="text-brand underline">
              Add one in the admin panel
            </Link>
          ) : (
            "Ask the admin to add content."
          )}
        </EmptyNote>
      )}

      {exams && exams.length > 0 && (
        <>
          {/* Flat grid ordered by displayOrder, so UGC NET sections lead and the
              state papers follow — matching the reference app's layout. */}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {exams.map((exam) => (
              <SectionTile key={exam._id} exam={exam} />
            ))}
          </div>

          {!user && !authLoading && (
            <p className="mt-6 text-sm text-muted">
              Sign in to attempt papers and keep your score history across devices.
            </p>
          )}
        </>
      )}
    </div>
  );
}

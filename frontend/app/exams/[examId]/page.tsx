"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Exam, Paper } from "@/lib/types";
import { Card, EmptyNote, ErrorNote, PageShell, Spinner } from "@/components/ui";

export default function ExamYearsPage() {
  const { examId } = useParams<{ examId: string }>();
  const [exam, setExam] = useState<Exam | null>(null);
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Exam>(`/exams/${examId}`), api<Paper[]>(`/exams/${examId}/papers`)])
      .then(([e, p]) => {
        setExam(e);
        setPapers(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load papers"));
  }, [examId]);

  return (
    <PageShell
      title={exam?.name ?? "Papers"}
      subtitle={exam ? "Choose a year" : undefined}
      back={{ href: "/", label: "All sections" }}
    >
      {error && <ErrorNote message={error} />}
      {!papers && !error && <Spinner label="Loading papers…" />}

      {papers && papers.length === 0 && (
        <EmptyNote>No question papers have been added for this section yet.</EmptyNote>
      )}

      {papers && papers.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {papers.map((p) => (
            <Link key={p.slug} href={`/exams/${examId}/papers/${p.slug}`}>
              <Card className="h-full transition hover:border-brand">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">{p.label}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {p.questionCount} question{p.questionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-muted">›</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Exam, Paper } from "@/lib/types";
import { Card, EmptyNote, ErrorNote, Spinner } from "@/components/ui";

interface Row {
  exam: Exam;
  papers: Paper[];
}

/**
 * Read-only: papers are derived from the `year` on imported questions, so there
 * is nothing to create here. Import a year's questions and its paper appears.
 */
export default function AdminPapersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Exam[]>("/exams")
      .then(async (exams) =>
        Promise.all(
          exams.map(async (exam) => ({
            exam,
            papers: await api<Paper[]>(`/exams/${exam._id}/papers`),
          }))
        )
      )
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load papers"));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Spinner />;

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-semibold">Papers are automatic</h2>
        <p className="mt-1 text-sm text-muted">
          A paper is one year of one section. Import questions with a <code>year</code> and that
          year&apos;s paper appears for users immediately — in both practice and exam mode. There
          is nothing to build here.
        </p>
        <p className="mt-2 text-sm text-muted">
          Exam-mode duration and marking come from each section&apos;s settings on the{" "}
          <strong>Exams</strong> tab.
        </p>
      </Card>

      {rows.length === 0 && <EmptyNote>No exams yet.</EmptyNote>}

      {rows.map(({ exam, papers }) => (
        <Card key={exam._id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{exam.name}</h3>
              <p className="text-xs text-muted">
                {exam.group} · +{exam.marksCorrect}/{exam.marksWrong} ·{" "}
                {exam.minutesPerQuestion} min per question
              </p>
            </div>
            <span className="text-sm text-muted">
              {papers.length} paper{papers.length === 1 ? "" : "s"}
            </span>
          </div>

          {papers.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No questions imported yet — no papers available to users.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {papers.map((p) => (
                <div
                  key={p.slug}
                  className="rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-muted">
                    {" "}
                    · {p.questionCount}q · {p.durationMinutes}min
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

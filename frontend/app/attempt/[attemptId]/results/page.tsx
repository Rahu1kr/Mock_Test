"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { AttemptView } from "@/lib/types";
import { Button, Card, ErrorNote, PageShell, Spinner } from "@/components/ui";

export default function ResultsPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AttemptView>(`/attempts/${attemptId}`)
      .then(setAttempt)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load results"));
  }, [attemptId]);

  if (error) {
    return (
      <PageShell title="Results" back={{ href: "/history", label: "History" }}>
        <ErrorNote message={error} />
      </PageShell>
    );
  }
  if (!attempt) {
    return (
      <PageShell title="Results" back={{ href: "/history", label: "History" }}>
        <Spinner />
      </PageShell>
    );
  }

  const maxScore = attempt.questions.length * attempt.marksCorrect;
  const answerFor = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const subtitle =
    attempt.status === "auto_submitted"
      ? "Time ran out — submitted automatically"
      : attempt.mode === "practice"
        ? "Practice attempt"
        : "Exam attempt";

  return (
    <PageShell
      title={`${attempt.exam?.name ?? "Paper"} · ${attempt.paperLabel}`}
      subtitle={subtitle}
      back={{ href: "/history", label: "History" }}
      actions={
        attempt.exam ? (
          <Link href={`/exams/${attempt.exam.id}`}>
            <Button variant="secondary">Other years</Button>
          </Link>
        ) : null
      }
    >
      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Score</p>
            <p className="text-3xl font-bold">
              {attempt.score ?? 0}
              <span className="text-lg font-normal text-muted"> / {maxScore}</span>
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <Stat label="Correct" value={attempt.correctCount} className="text-correct" />
            <Stat label="Wrong" value={attempt.wrongCount} className="text-wrong" />
            <Stat label="Skipped" value={attempt.skippedCount} className="text-muted" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Marking: +{attempt.marksCorrect} correct ·{" "}
          {attempt.marksWrong === 0 ? "no negative marking" : `${attempt.marksWrong} wrong`} · 0
          skipped
        </p>
      </Card>

      <h2 className="mb-3 font-semibold">Answer review</h2>
      <div className="space-y-3">
        {attempt.questions.map((q, i) => {
          const given = answerFor.get(q.id)?.selectedOption ?? null;
          const skipped = !given;
          const correct = given === q.correctOption;
          return (
            <Card key={q.id}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-sm font-semibold text-muted">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        skipped
                          ? "bg-muted/15 text-muted"
                          : correct
                            ? "bg-correct/15 text-correct"
                            : "bg-wrong/15 text-wrong"
                      }`}
                    >
                      {skipped ? "Skipped" : correct ? "Correct" : "Wrong"}
                    </span>
                    {q.year && <span className="text-xs text-muted">{q.year}</span>}
                  </div>

                  <p className="mt-2 font-medium">{q.questionText}</p>

                  <ul className="mt-3 space-y-1.5">
                    {q.options.map((opt) => {
                      const isCorrectOpt = opt.key === q.correctOption;
                      const isGiven = opt.key === given;
                      return (
                        <li
                          key={opt.key}
                          className={`rounded-lg border px-3 py-2 text-sm ${
                            isCorrectOpt
                              ? "border-correct bg-correct/10 text-correct"
                              : isGiven
                                ? "border-wrong bg-wrong/10 text-wrong"
                                : "border-border"
                          }`}
                        >
                          <span className="mr-2 font-semibold">{opt.key}.</span>
                          {opt.text}
                          {isGiven && !isCorrectOpt && (
                            <span className="ml-2 text-xs">(your answer)</span>
                          )}
                          {isCorrectOpt && <span className="ml-2 text-xs">(correct)</span>}
                        </li>
                      );
                    })}
                  </ul>

                  {q.explanation && (
                    <p className="mt-3 rounded-xl bg-background p-3 text-sm text-muted">
                      {q.explanation}
                    </p>
                  )}
                  {q.sourceCitation && (
                    <p className="mt-2 text-xs text-muted">Source: {q.sourceCitation}</p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-semibold ${className}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Exam, Paper } from "@/lib/types";
import { Button, Card, EmptyNote, ErrorNote, PageShell, Spinner } from "@/components/ui";

interface Row {
  exam: Exam;
  paper: Paper;
}

/** Mock: every available paper in one list, each startable in exam mode. */
export default function MockPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    api<Exam[]>("/exams")
      .then(async (exams) => {
        const nested = await Promise.all(
          exams.map(async (exam) => {
            const papers = await api<Paper[]>(`/exams/${exam._id}/papers`).catch(() => []);
            return papers.map((paper) => ({ exam, paper }));
          })
        );
        return nested.flat();
      })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load papers"));
  }, []);

  async function startExam(examId: string, paper: Paper, key: string) {
    setStarting(key);
    setError(null);
    try {
      const res = await api<{ attemptId: string }>("/attempts", {
        method: "POST",
        body: { examId, year: paper.year, session: paper.session, mode: "exam" },
      });
      router.push(`/attempt/${res.attemptId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { attemptId?: string };
        if (body?.attemptId) {
          router.push(`/attempt/${body.attemptId}/results`);
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Could not start the exam");
      setStarting(null);
    }
  }

  return (
    <PageShell title="Mock" subtitle="Every paper, timed and scored">
      {error && <ErrorNote message={error} />}

      {!authLoading && !user && (
        <Card className="mb-4">
          <p className="text-sm">Sign in to attempt a mock and save your score.</p>
          <Link href="/login?next=/mock" className="mt-3 inline-block">
            <Button>Sign in to continue</Button>
          </Link>
        </Card>
      )}

      {!rows && !error && <Spinner label="Loading papers…" />}
      {rows && rows.length === 0 && (
        <EmptyNote>No papers available yet — import questions with a year first.</EmptyNote>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2.5">
          {rows.map(({ exam, paper }) => {
            const key = `${exam._id}:${paper.slug}`;
            return (
              <Card key={key}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {exam.name} · {paper.label}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {paper.questionCount} questions · {paper.durationMinutes} min · +
                      {exam.marksCorrect}
                      {exam.marksWrong !== 0 && ` / ${exam.marksWrong}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/exams/${exam._id}/papers/${paper.slug}`}>
                      <Button variant="secondary">Practice</Button>
                    </Link>
                    <Button
                      onClick={() => startExam(exam._id, paper, key)}
                      disabled={!user || starting !== null}
                    >
                      {starting === key ? "Starting…" : "Start exam"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

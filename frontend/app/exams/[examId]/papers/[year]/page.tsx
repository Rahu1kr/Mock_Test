"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AttemptMode, Exam, Paper } from "@/lib/types";
import { Button, Card, ErrorNote, PageShell, Spinner } from "@/components/ui";

/** The [year] route segment carries a paper slug, e.g. "2024-december". */
export default function ModeChooserPage() {
  const { examId, year: slug } = useParams<{ examId: string; year: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [exam, setExam] = useState<Exam | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<AttemptMode | null>(null);

  useEffect(() => {
    Promise.all([api<Exam>(`/exams/${examId}`), api<Paper[]>(`/exams/${examId}/papers`)])
      .then(([e, papers]) => {
        setExam(e);
        const match = papers.find((p) => p.slug === slug);
        if (match) setPaper(match);
        else setNotFound(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this paper"));
  }, [examId, slug]);

  async function start(mode: AttemptMode) {
    if (!paper) return;
    setStarting(mode);
    setError(null);
    try {
      const res = await api<{ attemptId: string }>("/attempts", {
        method: "POST",
        body: { examId, year: paper.year, session: paper.session, mode },
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
      setError(err instanceof Error ? err.message : "Could not start");
      setStarting(null);
    }
  }

  if (notFound) {
    return (
      <PageShell title="Paper not found" back={{ href: `/exams/${examId}`, label: "All papers" }}>
        <ErrorNote message="That paper no longer exists. Pick another from the list." />
      </PageShell>
    );
  }
  if (!exam || !paper) {
    return (
      <PageShell title="Paper" back={{ href: `/exams/${examId}`, label: "Back" }}>
        {error ? <ErrorNote message={error} /> : <Spinner />}
      </PageShell>
    );
  }

  return (
    <PageShell
      title={paper.label}
      subtitle={`${exam.name} · ${paper.questionCount} questions`}
      back={{ href: `/exams/${examId}`, label: "All papers" }}
    >
      {error && <ErrorNote message={error} />}

      {!authLoading && !user && (
        <Card className="mb-4">
          <p className="text-sm">Sign in to attempt this paper and save your score.</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/exams/${examId}/papers/${slug}`)}`}
            className="mt-3 inline-block"
          >
            <Button>Sign in to continue</Button>
          </Link>
        </Card>
      )}

      <p className="mb-3 text-sm text-muted">How do you want to attempt this paper?</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex h-full flex-col">
          <div className="flex-1">
            <div className="mb-2 text-2xl">📖</div>
            <h2 className="font-semibold">Practice mode</h2>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              <li>• All {paper.questionCount} questions on one page</li>
              <li>• Tap an option — your answer and the correct one show instantly</li>
              <li>• No timer</li>
            </ul>
          </div>
          <Button
            onClick={() => start("practice")}
            disabled={!user || starting !== null}
            className="mt-4 w-full"
          >
            {starting === "practice" ? "Opening…" : "Start practice"}
          </Button>
        </Card>

        <Card className="flex h-full flex-col">
          <div className="flex-1">
            <div className="mb-2 text-2xl">⏱️</div>
            <h2 className="font-semibold">Exam mode</h2>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              <li>• One question at a time, like the real exam</li>
              <li>• {paper.durationMinutes} minute timer with auto-submit</li>
              <li>• Question palette with mark-for-review</li>
              <li>
                • Scored +{exam.marksCorrect}
                {exam.marksWrong !== 0 && ` / ${exam.marksWrong}`} — answers only after submitting
              </li>
            </ul>
          </div>
          <Button
            onClick={() => start("exam")}
            disabled={!user || starting !== null}
            className="mt-4 w-full"
          >
            {starting === "exam" ? "Starting…" : "Start exam"}
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AttemptMode, Exam, InProgressInfo, Paper } from "@/lib/types";
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
  const [busy, setBusy] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Record<AttemptMode, InProgressInfo | null>>({
    practice: null,
    exam: null,
  });

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

  // Ask the server whether either mode already has an unfinished attempt, so
  // the user is offered a choice instead of being silently resumed.
  const refreshUnfinished = useCallback(
    async (p: Paper) => {
      if (!user) return;
      const qs = (mode: AttemptMode) =>
        `/attempts/in-progress?examId=${examId}&year=${p.year ?? ""}` +
        `&session=${encodeURIComponent(p.session)}&mode=${mode}`;
      const [practice, exam] = await Promise.all([
        api<InProgressInfo>(qs("practice")).catch(() => null),
        api<InProgressInfo>(qs("exam")).catch(() => null),
      ]);
      setUnfinished({
        practice: practice?.exists ? practice : null,
        exam: exam?.exists ? exam : null,
      });
    },
    [examId, user]
  );

  useEffect(() => {
    if (paper && user) void refreshUnfinished(paper);
  }, [paper, user, refreshUnfinished]);

  async function start(mode: AttemptMode, restart: boolean) {
    if (!paper) return;
    setBusy(`${mode}:${restart}`);
    setError(null);
    try {
      const res = await api<{ attemptId: string }>("/attempts", {
        method: "POST",
        body: { examId, year: paper.year, session: paper.session, mode, restart },
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
      setBusy(null);
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
        <ModeCard
          icon="📖"
          title="Practice mode"
          points={[
            `All ${paper.questionCount} questions on one page`,
            "Tap an option — your answer and the correct one show instantly",
            "No timer",
          ]}
          mode="practice"
          unfinished={unfinished.practice}
          disabled={!user}
          busy={busy}
          onStart={start}
        />

        <ModeCard
          icon="⏱️"
          title="Exam mode"
          points={[
            "One question at a time, like the real exam",
            `${paper.durationMinutes} minute timer with auto-submit`,
            "Question palette with mark-for-review",
            `Scored +${exam.marksCorrect}${
              exam.marksWrong !== 0 ? ` / ${exam.marksWrong}` : ""
            } — answers only after submitting`,
          ]}
          mode="exam"
          unfinished={unfinished.exam}
          disabled={!user}
          busy={busy}
          onStart={start}
          resumeNote="The clock keeps running while you are away."
        />
      </div>
    </PageShell>
  );
}

function ModeCard({
  icon,
  title,
  points,
  mode,
  unfinished,
  disabled,
  busy,
  onStart,
  resumeNote,
}: {
  icon: string;
  title: string;
  points: string[];
  mode: AttemptMode;
  unfinished: InProgressInfo | null;
  disabled: boolean;
  busy: string | null;
  onStart: (mode: AttemptMode, restart: boolean) => void;
  resumeNote?: string;
}) {
  const anyBusy = busy !== null;

  return (
    <Card className="flex h-full flex-col">
      <div className="flex-1">
        <div className="mb-2 text-2xl">{icon}</div>
        <h2 className="font-semibold">{title}</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {points.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      </div>

      {unfinished ? (
        <div className="mt-4">
          <div className="rounded-xl border border-brand/40 bg-brand/5 px-3 py-2 text-sm">
            <p className="font-medium">
              Unfinished attempt — {unfinished.answeredCount} of {unfinished.totalQuestions}{" "}
              answered
            </p>
            {resumeNote && <p className="mt-0.5 text-xs text-muted">{resumeNote}</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => onStart(mode, false)}
              disabled={disabled || anyBusy}
              className="flex-1"
            >
              {busy === `${mode}:false` ? "Opening…" : "Resume"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (
                  window.confirm(
                    `Start over? Your ${unfinished.answeredCount} saved answer(s) for this paper will be discarded.`
                  )
                ) {
                  onStart(mode, true);
                }
              }}
              disabled={disabled || anyBusy}
              className="flex-1"
            >
              {busy === `${mode}:true` ? "Starting…" : "Start over"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => onStart(mode, false)}
          disabled={disabled || anyBusy}
          className="mt-4 w-full"
        >
          {busy === `${mode}:false`
            ? "Starting…"
            : mode === "practice"
              ? "Start practice"
              : "Start exam"}
        </Button>
      )}
    </Card>
  );
}

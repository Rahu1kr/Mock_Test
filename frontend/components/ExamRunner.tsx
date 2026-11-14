"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { flushQueue, pendingCount, saveAnswer } from "@/lib/offlineQueue";
import { formatRemaining, useCountdown } from "@/lib/timer";
import type { AttemptView, OptionKey } from "@/lib/types";
import { QuestionBody, RichText } from "@/components/QuestionContent";
import { Button, Card } from "@/components/ui";

type Status = "not-visited" | "not-answered" | "answered" | "review" | "answered-review";

/** Real-exam simulation: one question at a time, countdown, and a status palette. */
export function ExamRunner({ attempt }: { attempt: AttemptView }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, OptionKey | null>>(() => {
    const init: Record<string, OptionKey | null> = {};
    for (const a of attempt.answers) init[a.questionId] = a.selectedOption;
    return init;
  });
  const [visited, setVisited] = useState<Set<string>>(new Set([attempt.questions[0]?.id]));
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [unsynced, setUnsynced] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const submittedRef = useRef(false);

  const question = attempt.questions[current];

  const submit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      await flushQueue(attempt.id).catch(() => {});
      try {
        await api(`/attempts/${attempt.id}/submit`, { method: "POST" });
      } catch {
        if (!auto) {
          submittedRef.current = false;
          setSubmitting(false);
          return;
        }
      }
      router.replace(`/attempt/${attempt.id}/results`);
    },
    [attempt.id, router]
  );

  const remaining = useCountdown(
    attempt.startedAt,
    attempt.durationMinutes,
    () => void submit(true),
    attempt.status === "in_progress"
  );

  useEffect(() => {
    const onOnline = () => {
      flushQueue(attempt.id)
        .then(() => pendingCount(attempt.id).then(setUnsynced))
        .catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [attempt.id]);

  const goTo = (index: number) => {
    setCurrent(index);
    const id = attempt.questions[index]?.id;
    if (id) setVisited((v) => new Set(v).add(id));
    setPaletteOpen(false);
  };

  async function choose(option: OptionKey) {
    const next = answers[question.id] === option ? null : option;
    setAnswers((a) => ({ ...a, [question.id]: next }));
    await saveAnswer(attempt.id, question.id, next);
    setUnsynced(await pendingCount(attempt.id));
  }

  const statusOf = (id: string): Status => {
    const answered = !!answers[id];
    const isMarked = marked.has(id);
    if (answered && isMarked) return "answered-review";
    if (isMarked) return "review";
    if (answered) return "answered";
    return visited.has(id) ? "not-answered" : "not-visited";
  };

  const counts = attempt.questions.reduce(
    (acc, q) => {
      acc[statusOf(q.id)] += 1;
      return acc;
    },
    {
      "not-visited": 0,
      "not-answered": 0,
      answered: 0,
      review: 0,
      "answered-review": 0,
    } as Record<Status, number>
  );

  const answeredTotal = counts.answered + counts["answered-review"];
  const lowTime = remaining !== null && remaining <= 60_000;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-24 pt-3 sm:px-5">
      <header className="sticky top-0 z-30 -mx-3 mb-3 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur sm:-mx-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {attempt.exam?.name} · {attempt.paperLabel}
            </p>
            <p className="text-xs text-muted">
              Exam mode · {answeredTotal}/{attempt.questions.length} answered
              {unsynced > 0 && ` · ${unsynced} unsynced`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`rounded-xl px-3 py-1.5 font-mono text-lg font-bold tabular-nums ${
                lowTime ? "animate-pulse bg-wrong text-white" : "bg-surface"
              }`}
              aria-live="polite"
            >
              {remaining === null ? "--:--" : formatRemaining(remaining)}
            </div>
            <button
              onClick={() => setPaletteOpen((o) => !o)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm md:hidden"
              aria-label="Toggle question palette"
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <div className="flex gap-4">
        <main className="min-w-0 flex-1">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-muted">
                Question {current + 1} of {attempt.questions.length}
              </p>
              <button
                onClick={() =>
                  setMarked((m) => {
                    const next = new Set(m);
                    if (next.has(question.id)) next.delete(question.id);
                    else next.add(question.id);
                    return next;
                  })
                }
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  marked.has(question.id)
                    ? "border-[#8b5cf6] bg-[#8b5cf6]/15 text-[#8b5cf6]"
                    : "border-border text-muted"
                }`}
              >
                {marked.has(question.id) ? "✓ Marked for review" : "Mark for review"}
              </button>
            </div>

            <QuestionBody question={question} className="mt-3" />

            <div className="mt-4 space-y-2">
              {question.options.map((opt) => {
                const selected = answers[question.id] === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => choose(opt.key)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${
                      selected
                        ? "border-brand bg-brand/10 font-medium"
                        : "border-border bg-surface hover:border-brand/50"
                    }`}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                        selected ? "border-brand bg-brand text-brand-contrast" : "border-border"
                      }`}
                    >
                      {opt.key}
                    </span>
                    <RichText text={opt.text} className="flex-1" />
                  </button>
                );
              })}
            </div>

            {answers[question.id] && (
              <button
                onClick={() => choose(answers[question.id] as OptionKey)}
                className="mt-3 text-sm text-muted underline"
              >
                Clear response
              </button>
            )}
          </Card>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => goTo(current - 1)} disabled={current === 0}>
              ← Previous
            </Button>
            <Button
              variant="secondary"
              onClick={() => goTo(current + 1)}
              disabled={current === attempt.questions.length - 1}
            >
              Next →
            </Button>
          </div>
        </main>

        {/* Palette: inline sidebar on large screens, slide-over on tablet/phone. */}
        <aside
          className={`${
            paletteOpen
              ? "fixed inset-0 z-40 flex items-end bg-black/40 md:static md:block md:bg-transparent"
              : "hidden md:block"
          } md:w-56 lg:w-64 md:shrink-0`}
          onClick={(e) => e.target === e.currentTarget && setPaletteOpen(false)}
        >
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 md:max-h-none md:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Question palette</h2>
              <button
                onClick={() => setPaletteOpen(false)}
                className="text-sm text-muted md:hidden"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-6 gap-1.5 md:grid-cols-5">
              {attempt.questions.map((q, i) => (
                <button
                  key={q.id}
                  onClick={() => goTo(i)}
                  aria-label={`Question ${i + 1}, ${statusOf(q.id).replace("-", " ")}`}
                  className={`relative size-9 rounded-lg text-sm font-semibold transition ${
                    PALETTE_STYLE[statusOf(q.id)]
                  } ${i === current ? "ring-2 ring-foreground ring-offset-1 ring-offset-surface" : ""}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <ul className="mt-4 space-y-1.5 text-xs">
              <Legend className="bg-correct text-white" label="Answered" n={counts.answered} />
              <Legend
                className="bg-wrong/80 text-white"
                label="Not answered"
                n={counts["not-answered"]}
              />
              <Legend
                className="bg-[#8b5cf6] text-white"
                label="Marked for review"
                n={counts.review}
              />
              <Legend
                className="bg-[#8b5cf6] text-white"
                label="Answered + marked"
                n={counts["answered-review"]}
              />
              <Legend
                className="border border-border bg-surface"
                label="Not visited"
                n={counts["not-visited"]}
              />
            </ul>

            <Button onClick={() => setConfirming(true)} className="mt-4 w-full" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit exam"}
            </Button>
          </div>
        </aside>
      </div>

      {/* Mobile submit bar — the sidebar button is off-screen there. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <button onClick={() => setPaletteOpen(true)} className="text-xs text-muted underline">
            {attempt.questions.length - answeredTotal} unanswered · view palette
          </button>
          <Button onClick={() => setConfirming(true)} disabled={submitting}>
            Submit exam
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <Card className="w-full max-w-sm">
            <h2 className="font-semibold">Submit this exam?</h2>
            <p className="mt-1.5 text-sm text-muted">
              {answeredTotal} answered · {attempt.questions.length - answeredTotal} unanswered
              {counts.review + counts["answered-review"] > 0 &&
                ` · ${counts.review + counts["answered-review"]} marked for review`}
              . You cannot change answers after submitting.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)} className="flex-1">
                Keep working
              </Button>
              <Button onClick={() => void submit(false)} className="flex-1">
                Submit
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

const PALETTE_STYLE: Record<Status, string> = {
  answered: "bg-correct text-white",
  "not-answered": "bg-wrong/80 text-white",
  review: "bg-[#8b5cf6] text-white",
  "answered-review": "bg-[#8b5cf6] text-white ring-1 ring-correct",
  "not-visited": "border border-border bg-surface text-muted",
};

function Legend({ className, label, n }: { className: string; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`size-4 rounded ${className}`} />
      <span className="text-muted">
        {label} — {n}
      </span>
    </li>
  );
}

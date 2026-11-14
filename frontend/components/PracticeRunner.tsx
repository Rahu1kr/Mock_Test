"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { saveAnswer } from "@/lib/offlineQueue";
import type { AttemptQuestion, AttemptView, OptionKey } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { QuestionBody, RichText } from "@/components/QuestionContent";

/**
 * Practice mode: every question on one page. Tapping an option records it and
 * immediately shows whether it was right, alongside the correct answer and
 * explanation — the server already includes answers for practice attempts.
 */
export function PracticeRunner({ attempt }: { attempt: AttemptView }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, OptionKey | null>>(() => {
    const init: Record<string, OptionKey | null> = {};
    for (const a of attempt.answers) init[a.questionId] = a.selectedOption;
    return init;
  });
  const [submitting, setSubmitting] = useState(false);

  const answeredCount = Object.values(answers).filter(Boolean).length;
  const correctCount = attempt.questions.filter(
    (q) => answers[q.id] && answers[q.id] === q.correctOption
  ).length;

  async function choose(questionId: string, option: OptionKey) {
    if (answers[questionId]) return; // first answer stands, so the reveal is honest
    setAnswers((a) => ({ ...a, [questionId]: option }));
    await saveAnswer(attempt.id, questionId, option);
  }

  async function finish() {
    setSubmitting(true);
    try {
      await api(`/attempts/${attempt.id}/submit`, { method: "POST" });
      router.replace(`/attempt/${attempt.id}/results`);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {attempt.exam?.name} · {attempt.paperLabel}
            </p>
            <p className="text-xs text-muted">Practice mode · answers shown as you go</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">
              {answeredCount}/{attempt.questions.length}
            </p>
            <p className="text-xs text-correct">{correctCount} correct</p>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {attempt.questions.map((q, i) => (
          <PracticeQuestion
            key={q.id}
            index={i + 1}
            question={q}
            selected={answers[q.id] ?? null}
            onChoose={(opt) => choose(q.id, opt)}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {answeredCount} of {attempt.questions.length} attempted
          </p>
          <Button onClick={finish} disabled={submitting}>
            {submitting ? "Saving…" : "Finish & see score"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PracticeQuestion({
  index,
  question,
  selected,
  onChoose,
}: {
  index: number;
  question: AttemptQuestion;
  selected: OptionKey | null;
  onChoose: (opt: OptionKey) => void;
}) {
  const answered = selected !== null;
  const gotItRight = answered && selected === question.correctOption;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-sm font-semibold text-muted">{index}.</span>
        <div className="min-w-0 flex-1">
          <QuestionBody question={question} />

          <div className="mt-3 space-y-2">
            {question.options.map((opt) => {
              const isCorrect = opt.key === question.correctOption;
              const isPicked = opt.key === selected;

              let tone = "border-border bg-surface";
              if (answered && isCorrect) tone = "border-correct bg-correct/10 text-correct";
              else if (isPicked) tone = "border-wrong bg-wrong/10 text-wrong";

              return (
                <button
                  key={opt.key}
                  onClick={() => onChoose(opt.key)}
                  disabled={answered}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${tone} ${
                    answered ? "cursor-default" : "hover:border-brand"
                  }`}
                >
                  <span className="font-semibold">{opt.key}.</span>
                  <RichText text={opt.text} className="flex-1" />
                  {answered && isCorrect && <span className="text-xs font-medium">✓ correct</span>}
                  {answered && isPicked && !isCorrect && (
                    <span className="text-xs font-medium">your answer</span>
                  )}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="mt-3 rounded-xl bg-background p-3 text-sm">
              <p className={gotItRight ? "font-medium text-correct" : "font-medium text-wrong"}>
                {gotItRight ? "Correct" : `Incorrect — the answer is ${question.correctOption}`}
              </p>
              {question.explanation && <RichText text={question.explanation} className="mt-2" />}
              {question.sourceCitation && (
                <p className="mt-1.5 text-xs text-muted">Source: {question.sourceCitation}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

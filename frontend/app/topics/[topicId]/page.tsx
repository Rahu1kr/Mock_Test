"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Question, Topic } from "@/lib/types";
import { QuestionBody, RichText } from "@/components/QuestionContent";
import { Card, EmptyNote, ErrorNote, PageShell, Spinner } from "@/components/ui";

/** Tap-to-reveal browsing for one topic, pooled across every year. */
export default function TopicQuestionsPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [topicName, setTopicName] = useState<string>("Topic");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [yearFilter, setYearFilter] = useState("all");

  useEffect(() => {
    api<Question[]>(`/questions?topicId=${topicId}`)
      .then(async (qs) => {
        setQuestions(qs);
        if (qs.length) {
          const topics = await api<Topic[]>(`/topics?examId=${qs[0].examId}`).catch(() => []);
          setTopicName(topics.find((t) => t._id === topicId)?.name ?? "Topic");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load questions"));
  }, [topicId]);

  const years = useMemo(() => {
    if (!questions) return [];
    return [...new Set(questions.map((q) => q.year).filter((y): y is number => y !== null))].sort(
      (a, b) => b - a
    );
  }, [questions]);

  const visible = useMemo(() => {
    if (!questions) return [];
    if (yearFilter === "all") return questions;
    return questions.filter((q) => String(q.year) === yearFilter);
  }, [questions, yearFilter]);

  const allRevealed = visible.length > 0 && visible.every((q) => revealed[q._id]);

  return (
    <PageShell
      title={topicName}
      subtitle="Tap a question to reveal its answer"
      back={{ href: "/topics", label: "All topics" }}
      actions={
        visible.length > 0 ? (
          <button
            onClick={() =>
              setRevealed((r) => {
                const next = { ...r };
                visible.forEach((q) => (next[q._id] = !allRevealed));
                return next;
              })
            }
            className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium"
          >
            {allRevealed ? "Hide all" : "Show all"}
          </button>
        ) : null
      }
    >
      {error && <ErrorNote message={error} />}
      {!questions && !error && <Spinner />}
      {questions && questions.length === 0 && (
        <EmptyNote>No questions in this topic yet.</EmptyNote>
      )}

      {questions && questions.length > 0 && (
        <>
          {years.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <Chip active={yearFilter === "all"} onClick={() => setYearFilter("all")}>
                All years ({questions.length})
              </Chip>
              {years.map((y) => (
                <Chip
                  key={y}
                  active={yearFilter === String(y)}
                  onClick={() => setYearFilter(String(y))}
                >
                  {y}
                </Chip>
              ))}
            </div>
          )}

          <p className="mb-3 text-sm text-muted">
            {visible.length} question{visible.length === 1 ? "" : "s"}
          </p>

          <div className="space-y-3">
            {visible.map((q, i) => {
              const open = !!revealed[q._id];
              return (
                <Card key={q._id}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-sm font-semibold text-muted">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <QuestionBody question={q} />
                      {q.year && <p className="mt-1 text-xs text-muted">{q.year}</p>}

                      <ul className="mt-3 space-y-1.5">
                        {q.options.map((opt) => {
                          const isAnswer = open && opt.key === q.correctOption;
                          return (
                            <li
                              key={opt.key}
                              className={`rounded-lg border px-3 py-2 text-sm ${
                                isAnswer
                                  ? "border-correct bg-correct/10 font-medium text-correct"
                                  : "border-border"
                              }`}
                            >
                              <div className="flex gap-2">
                                <span className="font-semibold">{opt.key}.</span>
                                <RichText text={opt.text} className="flex-1" />
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [q._id]: !r[q._id] }))}
                        className="mt-3 min-h-10 rounded-xl border border-brand px-4 text-sm font-medium text-brand"
                      >
                        {open ? "Hide answer" : "Show answer"}
                      </button>

                      {open && (
                        <div className="mt-3 rounded-xl bg-background p-3 text-sm">
                          <p>
                            <span className="font-semibold">Answer: </span>
                            {q.correctOption}
                          </p>
                          {q.explanation && <RichText text={q.explanation} className="mt-2" />}
                          {q.sourceCitation && (
                            <p className="mt-1.5 text-xs text-muted">
                              Source: {q.sourceCitation}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </PageShell>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-9 rounded-full px-3.5 text-sm transition ${
        active ? "bg-foreground text-background" : "border border-border bg-surface text-muted"
      }`}
    >
      {children}
    </button>
  );
}

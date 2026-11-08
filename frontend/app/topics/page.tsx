"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Exam, Topic } from "@/lib/types";
import { Card, EmptyNote, ErrorNote, PageShell, Spinner } from "@/components/ui";

interface TopicWithCount extends Topic {
  questionCount: number;
}

interface Group {
  exam: Exam;
  topics: TopicWithCount[];
}

/** Topic Wise: browse questions by topic, across every year of a section. */
export default function TopicsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Exam[]>("/exams")
      .then(async (exams) => {
        const all = await Promise.all(
          exams.map(async (exam) => ({
            exam,
            topics: await api<TopicWithCount[]>(
              `/topics?examId=${exam._id}&withCounts=true`
            ).catch(() => []),
          }))
        );
        // Only sections that actually have topics with questions.
        return all
          .map((g) => ({ ...g, topics: g.topics.filter((t) => t.questionCount > 0) }))
          .filter((g) => g.topics.length > 0);
      })
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load topics"));
  }, []);

  return (
    <PageShell title="Topic Wise" subtitle="Questions grouped by topic, across all years">
      {error && <ErrorNote message={error} />}
      {!groups && !error && <Spinner label="Loading topics…" />}

      {groups && groups.length === 0 && (
        <EmptyNote>
          No topics yet. Topics are created automatically when questions are imported with a{" "}
          <code>topic_name</code>.
        </EmptyNote>
      )}

      <div className="space-y-6">
        {groups?.map(({ exam, topics }) => (
          <section key={exam._id}>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted">
              {exam.name}
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {topics.map((topic) => (
                <Link key={topic._id} href={`/topics/${topic._id}`}>
                  <Card className="transition hover:border-brand">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{topic.name}</p>
                      <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                        {topic.questionCount}
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

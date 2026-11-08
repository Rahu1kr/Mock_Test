"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Exam, Paper, Question, Topic } from "@/lib/types";
import { Card, Spinner } from "@/components/ui";

export default function AdminOverview() {
  const [counts, setCounts] = useState<{
    exams: number;
    topics: number;
    questions: number;
    papers: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const [exams, topics, questions] = await Promise.all([
        api<Exam[]>("/exams"),
        api<Topic[]>("/topics"),
        api<Question[]>("/questions"),
      ]);
      const paperLists = await Promise.all(
        exams.map((e) => api<Paper[]>(`/exams/${e._id}/papers`).catch(() => []))
      );
      setCounts({
        exams: exams.length,
        topics: topics.length,
        questions: questions.length,
        papers: paperLists.reduce((n, list) => n + list.length, 0),
      });
    })().catch(() => setCounts({ exams: 0, topics: 0, questions: 0, papers: 0 }));
  }, []);

  if (!counts) return <Spinner />;

  const tiles = [
    { label: "Sections", value: counts.exams, href: "/admin/exams" },
    { label: "Papers (years)", value: counts.papers, href: "/admin/papers" },
    { label: "Questions", value: counts.questions, href: "/admin/questions" },
    { label: "Topics", value: counts.topics, href: "/admin/topics" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="transition hover:border-brand">
              <p className="text-sm text-muted">{t.label}</p>
              <p className="mt-1 text-3xl font-bold">{t.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <h2 className="font-semibold">Adding content</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>
            Create a section under <strong>Sections</strong> — one per exam paper, e.g.
            &quot;Kerala SET Paper II&quot;, with its home-screen group.
          </li>
          <li>
            Bulk-add questions via <strong>CSV upload</strong>, each row carrying its{" "}
            <code>year</code>. Always dry-run first.
          </li>
          <li>
            That&apos;s it — each year becomes a paper automatically, playable in both practice and
            exam mode. Check <strong>Papers</strong> to see what users can see.
          </li>
        </ol>
      </Card>
    </div>
  );
}

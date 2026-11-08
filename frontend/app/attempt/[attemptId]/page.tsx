"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { AttemptView } from "@/lib/types";
import { ErrorNote, Spinner } from "@/components/ui";
import { PracticeRunner } from "@/components/PracticeRunner";
import { ExamRunner } from "@/components/ExamRunner";

export default function AttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AttemptView>(`/attempts/${attemptId}`)
      .then((data) => {
        // The server auto-submits an expired attempt on read; honour that.
        if (data.status !== "in_progress") {
          router.replace(`/attempt/${attemptId}/results`);
          return;
        }
        setAttempt(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
  }, [attemptId, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorNote message={error} />
      </div>
    );
  }
  if (!attempt) return <Spinner label="Loading…" />;

  return attempt.mode === "practice" ? (
    <PracticeRunner attempt={attempt} />
  ) : (
    <ExamRunner attempt={attempt} />
  );
}

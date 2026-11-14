"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Exam, Topic } from "@/lib/types";
import { Button, Card, EmptyNote, ErrorNote, Field, Spinner, inputClass } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmDialog";

export default function AdminTopicsPage() {
  const confirm = useConfirm();
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Exam[]>("/exams")
      .then((e) => {
        setExams(e);
        if (e.length) setExamId(e[0]._id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load exams"));
  }, []);

  const load = (id: string) =>
    api<Topic[]>(`/topics?examId=${id}`)
      .then(setTopics)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load topics"));

  useEffect(() => {
    if (examId) void load(examId);
  }, [examId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/topics", { method: "POST", body: { examId, name } });
      setName("");
      await load(examId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add topic");
    } finally {
      setBusy(false);
    }
  }

  async function remove(topic: Topic) {
    const ok = await confirm({
      title: "Delete topic?",
      message: `"${topic.name}" will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api(`/admin/topics/${topic._id}`, { method: "DELETE" });
      await load(examId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete topic");
    }
  }

  if (!exams.length) {
    return <EmptyNote>Add an exam first — topics belong to an exam.</EmptyNote>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <Field label="Exam">
          <select className={inputClass} value={examId} onChange={(e) => setExamId(e.target.value)}>
            {exams.map((e) => (
              <option key={e._id} value={e._id}>
                {e.code} — {e.name}
              </option>
            ))}
          </select>
        </Field>
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="New topic name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Physical Geography"
                required
              />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add topic"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted">
          CSV upload creates topics automatically, so you only need this for manual tidying.
        </p>
      </Card>

      {error && <ErrorNote message={error} />}
      {!topics && <Spinner />}
      {topics && topics.length === 0 && <EmptyNote>No topics for this exam yet.</EmptyNote>}

      {topics && topics.length > 0 && (
        <div className="space-y-2">
          {topics.map((t) => (
            <Card key={t._id}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{t.name}</p>
                <Button variant="danger" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

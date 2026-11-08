"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Exam, Question, Topic } from "@/lib/types";
import { Button, Card, EmptyNote, ErrorNote, Field, Spinner, inputClass } from "@/components/ui";

type Choice = "A" | "B" | "C" | "D";
const KEYS: Choice[] = ["A", "B", "C", "D"];

const BLANK = {
  topicId: "",
  year: "",
  questionText: "",
  options: ["", "", "", ""],
  correctOption: "A" as Choice,
  explanation: "",
  sourceCitation: "",
};

export default function AdminQuestionsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [yearFilter, setYearFilter] = useState("all");

  useEffect(() => {
    api<Exam[]>("/exams")
      .then((e) => {
        setExams(e);
        if (e.length) setExamId(e[0]._id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load exams"));
  }, []);

  const load = async (id: string) => {
    const [qs, ts] = await Promise.all([
      api<Question[]>(`/questions?examId=${id}`),
      api<Topic[]>(`/topics?examId=${id}`),
    ]);
    setQuestions(qs);
    setTopics(ts);
  };

  useEffect(() => {
    if (!examId) return;
    setQuestions(null);
    load(examId).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load questions")
    );
  }, [examId]);

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

  const topicName = (id: string | null) =>
    id ? (topics.find((t) => t._id === id)?.name ?? "Unknown") : "Uncategorised";

  function startAdd() {
    setEditingId(null);
    setForm(BLANK);
    setShowForm(true);
  }

  function startEdit(q: Question) {
    setEditingId(q._id);
    setForm({
      topicId: q.topicId ?? "",
      year: q.year?.toString() ?? "",
      questionText: q.questionText,
      options: KEYS.map((k) => q.options.find((o) => o.key === k)?.text ?? ""),
      correctOption: q.correctOption,
      explanation: q.explanation ?? "",
      sourceCitation: q.sourceCitation ?? "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      examId,
      topicId: form.topicId || null,
      year: form.year ? Number(form.year) : null,
      questionText: form.questionText,
      options: KEYS.map((k, i) => ({ key: k, text: form.options[i] })),
      correctOption: form.correctOption,
      explanation: form.explanation,
      sourceCitation: form.sourceCitation,
    };
    try {
      if (editingId) await api(`/admin/questions/${editingId}`, { method: "PUT", body: payload });
      else await api("/admin/questions", { method: "POST", body: payload });
      setShowForm(false);
      setForm(BLANK);
      setEditingId(null);
      await load(examId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save question");
    } finally {
      setBusy(false);
    }
  }

  async function remove(q: Question) {
    if (!window.confirm("Delete this question?")) return;
    try {
      await api(`/admin/questions/${q._id}`, { method: "DELETE" });
      await load(examId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete question");
    }
  }

  if (!exams.length) return <EmptyNote>Add an exam first.</EmptyNote>;

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam">
            <select
              className={inputClass}
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
            >
              {exams.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.code} — {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filter by year">
            <select
              className={inputClass}
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Button onClick={startAdd}>Add a question</Button>
        </div>
      </Card>

      {showForm && (
        <Card>
          <h2 className="font-semibold">{editingId ? "Edit question" : "New question"}</h2>
          <form onSubmit={save} className="mt-4 space-y-4">
            <Field label="Question text">
              <textarea
                className={`${inputClass} min-h-24`}
                value={form.questionText}
                onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                required
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              {KEYS.map((k, i) => (
                <Field key={k} label={`Option ${k}`}>
                  <input
                    className={inputClass}
                    value={form.options[i]}
                    onChange={(e) => {
                      const next = [...form.options];
                      next[i] = e.target.value;
                      setForm({ ...form, options: next });
                    }}
                    required
                  />
                </Field>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Correct option">
                <select
                  className={inputClass}
                  value={form.correctOption}
                  onChange={(e) =>
                    setForm({ ...form, correctOption: e.target.value as Choice })
                  }
                >
                  {KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Year (optional)">
                <input
                  className={inputClass}
                  type="number"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                  placeholder="2023"
                />
              </Field>
              <Field label="Topic (optional)">
                <select
                  className={inputClass}
                  value={form.topicId}
                  onChange={(e) => setForm({ ...form, topicId: e.target.value })}
                >
                  <option value="">Uncategorised</option>
                  {topics.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Explanation (optional)">
              <textarea
                className={`${inputClass} min-h-20`}
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
              />
            </Field>
            <Field label="Source citation (optional)">
              <input
                className={inputClass}
                value={form.sourceCitation}
                onChange={(e) => setForm({ ...form, sourceCitation: e.target.value })}
                placeholder="UGC NET Dec 2023 Paper II Q.12"
              />
            </Field>

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Add question"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {error && <ErrorNote message={error} />}
      {!questions && <Spinner />}
      {questions && visible.length === 0 && (
        <EmptyNote>No questions yet. Use CSV upload to add them in bulk.</EmptyNote>
      )}

      {questions && visible.length > 0 && (
        <>
          <p className="text-sm text-muted">{visible.length} question(s)</p>
          <div className="space-y-2">
            {visible.map((q, i) => (
              <Card key={q._id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">
                      {i + 1}. {q.year ?? "Undated"} · {topicName(q.topicId)} · answer{" "}
                      {q.correctOption}
                    </p>
                    <p className="mt-1 font-medium">{q.questionText}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" onClick={() => startEdit(q)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => remove(q)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

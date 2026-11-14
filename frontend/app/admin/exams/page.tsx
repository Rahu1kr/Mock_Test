"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Exam } from "@/lib/types";
import { Button, Card, ErrorNote, Field, Spinner, inputClass } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmDialog";

const BLANK = {
  name: "",
  code: "",
  description: "",
  group: "UGC NET",
  displayOrder: "0",
  marksCorrect: "2",
  marksWrong: "0",
  minutesPerQuestion: "1.2",
};

export default function AdminExamsPage() {
  const confirm = useConfirm();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<Exam[]>("/exams")
      .then(setExams)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load exams"));

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const set = new Set(["UGC NET", "State SET"]);
    exams?.forEach((e) => e.group && set.add(e.group));
    return [...set];
  }, [exams]);

  function reset() {
    setEditing(null);
    setForm(BLANK);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name,
      code: form.code,
      description: form.description,
      group: form.group,
      displayOrder: Number(form.displayOrder) || 0,
      marksCorrect: Number(form.marksCorrect),
      marksWrong: Number(form.marksWrong),
      minutesPerQuestion: Number(form.minutesPerQuestion),
    };
    try {
      if (editing) await api(`/admin/exams/${editing._id}`, { method: "PUT", body: payload });
      else await api("/admin/exams", { method: "POST", body: payload });
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(exam: Exam) {
    const ok = await confirm({
      title: `Delete "${exam.name}"?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api(`/admin/exams/${exam._id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  const grouped = useMemo(() => {
    if (!exams) return [];
    const map = new Map<string, Exam[]>();
    exams.forEach((e) => {
      const k = e.group || "Other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    });
    return [...map.entries()];
  }, [exams]);

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-semibold">{editing ? `Edit ${editing.code}` : "Add a section"}</h2>
        <p className="mt-1 text-sm text-muted">
          A section is one paper of one exam — e.g. &quot;Kerala SET Paper I&quot;. Users see
          sections grouped on the home screen, then pick a year.
        </p>
        <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Kerala SET Paper II"
              required
            />
          </Field>
          <Field label="Code (short, unique)">
            <input
              className={inputClass}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="KL_SET2"
              required
            />
          </Field>

          <Field label="Home-screen group">
            <input
              className={inputClass}
              list="exam-groups"
              value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
              placeholder="State SET"
              required
            />
            <datalist id="exam-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label="Display order within group">
            <input
              className={inputClass}
              type="number"
              value={form.displayOrder}
              onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description (optional)">
              <input
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
            <Field label="Marks per correct">
              <input
                className={inputClass}
                type="number"
                step="0.25"
                value={form.marksCorrect}
                onChange={(e) => setForm({ ...form, marksCorrect: e.target.value })}
                required
              />
            </Field>
            <Field label="Marks per wrong (0 = none)">
              <input
                className={inputClass}
                type="number"
                step="0.25"
                value={form.marksWrong}
                onChange={(e) => setForm({ ...form, marksWrong: e.target.value })}
                required
              />
            </Field>
            <Field label="Minutes per question">
              <input
                className={inputClass}
                type="number"
                step="0.1"
                min="0.1"
                value={form.minutesPerQuestion}
                onChange={(e) => setForm({ ...form, minutesPerQuestion: e.target.value })}
                required
              />
            </Field>
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add section"}
            </Button>
            {editing && (
              <Button variant="secondary" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
        <p className="mt-3 text-xs text-muted">
          UGC NET has no negative marking, so <strong>marks per wrong</strong> defaults to 0. Exam
          duration is minutes-per-question × the number of questions in that year&apos;s paper.
        </p>
      </Card>

      {error && <ErrorNote message={error} />}
      {!exams && <Spinner />}

      {grouped.map(([groupName, list]) => (
        <div key={groupName}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {groupName}
          </h3>
          <div className="space-y-2">
            {list.map((exam) => (
              <Card key={exam._id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-brand">{exam.code}</p>
                    <p className="font-medium">{exam.name}</p>
                    <p className="text-xs text-muted">
                      +{exam.marksCorrect}/{exam.marksWrong} · {exam.minutesPerQuestion} min per
                      question · order {exam.displayOrder}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(exam);
                        setForm({
                          name: exam.name,
                          code: exam.code,
                          description: exam.description ?? "",
                          group: exam.group ?? "UGC NET",
                          displayOrder: String(exam.displayOrder ?? 0),
                          marksCorrect: String(exam.marksCorrect),
                          marksWrong: String(exam.marksWrong),
                          minutesPerQuestion: String(exam.minutesPerQuestion),
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => remove(exam)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

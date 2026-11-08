"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote } from "@/components/ui";

interface DryRunResult {
  dryRun: true;
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: { row: number; message: string }[];
  preview: {
    questionText: string;
    correctOption: string;
    year: number | null;
    topicName: string | null;
  }[];
}

interface ImportResult {
  imported: number;
  topicsCreated: number;
}

const TEMPLATE = `exam_code,topic_name,year,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,source_citation
NET2,Physical Geography,2023,Which of the following is a fold mountain?,Himalayas,Aravalli,Deccan Plateau,Vindhya,A,Himalayas were formed by tectonic folding.,UGC NET Dec 2023 Paper II Q.12`;

export default function AdminUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(isDryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setImported(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api<DryRunResult | ImportResult>(
        `/admin/upload/questions${isDryRun ? "?dryRun=true" : ""}`,
        { method: "POST", formData }
      );
      if (isDryRun) setDryRun(res as DryRunResult);
      else {
        setImported(res as ImportResult);
        setDryRun(null);
        setFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geo-pyq-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-semibold">Bulk upload questions from CSV</h2>
        <p className="mt-1 text-sm text-muted">
          Fill the template in Google Sheets or Excel, export as CSV, then dry-run it here before
          importing. Nothing is written until the dry-run comes back clean.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={downloadTemplate}>
            Download CSV template
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDryRun(null);
              setImported(null);
              setError(null);
            }}
            className="block w-full rounded-xl border border-border bg-surface p-2.5 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send(true)} disabled={!file || busy}>
              {busy ? "Checking…" : "Dry run (validate only)"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => send(false)}
              disabled={!file || busy || !dryRun || dryRun.errorCount > 0}
            >
              Import {dryRun && dryRun.errorCount === 0 ? `${dryRun.validRows} rows` : ""}
            </Button>
          </div>
          {dryRun && dryRun.errorCount > 0 && (
            <p className="text-xs text-muted">
              Fix the errors below and re-run the dry run before importing.
            </p>
          )}
        </div>
      </Card>

      {error && <ErrorNote message={error} />}

      {imported && (
        <Card className="border-correct/50 bg-correct/5">
          <p className="font-semibold text-correct">
            Imported {imported.imported} question(s)
            {imported.topicsCreated > 0 && `, created ${imported.topicsCreated} new topic(s)`}.
          </p>
        </Card>
      )}

      {dryRun && (
        <Card>
          <h3 className="font-semibold">Dry run result</h3>
          <div className="mt-2 flex flex-wrap gap-5 text-sm">
            <span>
              Total rows: <strong>{dryRun.totalRows}</strong>
            </span>
            <span className="text-correct">
              Valid: <strong>{dryRun.validRows}</strong>
            </span>
            <span className={dryRun.errorCount ? "text-wrong" : "text-muted"}>
              Errors: <strong>{dryRun.errorCount}</strong>
            </span>
          </div>

          {dryRun.errors.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-wrong">Problems found</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {dryRun.errors.map((e, i) => (
                  <li key={i} className="rounded-lg bg-wrong/10 px-3 py-1.5 text-wrong">
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dryRun.preview.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">Preview of valid rows</p>
              <ul className="mt-1.5 space-y-1.5 text-sm">
                {dryRun.preview.map((p, i) => (
                  <li key={i} className="rounded-lg bg-background px-3 py-2">
                    <span className="text-xs text-muted">
                      {p.year ?? "Undated"} · {p.topicName ?? "Uncategorised"} · answer{" "}
                      {p.correctOption}
                    </span>
                    <p>{p.questionText}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        <h3 className="font-semibold">Column reference</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>
            <code>exam_code</code> — required, must match an existing exam code (e.g. NET2)
          </li>
          <li>
            <code>topic_name</code> — optional; created automatically if new
          </li>
          <li>
            <code>year</code> — optional, four-digit year
          </li>
          <li>
            <code>question_text</code> — required
          </li>
          <li>
            <code>option_a</code> … <code>option_d</code> — all four required
          </li>
          <li>
            <code>correct_option</code> — required, one of A/B/C/D
          </li>
          <li>
            <code>explanation</code>, <code>source_citation</code> — optional
          </li>
        </ul>
      </Card>
    </div>
  );
}

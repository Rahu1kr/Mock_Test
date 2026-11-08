import { Router } from "express";
import { Exam } from "../models/Exam.js";
import { Question } from "../models/Question.js";

export const examsRouter = Router();

// Sorted by displayOrder alone so the client can bucket into groups in
// encounter order — a group's position follows its lowest-ordered section,
// which keeps "UGC NET" ahead of "State SET" rather than sorting alphabetically.
examsRouter.get("/", async (_req, res) => {
  const exams = await Exam.find().sort({ displayOrder: 1, name: 1 });
  res.json(exams);
});

examsRouter.get("/:id", async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

/**
 * A "paper" is one year of this exam, derived straight from the imported
 * questions — there is no separate paper/test record to create or maintain.
 */
examsRouter.get("/:id/papers", async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const grouped = await Question.aggregate<{
    _id: { year: number | null; session: string };
    count: number;
  }>([
    { $match: { examId: exam._id } },
    {
      $group: {
        _id: { year: "$year", session: { $ifNull: ["$session", ""] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": -1, "_id.session": 1 } },
  ]);

  res.json(
    grouped.map((g) => ({
      year: g._id.year,
      session: g._id.session || "",
      slug: paperSlug(g._id.year, g._id.session),
      label: paperLabel(g._id.year, g._id.session),
      questionCount: g.count,
      // Exam-mode duration scales with paper length, matching real exam pacing.
      durationMinutes: Math.max(1, Math.round(g.count * exam.minutesPerQuestion)),
    }))
  );
});

/** URL-safe identifier for a paper, e.g. 2024-december / 2023 / undated. */
export function paperSlug(year: number | null, session?: string): string {
  const base = year === null || year === undefined ? "undated" : String(year);
  const s = (session ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s ? `${base}-${s}` : base;
}

export function paperLabel(year: number | null, session?: string): string {
  const s = (session ?? "").trim();
  const y = year === null || year === undefined ? "Undated" : String(year);
  return s ? `${s} ${y}` : y;
}

/** Reverses paperSlug against the sessions actually present for an exam. */
export function parsePaperSlug(
  slug: string,
  available: { year: number | null; session: string }[]
): { year: number | null; session: string } | null {
  return available.find((p) => paperSlug(p.year, p.session) === slug) ?? null;
}

import { Router } from "express";
import { Attempt, AttemptDoc } from "../models/Attempt.js";
import { Exam } from "../models/Exam.js";
import { paperLabel } from "./exams.js";
import { Question } from "../models/Question.js";
import { requireAuth } from "../middleware/auth.js";
import { submitAttempt } from "../services/scoring.js";

export const attemptsRouter = Router();

attemptsRouter.use(requireAuth);

function isExpired(attempt: AttemptDoc): boolean {
  if (attempt.durationMinutes == null) return false; // untimed practice never expires
  return Date.now() > attempt.startedAt.getTime() + attempt.durationMinutes * 60_000;
}

/**
 * Reports whether the user already has an unfinished attempt at this paper, so
 * the UI can offer "resume" vs "start over" rather than silently resuming.
 */
attemptsRouter.get("/in-progress", async (req, res) => {
  const { examId, mode } = req.query as { examId?: string; mode?: string };
  if (!examId || (mode !== "practice" && mode !== "exam")) {
    return res.status(400).json({ error: "examId and mode are required" });
  }
  const year = req.query.year === undefined || req.query.year === "" ? null : Number(req.query.year);
  const session = ((req.query.session as string) ?? "").trim();

  const attempt = await Attempt.findOne({
    userId: req.auth!.userId,
    examId,
    year,
    session,
    mode,
    status: "in_progress",
  });
  if (!attempt) return res.json({ exists: false });

  if (isExpired(attempt)) {
    const finished = await submitAttempt(attempt.id, "auto_submitted");
    return res.json({ exists: false, expiredAttemptId: finished.id });
  }

  res.json({
    exists: true,
    attemptId: attempt.id,
    answeredCount: attempt.answers.filter((a) => a.selectedOption).length,
    totalQuestions: attempt.questionIds.length,
    startedAt: attempt.startedAt,
    durationMinutes: attempt.durationMinutes,
  });
});

/** Start an attempt at one paper. Resumes an unfinished one unless restart. */
attemptsRouter.post("/", async (req, res) => {
  const { examId, year, session, mode, restart } = req.body as {
    examId?: string;
    year?: number | null;
    session?: string;
    mode?: "practice" | "exam";
    restart?: boolean;
  };
  if (!examId) return res.status(400).json({ error: "examId is required" });
  if (mode !== "practice" && mode !== "exam") {
    return res.status(400).json({ error: "mode must be 'practice' or 'exam'" });
  }

  const exam = await Exam.findById(examId);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const yearValue = year === undefined || year === null ? null : Number(year);
  const sessionValue = (session ?? "").trim();

  const existing = await Attempt.findOne({
    userId: req.auth!.userId,
    examId,
    year: yearValue,
    session: sessionValue,
    mode,
    status: "in_progress",
  });
  if (existing) {
    if (isExpired(existing)) {
      const finished = await submitAttempt(existing.id, "auto_submitted");
      return res
        .status(409)
        .json({ error: "Previous attempt expired", attemptId: finished.id });
    }
    if (!restart) return res.json({ attemptId: existing.id, resumed: true });

    // Starting over: discard the unfinished attempt rather than leaving it
    // stranded in_progress forever (practice attempts never expire on their own).
    await Attempt.deleteOne({ _id: existing._id });
  }

  const questions = await Question.find({
    examId,
    year: yearValue,
    $or: [{ session: sessionValue }, ...(sessionValue === "" ? [{ session: { $exists: false } }] : [])],
  }).sort({ createdAt: 1 });
  if (questions.length === 0) {
    return res.status(404).json({ error: "This paper has no questions yet" });
  }

  const durationMinutes =
    mode === "exam"
      ? Math.max(1, Math.round(questions.length * exam.minutesPerQuestion))
      : null;

  const attempt = await Attempt.create({
    userId: req.auth!.userId,
    examId,
    year: yearValue,
    session: sessionValue,
    mode,
    questionIds: questions.map((q) => q._id),
    marksCorrect: exam.marksCorrect,
    marksWrong: exam.marksWrong,
    startedAt: new Date(),
    durationMinutes,
  });

  res.status(201).json({ attemptId: attempt.id, resumed: false });
});

attemptsRouter.get("/", async (req, res) => {
  const attempts = await Attempt.find({ userId: req.auth!.userId })
    .sort({ createdAt: -1 })
    .populate("examId", "name code group");
  res.json(attempts);
});

attemptsRouter.get("/:id", async (req, res) => {
  const attempt = await Attempt.findOne({ _id: req.params.id, userId: req.auth!.userId });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });

  if (attempt.status === "in_progress" && isExpired(attempt)) {
    await submitAttempt(attempt.id, "auto_submitted");
    const refreshed = await Attempt.findById(attempt.id);
    return res.json(await buildAttemptView(refreshed!));
  }
  res.json(await buildAttemptView(attempt));
});

attemptsRouter.patch("/:id/answer", async (req, res) => {
  const { questionId, selectedOption } = req.body as {
    questionId?: string;
    selectedOption?: "A" | "B" | "C" | "D" | null;
  };
  if (!questionId) return res.status(400).json({ error: "questionId is required" });

  const attempt = await Attempt.findOne({ _id: req.params.id, userId: req.auth!.userId });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.status !== "in_progress") {
    return res.status(409).json({ error: "Attempt is already submitted" });
  }
  if (isExpired(attempt)) {
    const finished = await submitAttempt(attempt.id, "auto_submitted");
    return res.status(409).json({ error: "Time expired", attemptId: finished.id });
  }
  if (!attempt.questionIds.some((id) => id.toString() === questionId)) {
    return res.status(400).json({ error: "Question is not part of this paper" });
  }

  const question = await Question.findById(questionId);
  if (!question) return res.status(404).json({ error: "Question not found" });

  const isCorrect = selectedOption === question.correctOption;
  const existing = attempt.answers.find((a) => a.questionId.toString() === questionId);
  if (existing) {
    existing.selectedOption = selectedOption ?? null;
    existing.isCorrect = isCorrect;
    existing.answeredAt = new Date();
  } else {
    attempt.answers.push({
      questionId: question._id,
      selectedOption: selectedOption ?? null,
      isCorrect,
      answeredAt: new Date(),
    });
  }
  await attempt.save();

  // Practice mode is explicitly "show me the answer as I go", so returning it
  // here is the point. Exam mode must never reveal it before submission.
  if (attempt.mode === "practice") {
    return res.json({
      ok: true,
      correctOption: question.correctOption,
      explanation: question.explanation,
      isCorrect,
    });
  }
  res.json({ ok: true });
});

attemptsRouter.post("/:id/submit", async (req, res) => {
  const attempt = await Attempt.findOne({ _id: req.params.id, userId: req.auth!.userId });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });

  const status = isExpired(attempt) ? "auto_submitted" : "submitted";
  const finished = await submitAttempt(attempt.id, status);
  res.json(finished);
});

async function buildAttemptView(attempt: AttemptDoc) {
  const exam = await Exam.findById(attempt.examId).select("name code group");
  const questions = await Question.find({ _id: { $in: attempt.questionIds } });

  const order = new Map(attempt.questionIds.map((id, i) => [id.toString(), i]));
  questions.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // Answers are visible once submitted, or at any time in practice mode.
  const reveal = attempt.status !== "in_progress" || attempt.mode === "practice";

  return {
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    year: attempt.year,
    session: attempt.session ?? "",
    paperLabel: paperLabel(attempt.year ?? null, attempt.session),
    startedAt: attempt.startedAt,
    durationMinutes: attempt.durationMinutes,
    submittedAt: attempt.submittedAt,
    score: attempt.score,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    skippedCount: attempt.skippedCount,
    marksCorrect: attempt.marksCorrect,
    marksWrong: attempt.marksWrong,
    exam: exam ? { id: exam.id, name: exam.name, code: exam.code, group: exam.group } : null,
    answers: attempt.answers.map((a) => ({
      questionId: a.questionId,
      selectedOption: a.selectedOption,
      ...(reveal ? { isCorrect: a.isCorrect } : {}),
    })),
    questions: questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      options: q.options,
      year: q.year,
      topicId: q.topicId,
      ...(reveal
        ? {
            correctOption: q.correctOption,
            explanation: q.explanation,
            sourceCitation: q.sourceCitation,
          }
        : {}),
    })),
  };
}

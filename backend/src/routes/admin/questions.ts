import { Router } from "express";
import { Question } from "../../models/Question.js";

export const adminQuestionsRouter = Router();

interface QuestionBody {
  examId?: string;
  topicId?: string | null;
  year?: number | null;
  questionText?: string;
  options?: { key: string; text: string }[];
  correctOption?: string;
  explanation?: string;
  sourceCitation?: string;
}

function validate(body: QuestionBody): string | null {
  if (!body.examId) return "examId is required";
  if (!body.questionText?.trim()) return "questionText is required";
  if (!body.options || body.options.length !== 4) return "exactly 4 options are required";
  if (body.options.some((o) => !o.text?.trim())) return "all 4 option texts must be non-empty";
  if (!body.correctOption || !["A", "B", "C", "D"].includes(body.correctOption)) {
    return "correctOption must be one of A, B, C, D";
  }
  return null;
}

adminQuestionsRouter.post("/", async (req, res) => {
  const body = req.body as QuestionBody;
  const error = validate(body);
  if (error) return res.status(400).json({ error });
  const question = await Question.create(body);
  res.status(201).json(question);
});

adminQuestionsRouter.put("/:id", async (req, res) => {
  const body = req.body as QuestionBody;
  const error = validate(body);
  if (error) return res.status(400).json({ error });
  const question = await Question.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!question) return res.status(404).json({ error: "Question not found" });
  res.json(question);
});

adminQuestionsRouter.delete("/:id", async (req, res) => {
  const question = await Question.findByIdAndDelete(req.params.id);
  if (!question) return res.status(404).json({ error: "Question not found" });
  res.json({ ok: true });
});

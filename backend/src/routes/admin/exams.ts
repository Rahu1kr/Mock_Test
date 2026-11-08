import { Router } from "express";
import { Exam } from "../../models/Exam.js";
import { Topic } from "../../models/Topic.js";
import { Question } from "../../models/Question.js";

export const adminExamsRouter = Router();

interface ExamBody {
  name?: string;
  code?: string;
  description?: string;
  group?: string;
  displayOrder?: number;
  marksCorrect?: number;
  marksWrong?: number;
  minutesPerQuestion?: number;
}

function pick(body: ExamBody) {
  const out: ExamBody = {};
  if (body.name !== undefined) out.name = body.name;
  if (body.code !== undefined) out.code = body.code;
  if (body.description !== undefined) out.description = body.description;
  if (body.group !== undefined) out.group = body.group;
  if (body.displayOrder !== undefined) out.displayOrder = Number(body.displayOrder);
  if (body.marksCorrect !== undefined) out.marksCorrect = Number(body.marksCorrect);
  if (body.marksWrong !== undefined) out.marksWrong = Number(body.marksWrong);
  if (body.minutesPerQuestion !== undefined) {
    out.minutesPerQuestion = Number(body.minutesPerQuestion);
  }
  return out;
}

adminExamsRouter.post("/", async (req, res) => {
  const body = req.body as ExamBody;
  if (!body.name || !body.code) {
    return res.status(400).json({ error: "name and code are required" });
  }
  if (body.minutesPerQuestion !== undefined && Number(body.minutesPerQuestion) <= 0) {
    return res.status(400).json({ error: "minutesPerQuestion must be greater than 0" });
  }
  const exam = await Exam.create(pick(body));
  res.status(201).json(exam);
});

adminExamsRouter.put("/:id", async (req, res) => {
  const body = req.body as ExamBody;
  if (body.minutesPerQuestion !== undefined && Number(body.minutesPerQuestion) <= 0) {
    return res.status(400).json({ error: "minutesPerQuestion must be greater than 0" });
  }
  const exam = await Exam.findByIdAndUpdate(req.params.id, pick(body), { new: true });
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

adminExamsRouter.delete("/:id", async (req, res) => {
  const questionCount = await Question.countDocuments({ examId: req.params.id });
  if (questionCount > 0) {
    return res
      .status(409)
      .json({ error: `Cannot delete: ${questionCount} question(s) still belong to this exam` });
  }
  const exam = await Exam.findByIdAndDelete(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  await Topic.deleteMany({ examId: req.params.id });
  res.json({ ok: true });
});

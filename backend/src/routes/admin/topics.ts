import { Router } from "express";
import { Topic } from "../../models/Topic.js";
import { Question } from "../../models/Question.js";

export const adminTopicsRouter = Router();

adminTopicsRouter.post("/", async (req, res) => {
  const { examId, name, displayOrder } = req.body as Record<string, string | number>;
  if (!examId || !name) return res.status(400).json({ error: "examId and name are required" });
  const topic = await Topic.create({ examId, name, displayOrder: displayOrder ?? 0 });
  res.status(201).json(topic);
});

adminTopicsRouter.put("/:id", async (req, res) => {
  const { name, displayOrder } = req.body as Record<string, string | number>;
  const topic = await Topic.findByIdAndUpdate(
    req.params.id,
    { name, displayOrder },
    { new: true, omitUndefined: true }
  );
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  res.json(topic);
});

adminTopicsRouter.delete("/:id", async (req, res) => {
  const questionCount = await Question.countDocuments({ topicId: req.params.id });
  if (questionCount > 0) {
    return res
      .status(409)
      .json({ error: `Cannot delete: ${questionCount} question(s) still use this topic` });
  }
  const topic = await Topic.findByIdAndDelete(req.params.id);
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  res.json({ ok: true });
});

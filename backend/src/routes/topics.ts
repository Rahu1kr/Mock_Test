import { Router } from "express";
import { Topic } from "../models/Topic.js";
import { Question } from "../models/Question.js";

export const topicsRouter = Router();

topicsRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.examId) filter.examId = req.query.examId;

  const topics = await Topic.find(filter).sort({ displayOrder: 1, name: 1 });

  // The Topic Wise browser needs counts to hide empty topics and show sizes.
  if (req.query.withCounts !== "true") return res.json(topics);

  const counts = await Question.aggregate<{ _id: unknown; count: number }>([
    { $match: { topicId: { $in: topics.map((t) => t._id) } } },
    { $group: { _id: "$topicId", count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json(
    topics.map((t) => ({
      ...t.toObject(),
      questionCount: byId.get(t.id) ?? 0,
    }))
  );
});

import { Router } from "express";
import { Question } from "../models/Question.js";

export const questionsRouter = Router();

// Practice mode: answers are intentionally included — the UI hides them behind
// a tap-to-reveal control. The mock-test endpoints strip them instead.
questionsRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.examId) filter.examId = req.query.examId;
  if (req.query.topicId) filter.topicId = req.query.topicId;
  if (req.query.year) filter.year = Number(req.query.year);

  const questions = await Question.find(filter).sort({ year: -1, createdAt: 1 });
  res.json(questions);
});

questionsRouter.get("/years", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.examId) filter.examId = req.query.examId;
  const years = await Question.distinct("year", filter);
  res.json(years.filter((y) => y !== null).sort((a: number, b: number) => b - a));
});

import { Router } from "express";
import { Types } from "mongoose";
import { Figure } from "../models/Figure.js";

export const figuresRouter = Router();

// Served without auth because <img> tags cannot send a bearer token. Ids are
// random ObjectIds that only reach a client inside authenticated question data.
figuresRouter.get("/:id", async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(404).end();
  const fig = await Figure.findById(req.params.id).select("data contentType");
  if (!fig) return res.status(404).end();
  res.setHeader("Content-Type", fig.contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(fig.data);
});

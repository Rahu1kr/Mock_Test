import "dotenv/config";
// Express 4 does not forward rejected promises from async handlers, so any
// thrown error (e.g. a malformed ObjectId in the URL) would otherwise escape as
// an unhandled rejection and kill the process. This patches them through to the
// error middleware below.
import "express-async-errors";
import express, { NextFunction, Request, Response } from "express";

import cors from "cors";
import { connectDb } from "./config/db.js";
import { requireAdmin } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { examsRouter } from "./routes/exams.js";
import { topicsRouter } from "./routes/topics.js";
import { questionsRouter } from "./routes/questions.js";
import { attemptsRouter } from "./routes/attempts.js";
import { adminExamsRouter } from "./routes/admin/exams.js";
import { adminTopicsRouter } from "./routes/admin/topics.js";
import { adminQuestionsRouter } from "./routes/admin/questions.js";
import { adminUploadRouter } from "./routes/admin/upload.js";
import { adminUsersRouter } from "./routes/admin/users.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

// Allowed origins come from CORS_ORIGIN (comma-separated). Vercel preview
// deployments get a new subdomain each push, so those are matched by pattern
// rather than needing the env var updated every time.
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    "CORS_ORIGIN is not set — allowing all origins. Set it to your frontend URL in production."
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser callers (curl, health checks) send no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "geo-app-backend" });
});


app.use("/api/auth", authRouter);
app.use("/api/exams", examsRouter);
app.use("/api/topics", topicsRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/attempts", attemptsRouter);

app.use("/api/admin/exams", requireAdmin, adminExamsRouter);
app.use("/api/admin/topics", requireAdmin, adminTopicsRouter);
app.use("/api/admin/questions", requireAdmin, adminQuestionsRouter);
app.use("/api/admin/upload", requireAdmin, adminUploadRouter);
app.use("/api/admin/users", requireAdmin, adminUsersRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err: Error & { name?: string; path?: string }, _req: Request, res: Response, _next: NextFunction) => {
  // A malformed id in the URL is a client mistake, not a server fault — answer
  // 400 with a clean message rather than leaking Mongoose internals.
  if (err.name === "CastError") {
    return res.status(400).json({ error: "Invalid id in request" });
  }
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  await connectDb(uri);
  app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

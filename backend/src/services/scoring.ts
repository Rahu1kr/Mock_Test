import { Attempt } from "../models/Attempt.js";

type SubmitStatus = "submitted" | "auto_submitted";

/**
 * Single place both manual and automatic submission go through, so the two
 * paths can never disagree on a score.
 */
export async function submitAttempt(attemptId: string, status: SubmitStatus) {
  const attempt = await Attempt.findById(attemptId);
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.status !== "in_progress") return attempt;

  let correctCount = 0;
  let wrongCount = 0;
  for (const answer of attempt.answers) {
    if (!answer.selectedOption) continue;
    if (answer.isCorrect) correctCount += 1;
    else wrongCount += 1;
  }
  const skippedCount = attempt.questionIds.length - (correctCount + wrongCount);

  attempt.correctCount = correctCount;
  attempt.wrongCount = wrongCount;
  attempt.skippedCount = Math.max(0, skippedCount);
  attempt.score = correctCount * attempt.marksCorrect + wrongCount * attempt.marksWrong;
  attempt.status = status;
  attempt.submittedAt = new Date();

  await attempt.save();
  return attempt;
}

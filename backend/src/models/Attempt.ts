import { Schema, model, Types, InferSchemaType, HydratedDocument } from "mongoose";

const answerSchema = new Schema(
  {
    questionId: { type: Types.ObjectId, ref: "Question", required: true },
    selectedOption: { type: String, enum: ["A", "B", "C", "D", null], default: null },
    isCorrect: { type: Boolean, default: false },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const attemptSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },

    // A "paper" is one year of one exam section; there is no separate test entity.
    examId: { type: Types.ObjectId, ref: "Exam", required: true, index: true },
    year: { type: Number, default: null },
    session: { type: String, default: "" },

    // "practice" shows answers as the user taps; "exam" simulates the real test.
    mode: { type: String, enum: ["practice", "exam"], required: true },

    // Snapshot of the paper taken when the attempt starts, so later imports or
    // edits can never change a test already in progress.
    questionIds: { type: [Types.ObjectId], ref: "Question", required: true },
    marksCorrect: { type: Number, required: true },
    marksWrong: { type: Number, required: true },

    startedAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: null }, // null = untimed (practice)
    submittedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["in_progress", "submitted", "auto_submitted"],
      default: "in_progress",
    },

    score: { type: Number, default: null },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    answers: { type: [answerSchema], default: [] },
  },
  { timestamps: true }
);

attemptSchema.index({ userId: 1, status: 1 });
attemptSchema.index({ userId: 1, examId: 1, year: 1, session: 1, mode: 1 });

export type AttemptDoc = HydratedDocument<InferSchemaType<typeof attemptSchema>>;

export const Attempt = model("Attempt", attemptSchema);

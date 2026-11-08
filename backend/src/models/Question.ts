import { Schema, model, Types } from "mongoose";

const optionSchema = new Schema(
  {
    key: { type: String, enum: ["A", "B", "C", "D"], required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const questionSchema = new Schema(
  {
    examId: { type: Types.ObjectId, ref: "Exam", required: true, index: true },
    topicId: { type: Types.ObjectId, ref: "Topic", default: null, index: true },
    year: { type: Number, default: null },
    // Exams can run more than once a year (June / December sittings, re-exams),
    // so a paper is identified by year *and* session, not year alone.
    session: { type: String, default: "", trim: true },
    questionText: { type: String, required: true },
    options: {
      type: [optionSchema],
      required: true,
      validate: {
        validator: (opts: unknown[]) => opts.length === 4,
        message: "A question must have exactly 4 options (A-D).",
      },
    },
    correctOption: { type: String, enum: ["A", "B", "C", "D"], required: true },
    explanation: { type: String, default: "" },
    sourceCitation: { type: String, default: "" },
  },
  { timestamps: true }
);

questionSchema.index({ examId: 1, year: 1, session: 1 });
questionSchema.index({ examId: 1, topicId: 1 });

export const Question = model("Question", questionSchema);

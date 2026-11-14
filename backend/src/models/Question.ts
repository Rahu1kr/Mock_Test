import { Schema, model, Types } from "mongoose";

const optionSchema = new Schema(
  {
    key: { type: String, enum: ["A", "B", "C", "D"], required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const listItemSchema = new Schema(
  {
    label: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

// "Match List I with List II" questions keep both lists as data, so the app can
// lay them out side by side the way the printed paper does.
const matchListSchema = new Schema(
  {
    leftTitle: { type: String, default: "List I" },
    rightTitle: { type: String, default: "List II" },
    left: { type: [listItemSchema], default: [] },
    right: { type: [listItemSchema], default: [] },
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
    // Position in the original paper (Q1…Q100); also the import upsert key.
    questionNumber: { type: Number, default: null },
    // Markdown. Figures are images whose src is "figure:<Figure id>".
    questionText: { type: String, required: true },
    matchList: { type: matchListSchema, default: null },
    // Instruction printed after the lists, e.g. "Choose the correct answer…".
    stemAfter: { type: String, default: "" },
    options: {
      type: [optionSchema],
      required: true,
      validate: {
        validator: (opts: unknown[]) => opts.length === 4,
        message: "A question must have exactly 4 options (A-D).",
      },
    },
    correctOption: { type: String, enum: ["A", "B", "C", "D"], required: true },
    // Markdown: tables, LaTeX math ($…$), figures as in questionText.
    explanation: { type: String, default: "" },
    sourceCitation: { type: String, default: "" },
  },
  { timestamps: true }
);

questionSchema.index({ examId: 1, year: 1, session: 1 });
questionSchema.index({ examId: 1, topicId: 1 });

export const Question = model("Question", questionSchema);

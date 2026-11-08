import { Schema, model, InferSchemaType, HydratedDocument } from "mongoose";

const examSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: "" },
    // Home-screen grouping, e.g. "UGC NET" or "State SET".
    group: { type: String, default: "UGC NET", trim: true },
    displayOrder: { type: Number, default: 0 },
    // Exam-mode defaults; a paper inherits these when an attempt starts.
    marksCorrect: { type: Number, default: 2 },
    marksWrong: { type: Number, default: 0 },
    minutesPerQuestion: { type: Number, default: 1.2 },
  },
  { timestamps: true }
);

export type ExamDoc = HydratedDocument<InferSchemaType<typeof examSchema>>;

export const Exam = model("Exam", examSchema);

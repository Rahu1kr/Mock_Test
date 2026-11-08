import { Schema, model, Types } from "mongoose";

const topicSchema = new Schema(
  {
    examId: { type: Types.ObjectId, ref: "Exam", required: true, index: true },
    name: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Topic = model("Topic", topicSchema);

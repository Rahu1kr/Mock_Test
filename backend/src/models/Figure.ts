import { Schema, model } from "mongoose";

// Images used by questions and explanations. Kept in the database (not the
// repo or the frontend bundle) so imported paper content never lands in git.
const figureSchema = new Schema(
  {
    // Stable import key, e.g. "UGC_Geo_December 2019/q50-1.png": re-importing a
    // paper overwrites its figures instead of piling up duplicates.
    name: { type: String, required: true, unique: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

export const Figure = model("Figure", figureSchema);

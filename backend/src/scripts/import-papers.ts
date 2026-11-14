/**
 * Imports papers produced by scripts/extract-paper.mjs into MongoDB.
 *
 *   npm run import:papers -- "../content/extracted/UGC_Geo_December 2019.json" [...]
 *   npm run import:papers -- --all          # every *.json in content/extracted
 *   add --dry to see what would change without writing
 *
 * Upserts by (exam, year, session, question number), so it is safe to re-run
 * after re-extracting a paper. Questions imported earlier from CSV are matched
 * by the "Q.<n>" at the end of their source citation and updated in place —
 * their ids (and so users' attempt history) and topic assignments survive.
 * Figures go into the Figure collection; "fig:<file>" links in the Markdown
 * become "figure:<id>".
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { Exam } from "../models/Exam.js";
import { Question } from "../models/Question.js";
import { Figure } from "../models/Figure.js";

interface ListItem {
  label: string;
  text: string;
}
interface ExtractedQuestion {
  number: number;
  kind: string;
  stem: string;
  match: { leftTitle: string; rightTitle: string; left: ListItem[]; right: ListItem[] } | null;
  stemAfter: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  answer: "A" | "B" | "C" | "D" | null;
  explanation: string;
  issues: string[];
}
interface ExtractedPaper {
  source: string;
  examCode: string;
  year: number;
  session: string;
  citation: string;
  questions: ExtractedQuestion[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const extractedDir = resolve(process.cwd(), "../content/extracted");
let files = args.filter((a) => !a.startsWith("--")).map((f) => resolve(f));
if (args.includes("--all")) {
  files = readdirSync(extractedDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(extractedDir, f));
}
if (!files.length) {
  console.error('Usage: npm run import:papers -- [--dry] "<paper.json>" … | --all');
  process.exit(1);
}

async function storeFigures(markdown: string, paperKey: string, figDir: string): Promise<string> {
  const refs = [...markdown.matchAll(/\(fig:([^)\s]+)\)/g)].map((m) => m[1]);
  let out = markdown;
  for (const file of new Set(refs)) {
    const path = join(figDir, file);
    if (!existsSync(path)) {
      console.warn(`   missing figure file ${file}`);
      continue;
    }
    let id = "dry-run";
    if (!dry) {
      const fig = await Figure.findOneAndUpdate(
        { name: `${paperKey}/${file}` },
        {
          contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
          data: readFileSync(path),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      id = fig.id;
    }
    out = out.split(`(fig:${file})`).join(`(figure:${id})`);
  }
  return out;
}

async function importPaper(file: string) {
  const paper = JSON.parse(readFileSync(file, "utf8")) as ExtractedPaper;
  const paperKey = basename(file, ".json");
  const figDir = join(dirname(file), paperKey, "figures");

  const exam = await Exam.findOne({ code: paper.examCode.toUpperCase() });
  if (!exam) throw new Error(`no exam with code ${paper.examCode} — create it in the admin panel first`);

  const existing = await Question.find({ examId: exam._id, year: paper.year, session: paper.session });
  const byNumber = new Map<number, (typeof existing)[number]>();
  for (const q of existing) {
    const n = q.questionNumber ?? Number(q.sourceCitation.match(/Q\.(\d+)\s*$/)?.[1] ?? NaN);
    if (Number.isFinite(n)) byNumber.set(n, q);
  }

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  const touched = new Set<string>();

  for (const q of paper.questions) {
    const keys = q.options.map((o) => o.key).join("");
    if (!q.answer || keys !== "ABCD" || q.options.some((o) => !o.text.trim()) || !q.stem.trim()) {
      skipped.push(`Q${q.number}: ${q.issues.join("; ") || "incomplete"}`);
      continue;
    }

    const fields = {
      examId: exam._id,
      year: paper.year,
      session: paper.session,
      questionNumber: q.number,
      questionText: await storeFigures(q.stem, paperKey, figDir),
      matchList: q.match,
      stemAfter: q.stemAfter ?? "",
      options: q.options,
      correctOption: q.answer,
      explanation: await storeFigures(q.explanation ?? "", paperKey, figDir),
      sourceCitation: `${paper.citation} Q.${q.number}`,
    };

    const current = byNumber.get(q.number);
    if (current) {
      touched.add(current.id);
      if (!dry) await Question.updateOne({ _id: current._id }, { $set: fields });
      updated++;
    } else {
      if (!dry) await Question.create(fields);
      created++;
    }
  }

  const untouched = existing.filter((q) => !touched.has(q.id)).length;
  console.log(
    `${paperKey}: ${paper.session} ${paper.year} — ${created} new, ${updated} updated, ${skipped.length} skipped` +
      (untouched ? `, ${untouched} older questions not in this file (left as is)` : "")
  );
  for (const s of skipped) console.log(`   skipped ${s}`);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (backend/.env).");
  process.exit(1);
}
await connectDb(uri);
if (dry) console.log("DRY RUN — nothing will be written\n");
let failed = 0;
for (const f of files) {
  try {
    await importPaper(f);
  } catch (err) {
    failed++;
    console.error(`${basename(f)}: FAILED — ${(err as Error).message}`);
  }
}
await mongoose.disconnect();
process.exit(failed ? 1 : 0);

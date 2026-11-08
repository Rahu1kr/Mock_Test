import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { Exam } from "../../models/Exam.js";
import { Topic } from "../../models/Topic.js";
import { Question } from "../../models/Question.js";

export const adminUploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const REQUIRED_COLUMNS = [
  "exam_code",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_option",
];

interface CsvRow {
  exam_code?: string;
  topic_name?: string;
  year?: string;
  session?: string;
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_option?: string;
  explanation?: string;
  source_citation?: string;
}

interface RowError {
  row: number;
  message: string;
}

// Parses + validates the CSV. With ?dryRun=true it reports what *would* import
// without writing, so the admin can fix a spreadsheet before committing to it.
adminUploadRouter.post("/questions", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')" });

  let rows: CsvRow[];
  try {
    rows = parse(req.file.buffer, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as CsvRow[];
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${(err as Error).message}` });
  }

  if (rows.length === 0) return res.status(400).json({ error: "CSV contains no data rows" });

  const presentColumns = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !presentColumns.includes(c));
  if (missing.length) {
    return res.status(400).json({ error: `CSV is missing required column(s): ${missing.join(", ")}` });
  }

  const exams = await Exam.find();
  const examByCode = new Map(exams.map((e) => [e.code.toUpperCase(), e]));

  const topics = await Topic.find();
  const topicKey = (examId: string, name: string) => `${examId}::${name.toLowerCase()}`;
  const topicMap = new Map(topics.map((t) => [topicKey(t.examId.toString(), t.name), t]));

  const errors: RowError[] = [];
  const valid: {
    rowNumber: number;
    examId: string;
    topicName: string | null;
    year: number | null;
    session: string;
    questionText: string;
    options: { key: string; text: string }[];
    correctOption: string;
    explanation: string;
    sourceCitation: string;
  }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for header, +1 for 1-based display
    const examCode = row.exam_code?.trim().toUpperCase();
    const exam = examCode ? examByCode.get(examCode) : undefined;

    if (!examCode) {
      errors.push({ row: rowNumber, message: "exam_code is empty" });
      return;
    }
    if (!exam) {
      errors.push({ row: rowNumber, message: `unknown exam_code "${examCode}"` });
      return;
    }
    if (!row.question_text?.trim()) {
      errors.push({ row: rowNumber, message: "question_text is empty" });
      return;
    }
    const optionTexts = [row.option_a, row.option_b, row.option_c, row.option_d];
    if (optionTexts.some((t) => !t?.trim())) {
      errors.push({ row: rowNumber, message: "all four options (a-d) must be non-empty" });
      return;
    }
    const correct = row.correct_option?.trim().toUpperCase();
    if (!correct || !["A", "B", "C", "D"].includes(correct)) {
      errors.push({
        row: rowNumber,
        message: `correct_option must be A, B, C or D (got "${row.correct_option ?? ""}")`,
      });
      return;
    }
    let year: number | null = null;
    if (row.year?.trim()) {
      const parsed = Number(row.year.trim());
      if (!Number.isInteger(parsed) || parsed < 1950 || parsed > 2100) {
        errors.push({ row: rowNumber, message: `year "${row.year}" is not a valid year` });
        return;
      }
      year = parsed;
    }

    valid.push({
      rowNumber,
      examId: exam.id,
      topicName: row.topic_name?.trim() || null,
      year,
      session: row.session?.trim() ?? "",
      questionText: row.question_text.trim(),
      options: [
        { key: "A", text: optionTexts[0]!.trim() },
        { key: "B", text: optionTexts[1]!.trim() },
        { key: "C", text: optionTexts[2]!.trim() },
        { key: "D", text: optionTexts[3]!.trim() },
      ],
      correctOption: correct,
      explanation: row.explanation?.trim() ?? "",
      sourceCitation: row.source_citation?.trim() ?? "",
    });
  });

  const dryRun = req.query.dryRun === "true";
  if (dryRun) {
    return res.json({
      dryRun: true,
      totalRows: rows.length,
      validRows: valid.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      preview: valid.slice(0, 5).map((v) => ({
        questionText: v.questionText,
        correctOption: v.correctOption,
        year: v.year,
        session: v.session,
        topicName: v.topicName,
      })),
    });
  }

  if (errors.length) {
    return res.status(400).json({
      error: "CSV has validation errors; nothing was imported. Fix them and re-upload.",
      totalRows: rows.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    });
  }

  // Create any topics referenced by name but not yet in the DB.
  const newTopicKeys = new Set<string>();
  for (const v of valid) {
    if (!v.topicName) continue;
    const key = topicKey(v.examId, v.topicName);
    if (!topicMap.has(key)) newTopicKeys.add(`${v.examId}::${v.topicName}`);
  }
  for (const entry of newTopicKeys) {
    const [examId, name] = entry.split("::");
    const created = await Topic.create({ examId, name });
    topicMap.set(topicKey(examId, name), created);
  }

  const docs = valid.map((v) => ({
    examId: v.examId,
    topicId: v.topicName ? topicMap.get(topicKey(v.examId, v.topicName))!.id : null,
    year: v.year,
    session: v.session,
    questionText: v.questionText,
    options: v.options,
    correctOption: v.correctOption,
    explanation: v.explanation,
    sourceCitation: v.sourceCitation,
  }));

  const inserted = await Question.insertMany(docs);
  res.status(201).json({
    imported: inserted.length,
    topicsCreated: newTopicKeys.size,
  });
});

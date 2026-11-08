#!/usr/bin/env node
/**
 * Extracts UGC NET question papers (PW-compiled NTA papers) into the CSV shape
 * the admin CSV uploader expects.
 *
 * The PDFs are two-column A4. `pdftotext -layout` across the full width
 * interleaves the columns, so each page is extracted twice — left half then
 * right half — and concatenated to recover true reading order.
 *
 * Only the exam content is taken: question text, the four options, and the
 * correct answer from the paper's own answer key. The worked "Text Solution"
 * prose is the publisher's own writing and is deliberately not copied.
 *
 * Usage: node extract-pdf.mjs <file.pdf> <EXAM_CODE> <YEAR> <"Citation label">
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

const [, , pdfPath, examCode, yearArg, sessionArg, citationLabel] = process.argv;
if (!pdfPath || !examCode || !yearArg) {
  console.error(
    'Usage: node extract-pdf.mjs <file.pdf> <EXAM_CODE> <YEAR> [SESSION] ["Citation"]'
  );
  process.exit(1);
}
const year = Number(yearArg);
const session = (sessionArg ?? "").trim();
const citation = citationLabel || basename(pdfPath, ".pdf");

const PAGE_W = 595;
const MID = 300;

function pdftotext(args) {
  return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function pageCount() {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  return Number(info.match(/^Pages:\s+(\d+)/m)[1]);
}

/** One page, left column then right column, in reading order. */
function pageText(p) {
  const left = pdftotext(["-layout", "-x", "0", "-y", "0", "-W", String(MID), "-H", "841",
    "-f", String(p), "-l", String(p), pdfPath, "-"]);
  const right = pdftotext(["-layout", "-x", String(MID), "-y", "0", "-W", String(PAGE_W - MID),
    "-H", "841", "-f", String(p), "-l", String(p), pdfPath, "-"]);
  return left + "\n" + right;
}

const total = pageCount();

// ---- locate sections -------------------------------------------------------
let answerKeyStart = null;
let solutionsStart = null;
for (let p = 1; p <= total; p++) {
  const t = pdftotext(["-layout", "-f", String(p), "-l", String(p), pdfPath, "-"]);
  if (answerKeyStart === null && /answer\s*key/i.test(t)) answerKeyStart = p;
  if (solutionsStart === null && /Text\s*Solution/i.test(t)) { solutionsStart = p; break; }
}
if (!answerKeyStart) { console.error("No answer key found"); process.exit(1); }
const questionsEnd = answerKeyStart - 1;
const keyEnd = (solutionsStart ?? total + 1) - 1;

// ---- answer key ------------------------------------------------------------
const answers = new Map();
for (let p = answerKeyStart; p <= keyEnd; p++) {
  const t = pdftotext(["-layout", "-f", String(p), "-l", String(p), pdfPath, "-"]);
  for (const m of t.matchAll(/Q\s*(\d{1,3})\s*[.)]?\s*\(([A-D])\)/g)) {
    answers.set(Number(m[1]), m[2]);
  }
}

// ---- questions -------------------------------------------------------------
let raw = "";
for (let p = 1; p <= questionsEnd; p++) raw += pageText(p) + "\n";

const lines = raw
  .split("\n")
  .map((l) => l.replace(/\s+$/, ""))
  .filter((l) => !/^\s*UGC NET\s*$/.test(l))
  .filter((l) => !/Android App \| iOS App \| PW Website/.test(l))
  .filter((l) => l.trim() !== "");

// Split the stream on "Q<n>" headers.
//
// Some questions come in comprehension sets introduced by
// "Directions (91-95) Read the following passage...". That passage belongs to
// every question in the range, and must not be appended to the preceding
// question's last option — so it is captured separately and the lines are kept
// out of the question buffer.
const blocks = new Map();
const passages = []; // { from, to, text }
let currentQ = null;
let buffer = [];
let passage = null;

const flush = () => {
  if (currentQ !== null && !blocks.has(currentQ)) blocks.set(currentQ, buffer.join("\n"));
  buffer = [];
};
const endPassage = () => {
  if (passage) {
    passage.lines = passage.lines
      .filter((l) => !/^\s*(Comprehension|Read the following passage)\s*:?\s*$/i.test(l))
      .filter((l) => !/^\s*and answer the given questions\.?\s*$/i.test(l));
    passages.push({ from: passage.from, to: passage.to, text: clean(passage.lines.join("\n")) });
    passage = null;
  }
};

for (const line of lines) {
  const dir = line.match(/Directions?\s*\((\d{1,3})\s*[-–]\s*(\d{1,3})\)/i);
  if (dir) {
    flush();
    currentQ = null;
    endPassage();
    passage = { from: Number(dir[1]), to: Number(dir[2]), lines: [] };
    // Keep anything on the same line after the marker.
    const tail = line.slice(dir.index + dir[0].length);
    if (tail.trim()) passage.lines.push(tail);
    continue;
  }

  const m = line.match(/^\s*Q\s?(\d{1,3})[.)]?\s*(.*)$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 200) {
    endPassage();
    flush();
    currentQ = Number(m[1]);
    buffer = [m[2]];
  } else if (passage) {
    passage.lines.push(line);
  } else if (currentQ !== null) {
    buffer.push(line);
  }
}
endPassage();
flush();

const passageFor = (q) => passages.find((p) => q >= p.from && q <= p.to)?.text ?? null;

// ---- parse each block into question + 4 options ----------------------------
const OPT = /\(([A-D])\)\s*/g;

function parseBlock(text) {
  // Options can share a line: "(A) foo        (B) bar"
  const hits = [...text.matchAll(/\(([A-D])\)/g)];
  if (hits.length < 4) return null;

  // Use the last run of A,B,C,D as the option block (earlier (A) can appear
  // inside match-the-list stems).
  let start = -1;
  for (let i = hits.length - 4; i >= 0; i--) {
    if (hits[i][1] === "A" && hits[i + 1][1] === "B" && hits[i + 2][1] === "C" && hits[i + 3][1] === "D") {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const stem = text.slice(0, hits[start].index);
  const optRegion = text.slice(hits[start].index);
  const marks = [...optRegion.matchAll(/\(([A-D])\)/g)].slice(0, 4);

  const options = [];
  for (let i = 0; i < 4; i++) {
    const from = marks[i].index + marks[i][0].length;
    const to = i < 3 ? marks[i + 1].index : optRegion.length;
    options.push({ key: marks[i][1], text: clean(optRegion.slice(from, to)) });
  }
  return { stem: clean(stem), options };
}

function clean(s) {
  return s
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

// The answer key is the authority on how many questions a paper actually has —
// papers are not always 100 questions (a re-exam may be shorter).
const questionNumbers = [...answers.keys()].sort((a, b) => a - b);
const lastQ = questionNumbers[questionNumbers.length - 1] ?? 0;

const rows = [];
const problems = [];
for (let q = 1; q <= lastQ; q++) {
  const block = blocks.get(q);
  if (!block) { problems.push({ q, why: "question block not found" }); continue; }
  const parsed = parseBlock(block);
  if (!parsed) { problems.push({ q, why: "could not isolate 4 options" }); continue; }
  const ans = answers.get(q);
  if (!ans) { problems.push({ q, why: "no answer in key" }); continue; }
  if (!parsed.stem) { problems.push({ q, why: "empty question text" }); continue; }
  if (parsed.options.some((o) => !o.text)) {
    problems.push({ q, why: "an option came out empty" });
    continue;
  }

  // A comprehension question is meaningless without its passage, so inline it
  // to keep each row self-contained.
  const p = passageFor(q);
  const stem = p ? `${p}\n\n${parsed.stem}` : parsed.stem;

  rows.push({ q, stem, options: parsed.options, answer: ans });
}

// ---- emit CSV --------------------------------------------------------------
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const header =
  "exam_code,topic_name,year,session,question_text,option_a,option_b,option_c,option_d,correct_option,explanation,source_citation";
const body = rows.map((r) =>
  [
    examCode,
    "",
    year,
    esc(session),
    esc(r.stem),
    esc(r.options[0].text),
    esc(r.options[1].text),
    esc(r.options[2].text),
    esc(r.options[3].text),
    r.answer,
    "",
    esc(`${citation} Q.${r.q}`),
  ].join(",")
);

const out = pdfPath.replace(/\.pdf$/i, ".csv").replace(/\/pdfs\//, "/extracted/");
writeFileSync(out, [header, ...body].join("\n") + "\n");

console.log(`pages: ${total} | questions p1-${questionsEnd} | key p${answerKeyStart}-${keyEnd}`);
console.log(`answer key entries: ${answers.size}`);
console.log(`extracted cleanly : ${rows.length}/100`);
console.log(`needs review      : ${problems.length}`);
problems.forEach((p) => console.log(`   Q${p.q}: ${p.why}`));
console.log(`wrote: ${out}`);

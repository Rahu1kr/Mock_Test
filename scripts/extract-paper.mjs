#!/usr/bin/env node
/**
 * Converts a PW-compiled UGC NET Geography PDF into structured JSON:
 * questions (with match-the-list tables, passages and figures), the official
 * answer key, and the full text solution as Markdown.
 *
 * Why vision instead of pdftotext: boxed match tables, formulas and the
 * solution tables come out of the text layer scrambled. Each page is rendered
 * to an image and Claude transcribes it into a fixed JSON schema instead.
 *
 * Deterministic parts stay deterministic:
 *   - section boundaries and the answer key come from the PDF's text layer;
 *   - figures are cut from the PDF's own embedded images (exact, watermark
 *     free) whenever one sits where Claude says the figure is, and only fall
 *     back to cropping the rendered page for vector drawings.
 *
 * Every API response is cached under content/extracted/<paper>/chunks, so a
 * re-run (after a crash, or to rebuild the JSON) never pays for a page twice.
 *
 * Usage:
 *   node extract-paper.mjs "<file.pdf>" [more.pdf ...]
 *   node extract-paper.mjs --all            # every PDF in content/pdfs
 *   node extract-paper.mjs --dry "<file>"   # no API calls: boundaries, key, page renders
 *
 * Env: ANTHROPIC_API_KEY (or an `ant auth login` profile)
 *      EXTRACT_MODEL   (default claude-opus-5-5)
 *      EXTRACT_EFFORT  (default low — this is transcription, not reasoning)
 *      EXTRACT_CONCURRENCY (default 4)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  EXAM_CODE, OUT_DIR, PDF_DIR, embeddedImages, findSections, paperMeta, parseAnswerKey, run,
} from "./paper-common.mjs";

const MODEL = process.env.EXTRACT_MODEL ?? "claude-opus-5-5";
const EFFORT = process.env.EXTRACT_EFFORT ?? "low";
const CONCURRENCY = Number(process.env.EXTRACT_CONCURRENCY ?? 4);

// ---------------------------------------------------------------------------
// Schemas — what Claude must return for each chunk of pages
// ---------------------------------------------------------------------------
const Box = z.object({
  page: z.number().int().describe("PDF page number the figure is on"),
  x: z.number().describe("left edge, fraction of page width 0-1"),
  y: z.number().describe("top edge, fraction of page height 0-1"),
  w: z.number().describe("width, fraction of page width 0-1"),
  h: z.number().describe("height, fraction of page height 0-1"),
});

const ListItem = z.object({
  label: z.string().describe("exactly as printed, e.g. 'a', 'A', 'i', 'I', '1'"),
  text: z.string(),
});

const QuestionsChunk = z.object({
  questions: z.array(
    z.object({
      number: z.number().int(),
      kind: z.enum(["mcq", "match", "statements", "assertion_reason", "sequence", "passage", "other"]),
      stem: z.string(),
      match: z
        .object({
          leftTitle: z.string(),
          rightTitle: z.string(),
          left: z.array(ListItem),
          right: z.array(ListItem),
        })
        .nullable(),
      stemAfter: z.string(),
      options: z.array(z.object({ key: z.enum(["A", "B", "C", "D"]), text: z.string() })),
      figures: z.array(Box),
    })
  ),
  passages: z.array(z.object({ from: z.number().int(), to: z.number().int(), text: z.string() })),
});

const SolutionsChunk = z.object({
  solutions: z.array(
    z.object({
      number: z.number().int(),
      answer: z.enum(["A", "B", "C", "D", "none"]),
      markdown: z.string(),
      figures: z.array(Box),
    })
  ),
});

const COMMON_RULES = `
General rules:
- Transcribe faithfully. Do not correct, summarise, or add anything.
- Ignore page furniture: the "UGC NET" running header, the large faint "PW" watermark, the footer ("Android App | iOS App | PW Website") and its logo.
- Write Markdown. Keep line breaks that carry meaning (each numbered statement on its own line). Use **bold** where the page uses bold.
- Mathematics: write it as LaTeX — inline $...$, or a centred formula as display math with the $$ delimiters on their own lines ("$$\\n...\\n$$"). Some formulas are followed by a garbled plain-text copy of the same formula (e.g. "yˉ=a+b⋅xˉ" under a typeset one) — that copy is a rendering artefact: keep the formula once.
- Tables: write as GitHub-flavoured Markdown tables. If a table cell's words are broken across lines by a narrow column ("Popu / latio / n"), join them back into words.
- Figures (maps, diagrams, graphs, photos, charts): do not describe them. Put a placeholder [[FIG1]], [[FIG2]] … in the text where the figure appears, and list each one's bounding box in "figures" (same order), as fractions of the whole page, generous rather than tight.
- Each image is preceded by a label giving its PDF page number and whether it is PRIMARY or CONTEXT.`;

const QUESTION_PROMPT = `You are transcribing pages of a UGC NET Geography previous-year question paper into structured data.
${COMMON_RULES}

What to extract:
- Every question whose "Q<number>" header is printed on a PRIMARY page. A question that starts on a PRIMARY page may continue onto the next page (CONTEXT): follow it there to finish it. Never output a question whose header is only on a CONTEXT page.
- "stem": the question text before any list or options. Numbered/lettered statements (A. … B. … or 1. … 2. …) go in the stem, one per line.
- "Match List I with List II" questions: kind "match"; put the two lists in "match" (titles as printed, e.g. "List I (Scholar)" / "List II (Theory)"; items with their printed labels, in order) — whether the page shows them as a boxed table or as two loose columns. "stem" is the instruction before the lists; "stemAfter" is the line after them such as "Choose the correct answer from the options given below:". For non-match questions "match" is null and "stemAfter" is usually "".
- "options": exactly the four options (A)–(D), text without the "(A)" prefix. Combination options like "(a)-(iv), (b)-(iii), (c)-(ii), (d)-(i)" are copied as written.
- Comprehension sets introduced by "Directions (91-95) Read the following passage…" or similar: put the passage in "passages" with its question range (only if the passage text is on a PRIMARY page), and do NOT repeat it in each question's stem.
- kind: "statements" for choose-the-correct-statements, "assertion_reason" for Assertion (A) / Reason (R), "sequence" for arrange-in-order, "passage" for comprehension questions, "mcq" otherwise.`;

const SOLUTION_PROMPT = `You are transcribing the worked-solutions section of a UGC NET Geography previous-year paper into structured data.
${COMMON_RULES}

What to extract:
- Every solution whose "Q<number> Text Solution:" header is printed on a PRIMARY page. A solution starting on a PRIMARY page may continue onto the CONTEXT page: follow it there to finish it. Never output a solution whose header is only on a CONTEXT page.
- "answer": the option letter from its "Answer:" line ("none" if there is no letter).
- "markdown": the complete solution exactly as shown — including the "Answer: …" line and everything after it (explanations, bullet lists, tables, formulas) — but without the "Q<number> Text Solution:" header itself.`;

// ---------------------------------------------------------------------------
// PDF helpers (poppler)
// ---------------------------------------------------------------------------
/** Page renders sized for the vision model (long edge 1568px, the API's own limit). */
function renderPages(pdf, dir, from, to) {
  mkdirSync(dir, { recursive: true });
  for (let p = from; p <= to; p++) {
    if (existsSync(pagePath(dir, p))) continue;
    run("pdftoppm", [
      "-png", "-scale-to", "1568", "-singlefile", "-f", String(p), "-l", String(p),
      pdf, pagePath(dir, p).replace(/\.png$/, ""),
    ]);
  }
}
const pagePath = (dir, p) => join(dir, `p-${p}.png`);

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
let client;
const getClient = () => (client ??= new Anthropic());

async function callClaude(system, schema, pageImages) {
  const content = [];
  for (const { page, role, path } of pageImages) {
    content.push({ type: "text", text: `PDF page ${page} (${role})` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: readFileSync(path).toString("base64") },
    });
  }
  content.push({ type: "text", text: "Transcribe the PRIMARY pages as instructed." });

  for (let attempt = 1; ; attempt++) {
    try {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        // Server-side fallback: if a safety classifier declines, the API
        // re-runs the request on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content }],
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("model declined this chunk (refusal)");
      if (msg.stop_reason === "max_tokens") throw new Error("response hit max_tokens");
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return { data: schema.parse(JSON.parse(text)), usage: msg.usage };
    } catch (err) {
      const retryable =
        !(err instanceof Anthropic.APIError) ||
        err instanceof Anthropic.RateLimitError ||
        (err.status ?? 0) >= 500;
      if (!retryable || attempt >= 3) throw err;
      console.warn(`   retrying (${attempt}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/** Pages split into windows of `size` PRIMARY pages, each with one CONTEXT page after it. */
function windows(from, to, size, contextLimit) {
  const out = [];
  for (let s = from; s <= to; s += size) {
    const primary = [];
    for (let p = s; p <= Math.min(s + size - 1, to); p++) primary.push(p);
    const ctx = primary[primary.length - 1] + 1;
    out.push({ primary, context: ctx <= contextLimit ? [ctx] : [] });
  }
  return out;
}

async function runChunks(kind, wins, system, schema, pagesDir, chunkDir) {
  mkdirSync(chunkDir, { recursive: true });
  let usage = { in: 0, out: 0 };
  const results = await pool(wins, CONCURRENCY, async (w) => {
    const file = join(chunkDir, `${kind}-${w.primary[0]}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    const imgs = [
      ...w.primary.map((p) => ({ page: p, role: "PRIMARY", path: pagePath(pagesDir, p) })),
      ...w.context.map((p) => ({ page: p, role: "CONTEXT", path: pagePath(pagesDir, p) })),
    ];
    const { data, usage: u } = await callClaude(system, schema, imgs);
    usage.in += u.input_tokens ?? 0;
    usage.out += u.output_tokens ?? 0;
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`   ${kind} pages ${w.primary.join(",")} ✓`);
    return data;
  });
  return { results, usage };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------
function cutFigure(pdf, box, embedded, outPath) {
  const pageDims = embedded.pages.get(box.page);
  if (pageDims) {
    // Snap to an embedded image that sits inside Claude's box: exact and clean.
    const bx = box.x * pageDims.width;
    const by = box.y * pageDims.height;
    const bw = box.w * pageDims.width;
    const bh = box.h * pageDims.height;
    let best = null;
    for (const img of embedded.images.filter((i) => i.page === box.page)) {
      const ix = Math.max(0, Math.min(bx + bw, img.left + img.width) - Math.max(bx, img.left));
      const iy = Math.max(0, Math.min(by + bh, img.top + img.height) - Math.max(by, img.top));
      const cover = (ix * iy) / (img.width * img.height);
      if (cover >= 0.5 && (!best || cover > best.cover)) best = { img, cover };
    }
    if (best) {
      const ext = best.img.src.split(".").pop();
      const out = outPath.replace(/\.png$/, `.${ext}`);
      copyFileSync(best.img.src, out);
      return basename(out);
    }
  }
  // Vector drawing: crop the rendered page (200 dpi, A4 = 1654×2339 px).
  const W = 1654;
  const H = 2339;
  const pad = 0.01;
  const x = Math.max(0, Math.round((box.x - pad) * W));
  const y = Math.max(0, Math.round((box.y - pad) * H));
  const w = Math.min(W - x, Math.round((box.w + 2 * pad) * W));
  const h = Math.min(H - y, Math.round((box.h + 2 * pad) * H));
  run("pdftoppm", [
    "-png", "-r", "200", "-singlefile",
    "-f", String(box.page), "-l", String(box.page),
    "-x", String(x), "-y", String(y), "-W", String(w), "-H", String(h),
    pdf, outPath.replace(/\.png$/, ""),
  ]);
  return basename(outPath);
}

/** Replace [[FIGn]] placeholders with fig: image links; append any unplaced ones. */
function placeFigures(markdown, files) {
  let text = markdown;
  const placed = new Set();
  text = text.replace(/\[\[FIG(\d+)\]\]/g, (_, n) => {
    const f = files[Number(n) - 1];
    if (!f) return "";
    placed.add(f);
    return `\n\n![Figure](fig:${f})\n\n`;
  });
  for (const f of files) if (!placed.has(f)) text += `\n\n![Figure](fig:${f})`;
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// One paper
// ---------------------------------------------------------------------------
async function extractPaper(pdf, { dry }) {
  const meta = paperMeta(pdf);
  const work = join(OUT_DIR, meta.key);
  const pagesDir = join(work, "pages");
  const figDir = join(work, "figures");
  mkdirSync(figDir, { recursive: true });

  const { total, keyStart, solStart } = findSections(pdf);
  const key = parseAnswerKey(pdf, keyStart, solStart - 1);
  console.log(
    `\n${meta.key}\n   ${meta.session} ${meta.year} | pages ${total} | questions 1-${keyStart - 1} | key ${keyStart}-${solStart - 1} (${key.size} answers) | solutions ${solStart}-${total}`
  );

  renderPages(pdf, pagesDir, 1, total);
  const embedded = embeddedImages(pdf, join(work, "embedded"));
  if (dry) {
    console.log(`   dry run: rendered ${total} pages, ${embedded.images.length} content images found`);
    return;
  }

  const q = await runChunks(
    "q",
    windows(1, keyStart - 1, 2, keyStart - 1),
    QUESTION_PROMPT,
    QuestionsChunk,
    pagesDir,
    join(work, "chunks")
  );
  const s = await runChunks(
    "s",
    windows(solStart, total, 3, total),
    SOLUTION_PROMPT,
    SolutionsChunk,
    pagesDir,
    join(work, "chunks")
  );

  // ---- merge ----
  const questions = new Map();
  const passages = [];
  for (const chunk of q.results) {
    for (const item of chunk.questions) if (!questions.has(item.number)) questions.set(item.number, item);
    passages.push(...chunk.passages);
  }
  const solutions = new Map();
  for (const chunk of s.results) {
    for (const item of chunk.solutions) if (!solutions.has(item.number)) solutions.set(item.number, item);
  }

  const lastQ = Math.max(...key.keys(), ...questions.keys());
  const out = [];
  const report = [];
  const usedImages = new Set();

  for (let n = 1; n <= lastQ; n++) {
    const issues = [];
    const item = questions.get(n);
    if (!item) {
      report.push(`Q${n}: question not found — skipped`);
      continue;
    }
    const sol = solutions.get(n);

    const qFigs = item.figures.map((b, i) => cutFigure(pdf, b, embedded, join(figDir, `q${n}-${i + 1}.png`)));
    const sFigs = (sol?.figures ?? []).map((b, i) =>
      cutFigure(pdf, b, embedded, join(figDir, `s${n}-${i + 1}.png`))
    );
    for (const b of [...item.figures, ...(sol?.figures ?? [])]) usedImages.add(b.page);

    const passage = passages.find((p) => n >= p.from && n <= p.to);
    let stem = placeFigures(item.stem, qFigs);
    if (passage) stem = `${passage.text.trim()}\n\n---\n\n${stem}`;

    const keys = item.options.map((o) => o.key).join("");
    if (keys !== "ABCD") issues.push(`options came out as "${keys}"`);
    if (item.options.some((o) => !o.text.trim())) issues.push("an option is empty");
    if (item.kind === "match" && !item.match) issues.push("match question without lists");
    if (item.match && item.match.left.length !== item.match.right.length)
      issues.push(`match lists differ in length (${item.match.left.length} vs ${item.match.right.length})`);

    const keyAnswer = key.get(n) ?? null;
    const solAnswer = sol && sol.answer !== "none" ? sol.answer : null;
    if (!sol) issues.push("no text solution found");
    if (keyAnswer && solAnswer && keyAnswer !== solAnswer)
      issues.push(`answer key says ${keyAnswer}, solution says ${solAnswer} (using key)`);
    const answer = keyAnswer ?? solAnswer;
    if (!answer) issues.push("no answer in key or solution");

    if (issues.length) report.push(`Q${n}: ${issues.join("; ")}`);
    out.push({
      number: n,
      kind: item.kind,
      stem,
      match: item.match,
      stemAfter: item.stemAfter,
      options: item.options,
      answer,
      explanation: sol ? placeFigures(sol.markdown, sFigs) : "",
      issues,
    });
  }

  // Embedded images on question pages that no question claimed are suspicious.
  for (const img of embedded.images) {
    if (img.page < keyStart && !usedImages.has(img.page))
      report.push(`page ${img.page}: an embedded image was not assigned to any question`);
  }

  const paper = {
    source: basename(pdf),
    examCode: EXAM_CODE,
    year: meta.year,
    session: meta.session,
    citation: meta.citation,
    figuresDir: figDir,
    questions: out,
  };
  writeFileSync(join(OUT_DIR, `${meta.key}.json`), JSON.stringify(paper, null, 2));
  writeFileSync(join(OUT_DIR, `${meta.key}.report.txt`), report.join("\n") + "\n");

  const ready = out.filter((x) => x.answer && !x.issues.some((i) => /options came out|empty/.test(i))).length;
  console.log(
    `   ${out.length} questions (${ready} ready) | ${report.length} report lines | tokens in ${q.usage.in + s.usage.in}, out ${q.usage.out + s.usage.out}`
  );
}

export { cutFigure, placeFigures };

// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

async function main() {
const args = process.argv.slice(2);
const dry = args.includes("--dry");
let files = args.filter((a) => !a.startsWith("--"));
if (args.includes("--all")) {
  files = readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => join(PDF_DIR, f));
}
if (!files.length) {
  console.error('Usage: node extract-paper.mjs [--dry] "<file.pdf>" … | --all');
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  try {
    await extractPaper(resolve(f), { dry });
  } catch (err) {
    failed++;
    console.error(`   FAILED: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
}

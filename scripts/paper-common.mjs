/**
 * Helpers shared by the two PDF converters:
 *   parse-paper.mjs   — offline, reads the PDF's text layer (no API key)
 *   extract-paper.mjs — optional, Claude vision via the API
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..");
export const PDF_DIR = join(ROOT, "content/pdfs");
export const OUT_DIR = join(ROOT, "content/extracted");
export const EXAM_CODE = "NET2";

export const run = (cmd, args) =>
  execFileSync(cmd, args.map(String), { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });

export function pageCount(pdf) {
  return Number(run("pdfinfo", [pdf]).match(/^Pages:\s+(\d+)/m)[1]);
}

export const pageText = (pdf, p) => run("pdftotext", ["-layout", "-f", p, "-l", p, pdf, "-"]);

/** Questions run up to the answer key; text solutions follow it. */
export function findSections(pdf) {
  const total = pageCount(pdf);
  let keyStart = null;
  let solStart = null;
  for (let p = 1; p <= total; p++) {
    const t = pageText(pdf, p);
    if (keyStart === null && /answer\s*key/i.test(t)) keyStart = p;
    if (solStart === null && /Text\s*Solution/i.test(t)) {
      solStart = p;
      break;
    }
  }
  if (!keyStart) throw new Error("answer key page not found");
  if (!solStart) throw new Error("text solutions not found");
  return { total, keyStart, solStart };
}

export function parseAnswerKey(pdf, from, to) {
  const answers = new Map();
  for (let p = from; p <= to; p++) {
    for (const m of pageText(pdf, p).matchAll(/Q\s*(\d{1,3})\s*[.)]?\s*\(([A-D])\)/g)) {
      answers.set(Number(m[1]), m[2]);
    }
  }
  return answers;
}

/**
 * Embedded raster images with their positions, via pdftohtml -xml (which also
 * leaves the full positioned text layer in <dir>/doc.xml). Images that recur
 * at the same spot on many pages (logo, watermark) are dropped.
 */
export function embeddedImages(pdf, dir) {
  mkdirSync(dir, { recursive: true });
  const xmlPath = join(dir, "doc.xml");
  if (!existsSync(xmlPath)) run("pdftohtml", ["-xml", "-q", pdf, join(dir, "doc")]);
  const xml = readFileSync(xmlPath, "utf8");

  const pages = new Map(); // page -> {width,height}
  const images = [];
  let current = null;
  for (const line of xml.split("\n")) {
    const pm = line.match(/<page number="(\d+)"[^>]*height="(\d+)" width="(\d+)"/);
    if (pm) {
      current = Number(pm[1]);
      pages.set(current, { height: Number(pm[2]), width: Number(pm[3]) });
      continue;
    }
    const im = line.match(/<image top="(-?\d+)" left="(-?\d+)" width="(\d+)" height="(\d+)" src="([^"]+)"/);
    if (im && current !== null) {
      images.push({
        page: current,
        top: Number(im[1]),
        left: Number(im[2]),
        width: Number(im[3]),
        height: Number(im[4]),
        src: im[5],
      });
    }
  }
  const sig = (i) => `${i.left},${i.top},${i.width},${i.height}`;
  const counts = new Map();
  for (const i of images) counts.set(sig(i), (counts.get(sig(i)) ?? 0) + 1);
  const content = images.filter((i) => counts.get(sig(i)) <= 2 && i.width > 40 && i.height > 40);
  return { pages, images: content, xmlPath };
}

export function paperMeta(file) {
  const name = basename(file, ".pdf").replace(/\s+/g, " ").trim();
  const m = name.match(/(June|December)\s+(\d{4})/i);
  if (!m) throw new Error(`cannot read session/year from "${name}"`);
  const month = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const tail = name.slice(m.index + m[0].length);
  let suffix = "";
  if (/Paper\s*2\b/i.test(tail)) suffix = "Paper II";
  else if (/Paper\s*3\b/i.test(tail)) suffix = "Paper III";
  else if (/Shift\s*II\b/i.test(tail)) suffix = "Shift II";
  else if (/Shift\s*I\b/i.test(tail)) suffix = "Shift I";
  else if (/Cancel/i.test(tail)) suffix = "Cancelled";
  else if (/Re-?exam/i.test(tail)) suffix = "Re-exam";
  return {
    key: name,
    year: Number(m[2]),
    session: suffix ? `${month} (${suffix})` : month,
    citation: `UGC NET Geography ${month} ${m[2]}${suffix ? ` ${suffix}` : ""}`,
  };
}

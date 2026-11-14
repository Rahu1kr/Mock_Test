#!/usr/bin/env node
/**
 * Offline PDF → JSON converter for the PW-compiled UGC NET Geography papers.
 * No API key, no network: everything comes from the PDF itself.
 *
 *   - Text and positions come from the PDF's text layer (pdftohtml -xml).
 *     Pages are two columns; each column is read top to bottom.
 *   - Questions: stem, the four options, and "Match List I / List II" turned
 *     into two real lists, whether the PDF prints them as a boxed table or as
 *     two loose columns. Comprehension passages are attached to their questions.
 *   - Text solutions become Markdown: paragraphs, bold, and bullet lists
 *     (bullet dots are vector drawings, so they are found by looking at the
 *     rendered page).
 *   - Anything text can't reproduce faithfully — tables, typeset formulas,
 *     diagrams — is cut out of the page as an image, with the faint PW
 *     watermark bleached out, so it looks exactly like the PDF.
 *
 * Output is the same JSON the backend importer reads:
 *   content/extracted/<paper>.json, <paper>.report.txt, <paper>/figures/
 *
 * Usage:
 *   node parse-paper.mjs "<file.pdf>" [more.pdf ...]
 *   node parse-paper.mjs --all
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  EXAM_CODE, OUT_DIR, PDF_DIR, embeddedImages, findSections, paperMeta, parseAnswerKey, run,
} from "./paper-common.mjs";

// ---------------------------------------------------------------------------
// Page geometry, in pdftohtml -xml units (1.5 × PDF points; A4 = 892 × 1261)
// ---------------------------------------------------------------------------
const XML_DPI = 108; // 72 pt/in × 1.5 — rendering at this dpi maps 1 px = 1 xml unit
const HEADER_MAX = 70; // "UGC NET" running header
const FOOTER_MIN = 1145; // "Android App | iOS App | PW Website"
/**
 * Column layout differs a little between papers (the right column starts
 * anywhere from x≈430 to 460), so it is measured from where the bold "Q<n>"
 * numbers sit. Each line carries its column's box.
 */
function measureColumns(textPages) {
  const counts = new Map();
  for (const items of textPages.values()) {
    for (const i of items) {
      if (i.bold && /^Q\s*\.?\s*\d{1,3}\b/.test(i.text.trim())) counts.set(i.left, (counts.get(i.left) ?? 0) + 1);
    }
  }
  const mode = (pred, dflt) =>
    [...counts.entries()].filter(([x]) => pred(x)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? dflt;
  const lh = mode((x) => x < 200, 44);
  const rh = mode((x) => x > 300 && x < 600, 459);
  return {
    mid: rh - 12,
    boxes: [
      { x0: 30, x1: rh - 20, outer: lh + 18 }, // text left of `outer` = Q numbers / passages
      { x0: rh - 8, x1: 866, outer: rh + 18 },
    ],
  };
}
const LINE_STEP = 23; // normal distance between baselines

// ---------------------------------------------------------------------------
// Text layer
// ---------------------------------------------------------------------------
const LIGATURES = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl" };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ﬁﬂﬀﬃﬄ]/g, (c) => LIGATURES[c])
    .replace(/ /g, " ");
}

function loadText(xmlPath) {
  const xml = readFileSync(xmlPath, "utf8");
  const fonts = new Map();
  for (const m of xml.matchAll(/<fontspec id="(\d+)" size="(\d+)" family="([^"]+)"/g)) fonts.set(m[1], m[3]);
  const pages = new Map();
  for (const pm of xml.matchAll(/<page number="(\d+)"[^>]*>([\s\S]*?)<\/page>/g)) {
    const items = [];
    const re = /<text top="(-?\d+)" left="(-?\d+)" width="(\d+)" height="(\d+)" font="(\d+)">([\s\S]*?)<\/text>/g;
    for (const t of pm[2].matchAll(re)) {
      const inner = t[6].replace(/<\/?a\b[^>]*>/g, "");
      const text = decode(inner.replace(/<[^>]+>/g, ""));
      if (!text.trim()) continue;
      const family = fonts.get(t[5]) ?? "";
      items.push({
        top: Number(t[1]),
        left: Number(t[2]),
        width: Number(t[3]),
        height: Number(t[4]),
        text,
        bold: /^\s*<b>[\s\S]*<\/b>\s*$/.test(inner),
        math: /MathJax_(Math|Size)/.test(family),
      });
    }
    pages.set(Number(pm[1]), items);
  }
  return pages;
}

/** Joins the pieces of one visual line. Wide gaps (table cells, side-by-side options) become 3 spaces. */
function joinParts(parts, fmt = (p) => p.text) {
  let s = "";
  let prevEnd = null;
  for (const p of parts) {
    const t = fmt(p);
    if (prevEnd !== null) {
      const gap = p.left - prevEnd;
      if (gap > 14) s = s.replace(/\s+$/, "") + "   " + t.replace(/^\s+/, "");
      else s += (gap > 1.5 && !/\s$/.test(s) && !/^\s/.test(t) ? " " : "") + t;
    } else s = t;
    prevEnd = p.left + p.width;
  }
  return s;
}

function finishLine(l) {
  l.parts.sort((a, b) => a.left - b.left);
  l.left = l.parts[0].left;
  l.right = Math.max(...l.parts.map((p) => p.left + p.width));
  l.top = Math.min(...l.parts.map((p) => p.top));
  l.bottom = Math.max(...l.parts.map((p) => p.top + p.height));
  l.math = l.parts.some((p) => p.math);
  l.text = joinParts(l.parts);
  return l;
}

/** All lines (and embedded images) of a page range, column by column, top to bottom. */
function readLines(textPages, images, from, to, geo) {
  const colOf = (x) => (x < geo.mid ? 0 : 1);
  const out = [];
  for (let p = from; p <= to; p++) {
    const items = (textPages.get(p) ?? []).filter((i) => i.top >= HEADER_MAX && i.top < FOOTER_MIN);
    for (const c of [0, 1]) {
      const its = items.filter((i) => colOf(i.left) === c).sort((a, b) => a.top - b.top || a.left - b.left);
      let lines = [];
      for (const it of its) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(it.top - last.parts[0].top) <= 7) last.parts.push(it);
        else lines.push({ page: p, col: c, box: geo.boxes[c], parts: [it] });
      }
      lines = lines.map(finishLine);
      // Superscripts/subscripts ("4 th") land on their own tiny line: fold them back in.
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const tiny = l.parts.every((x) => x.height < 16) && l.text.trim().length <= 4;
        if (!tiny) continue;
        const near = [lines[i - 1], lines[i + 1]]
          .filter((n) => n && !n.parts.every((x) => x.height < 16) && Math.abs(n.top - l.top) <= 14)
          .sort((a, b) => Math.abs(a.top - l.top) - Math.abs(b.top - l.top))[0];
        if (!near) continue;
        near.parts.push(...l.parts);
        finishLine(near);
        lines.splice(i, 1);
        i--;
      }
      for (const im of images.filter((i) => i.page === p && i.top < FOOTER_MIN)) {
        if (colOf(im.left + im.width / 2) !== c) continue;
        lines.push({ page: p, col: c, box: geo.boxes[c], top: im.top, bottom: im.top + im.height, left: im.left, image: im, parts: [], text: "" });
      }
      lines.sort((a, b) => a.top - b.top);
      out.push(...lines);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Images: render, bleach the watermark, crop, write PNG
// ---------------------------------------------------------------------------
function readPnm(path) {
  const buf = readFileSync(path);
  let pos = 0;
  const tokens = [];
  while (tokens.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) {
      while (buf[pos] !== 0x0a) pos++;
      continue;
    }
    let tok = "";
    while (!/\s/.test(String.fromCharCode(buf[pos]))) tok += String.fromCharCode(buf[pos++]);
    tokens.push(tok);
  }
  pos++; // single whitespace before the raster
  const [magic, w, h] = tokens;
  const channels = magic === "P5" ? 1 : 3;
  return { width: Number(w), height: Number(h), channels, data: buf.subarray(pos) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng({ width, height, channels, data }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The PW watermark is a pale grey: push light, colourless pixels to white. */
function bleach(img) {
  const { data, channels } = img;
  if (channels === 1) {
    for (let i = 0; i < data.length; i++) if (data[i] >= 200) data[i] = 255;
    return;
  }
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lo = Math.min(r, g, b);
    if (lo >= 200 && Math.max(r, g, b) - lo <= 28) data[i] = data[i + 1] = data[i + 2] = 255;
  }
}

/** Crop to the inked area plus a margin; null if nothing is there. */
function trim(img, pad = 8) {
  const { width, height, channels, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1, ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const v = channels === 1 ? data[i] : Math.min(data[i], data[i + 1], data[i + 2]);
      if (v < 170) {
        ink++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (ink < 40) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) {
    data.copy(out, y * w * channels, ((y0 + y) * width + x0) * channels, ((y0 + y) * width + x1 + 1) * channels);
  }
  return { width: w, height: h, channels, data: out };
}

/** Render a region (xml units) of a page to PNG. Returns the file name, or null if blank. */
function cropRegion(pdf, page, x0, y0, x1, y1, outPath, { dpi = 200, gray = false } = {}) {
  const f = dpi / XML_DPI;
  const base = outPath.replace(/\.png$/, "");
  run("pdftoppm", [
    ...(gray ? ["-gray"] : []),
    "-r", dpi, "-f", page, "-l", page,
    "-x", Math.max(0, Math.round(x0 * f)), "-y", Math.max(0, Math.round(y0 * f)),
    "-W", Math.round((x1 - x0) * f), "-H", Math.round((y1 - y0) * f),
    "-singlefile", pdf, base,
  ]);
  const pnm = `${base}.${gray ? "pgm" : "ppm"}`;
  const img = readPnm(pnm);
  rmSync(pnm);
  bleach(img);
  const trimmed = trim(img);
  if (!trimmed) return null;
  writeFileSync(outPath, encodePng(trimmed));
  return basename(outPath);
}

/** Pages rendered at 1 px per xml unit, kept in memory for bullet detection. */
function pageRaster(pdf, page, cache, tmpDir) {
  if (cache.has(page)) return cache.get(page);
  const base = join(tmpDir, `raster-${page}`);
  run("pdftoppm", ["-gray", "-r", XML_DPI, "-f", page, "-l", page, "-singlefile", pdf, base]);
  const img = readPnm(`${base}.pgm`);
  rmSync(`${base}.pgm`);
  cache.set(page, img);
  return img;
}

/** Bullet dots are drawn, not text: look for ink just left of the line. */
function hasBullet(raster, line) {
  const h = line.bottom - line.top;
  let dark = 0;
  for (let y = Math.round(line.top + h * 0.25); y <= line.top + h * 0.8; y++) {
    for (let x = Math.round(line.left - 24); x <= line.left - 4; x++) {
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
      if (raster.data[y * raster.width + x] < 150) dark++;
    }
  }
  return dark >= 4;
}

/** Table rows are crossed by at least two vertical border rules. */
function isRuled(raster, line) {
  const { x0, x1 } = line.box;
  const y0 = Math.max(0, Math.round(line.top - 3));
  const y1 = Math.min(raster.height - 1, Math.round(line.bottom + 3));
  let rules = 0;
  let inRule = false;
  for (let x = x0 + 2; x <= x1 - 4; x++) {
    let solid = true;
    for (let y = y0; y <= y1 && solid; y++) if (raster.data[y * raster.width + x] >= 150) solid = false;
    if (solid && !inRule) rules++;
    inRule = solid;
  }
  return rules >= 2;
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------
const esc = (t) => t.replace(/[\\`*_~$[\]<>|]/g, "\\$&");
/** Stop a line's start being read as a list, heading or quote. */
const escStart = (t) => t.replace(/^(\s*)([-+#>])/, "$1\\$2").replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3");
const squash = (t) => t.replace(/\s+/g, " ").trim();

function lineMarkdown(line) {
  const s = joinParts(line.parts, (p) => {
    const core = esc(p.text.trim());
    if (!core) return p.text;
    const lead = p.text.match(/^\s*/)[0];
    const trail = p.text.match(/\s*$/)[0];
    if (!p.bold) return lead + core + trail;
    // Keep punctuation outside the ** markers, or Markdown won't see them as bold.
    const m = core.match(/^([\p{P}\s\\]*)(.*?)([\p{P}\s]*)$/u);
    return lead + (m[2] ? `${m[1]}**${m[2]}**${m[3]}` : core) + trail;
  });
  return squash(s);
}
const mergeBold = (t) => t.replace(/\*\*(\s+)\*\*/g, "$1").replace(/\*\*\*\*/g, "");

// ---------------------------------------------------------------------------
// Splitting the stream into numbered blocks
// ---------------------------------------------------------------------------
const Q_HEAD = /^Q\s*\.?\s*(\d{1,3})\b\s*\.?\s*(?:Text\s*Solution\s*:?)?\s*/i;
const PASSAGE_START = /^(Directions?\b|Read the (following )?passage|Read the passage)/i;

function segment(lines, { passages }) {
  const blocks = new Map();
  const passageList = [];
  let cur = null;
  for (const l of lines) {
    if (!l.image) {
      const first = l.parts[0];
      const m = first.bold && l.left < l.box.outer ? first.text.trim().match(Q_HEAD) : null;
      if (m) {
        const n = Number(m[1]);
        cur = blocks.get(n) ?? { number: n, lines: [] };
        blocks.set(n, cur);
        const rest = first.text.trim().slice(m[0].length);
        const parts = (rest ? [{ ...first, text: rest, left: first.left + first.width - 1, width: 1 }] : [])
          .concat(l.parts.slice(1))
          .filter((p) => !/^\s*Text\s*Solution\s*:?\s*$/i.test(p.text));
        if (parts.length) cur.lines.push(finishLine({ ...l, parts }));
        continue;
      }
      if (passages && l.left < l.box.outer && PASSAGE_START.test(l.text.trim())) {
        const r = l.text.match(/\(\s*(\d{1,3})\s*[-–—to]+\s*(\d{1,3})\s*\)/);
        cur = { passage: true, from: r ? Number(r[1]) : null, to: r ? Number(r[2]) : null, lines: [l] };
        passageList.push(cur);
        continue;
      }
    }
    if (cur) cur.lines.push(l);
  }
  return { blocks, passages: passageList };
}

// ---------------------------------------------------------------------------
// Visual elements inside a block: embedded images, diagram gaps, tables, maths
// ---------------------------------------------------------------------------
function makeCutter(pdf, figDir) {
  return {
    image(prefix, img, n) {
      const ext = img.src.split(".").pop();
      const name = `${prefix}-${n}.${ext}`;
      copyFileSync(img.src, join(figDir, name));
      return name;
    },
    region(prefix, n, page, box, y0, y1, opts = {}) {
      const { x0, x1 } = box;
      const left = opts.left != null ? Math.max(x0, opts.left) : x0;
      return cropRegion(pdf, page, left, y0, x1, y1, join(figDir, `${prefix}-${n}.png`), opts);
    },
  };
}

const sameColAny = (a, b) => a && b && a.page === b.page && a.col === b.col;
const sameCol = (a, b) => a && b && !a.image && !b.image && a.page === b.page && a.col === b.col;

/**
 * Turns a block's lines into a sequence of {line} and {fig, alt} items.
 * `tables` also detects tables (solutions only — question pages have none,
 * and match lists there must stay text).
 */
function visualise(lines, cutter, prefix, { tables, raster }) {
  const n = lines.length;
  const tab = new Array(n).fill(false);
  if (tables) {
    for (let i = 0; i < n; i++) {
      const l = lines[i];
      if (l.image) continue;
      let cells = false;
      for (let k = 1; k < l.parts.length; k++) {
        if (l.parts[k].left - (l.parts[k - 1].left + l.parts[k - 1].width) > 14) cells = true;
      }
      const prev = sameCol(lines[i - 1], l) ? lines[i - 1] : null;
      const next = sameCol(l, lines[i + 1]) ? lines[i + 1] : null;
      // Cells are vertically centred, so table rows interleave at odd offsets.
      const stagger = (prev && l.top - prev.top < 17) || (next && next.top - l.top < 17);
      l.ruled = isRuled(raster(l.page), l);
      tab[i] = l.ruled || cells || stagger;
    }
    for (let i = 1; i < n - 1; i++) {
      if (!tab[i] && tab[i - 1] && tab[i + 1] && sameCol(lines[i - 1], lines[i]) && sameCol(lines[i], lines[i + 1]))
        tab[i] = true;
    }
  }

  const out = [];
  let figN = 0;
  let i = 0;
  while (i < n) {
    const l = lines[i];
    if (l.image) {
      out.push({ fig: cutter.image(prefix, l.image, ++figN), alt: "Figure" });
      i++;
      continue;
    }
    // A run of table lines, or of formula lines, is cut out as one image.
    const kind = tab[i] ? "table" : l.math ? "math" : null;
    if (kind) {
      let j = i;
      while (j + 1 < n && sameCol(lines[j], lines[j + 1]) && (kind === "table" ? tab[j + 1] : lines[j + 1].math || lines[j + 1].top - lines[j].top < 17)) j++;
      const ruled = lines.slice(i, j + 1).some((x) => x.ruled);
      if (kind === "math" || j - i >= (ruled ? 1 : 2)) {
        const before = sameCol(lines[i - 1], l) ? lines[i - 1].bottom + 1 : l.top - 16;
        const after = sameCol(lines[j], lines[j + 1]) ? lines[j + 1].top - 1 : lines[j].bottom + 14;
        const y0 = Math.max(before, l.top - (kind === "table" ? 16 : 8));
        const y1 = Math.min(after, Math.max(...lines.slice(i, j + 1).map((x) => x.bottom)) + (kind === "table" ? 14 : 8));
        const left = kind === "math" ? Math.min(...lines.slice(i, j + 1).map((x) => x.left)) - 8 : null;
        const file = cutter.region(prefix, ++figN, l.page, l.box, y0, y1, { gray: true, left });
        if (file) out.push({ fig: file, alt: kind === "table" ? "Table" : "Formula" });
        else for (let k = i; k <= j; k++) out.push({ line: lines[k] });
        i = j + 1;
        continue;
      }
    }
    out.push({ line: l });
    // A tall empty gap before the next line in the same column is a vector diagram.
    const next = lines[i + 1];
    if (sameCol(l, next) && next.top - l.bottom > 60) {
      const file = cutter.region(prefix, ++figN, l.page, l.box, l.bottom + 2, next.top - 2);
      if (file) out.push({ fig: file, alt: "Figure" });
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
const LABEL = /^\s*\(?([a-zA-Z]|[ivxIVX]{1,4}|\d{1,2})\s*[.)]\s*/;
function labelOf(text) {
  const m = text.match(LABEL);
  if (!m) return null;
  const lab = m[1];
  if (lab.length > 1 && !/^\d+$/.test(lab) && !ROMAN.test(lab)) return null;
  return { label: lab, rest: text.slice(m[0].length) };
}
const NEW_LINE_START = /^\s*(\(?([a-zA-Z]|[ivxIVX]{1,4}|\d{1,2})\s*[.)]\s|Assertion|Reason|Statement|Choose|Select|Codes?\b|Options?\b|List\b|Column\b)/;

function stemMarkdown(items) {
  let out = "";
  for (const it of items) {
    if (it.fig) {
      out += `\n\n![${it.alt}](fig:${it.fig})\n\n`;
      continue;
    }
    const raw = squash(it.line.text);
    const t = esc(raw);
    if (!out || out.endsWith("\n")) out += escStart(t);
    else if (NEW_LINE_START.test(raw) || /[:?]$/.test(out.trimEnd())) out += "\n" + escStart(t);
    else out += " " + t;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Splits "(A) … (B) … (C) … (D) …" into four options. Labels must start a line
 * or follow a wide gap, because option texts often cite labels themselves
 * ("(B), (C) and (E) only"); a looser pass is the fallback.
 */
function splitOptions(s) {
  for (const before of ["(?<=^|\\n|\\s{2})", "(?<!\\S)"]) {
    const pos = [];
    let from = 0;
    for (const k of ["A", "B", "C", "D"]) {
      const re = new RegExp(`${before}\\(${k}\\)\\s*`, "g");
      re.lastIndex = from;
      const m = re.exec(s);
      if (!m) break;
      pos.push({ key: k, start: m.index, textStart: m.index + m[0].length });
      // Strict pass: an option needs some text before the next label.
      from = m.index + m[0].length + (before.startsWith("(?<=") ? 1 : 0);
    }
    if (pos.length < 4) continue;
    const opts = pos.map((p, i) => ({ key: p.key, text: esc(squash(s.slice(p.textStart, i < 3 ? pos[i + 1].start : undefined))) }));
    if (opts.every((o) => o.text) || before === "(?<!\\S)") return opts;
  }
  return null;
}

/** Two lists from the lines between the "List I … List II" header and "Choose…". */
const labelStyle = (l) =>
  /^\d+$/.test(l) ? "digit" : /^[ivx]+$/.test(l) ? "roman" : /^[IVX]+$/.test(l) ? "ROMAN" : /^[a-z]$/.test(l) ? "letter" : "LETTER";

/** "a. Gour i. Lithosphere": a second label of another style starts List II. */
function splitInlineLabel(text) {
  const first = labelOf(text);
  if (!first) return [text];
  const style = labelStyle(first.label);
  const re = /\s(\(?([a-zA-Z]|[ivxIVX]{1,4}|\d{1,2})[.)])\s/g;
  for (const m of text.matchAll(re)) {
    if (m.index < text.length - first.rest.length) continue;
    const lab = labelOf(m[1] + " ");
    if (!lab || labelStyle(lab.label) === style) continue;
    return [text.slice(0, m.index), text.slice(m.index + 1)];
  }
  return [text];
}

const ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const FIRST_STYLE = { a: "letter", A: "LETTER", i: "roman", I: "ROMAN", 1: "digit" };
function nextLabel(label, style) {
  if (style === "digit") return String(Number(label) + 1);
  if (style === "roman") return ROMANS[ROMANS.indexOf(label) + 1];
  if (style === "ROMAN") return ROMANS[ROMANS.indexOf(label.toLowerCase()) + 1]?.toUpperCase();
  return String.fromCharCode(label.charCodeAt(0) + 1);
}
/** Does `label` continue this side's sequence (a→b→c, i→ii→iii …)? */
function fits(sd, label) {
  if (!sd.style) return label in FIRST_STYLE;
  return label === nextLabel(sd.last, sd.style);
}

function parseMatch(lines) {
  // Left edge per column: a list can run on into the next column.
  const leftOf = new Map();
  for (const l of lines) {
    const k = `${l.page}:${l.col}`;
    leftOf.set(k, Math.min(leftOf.get(k) ?? Infinity, l.left));
  }
  const side = { L: { title: [], items: [], loose: [] }, R: { title: [], items: [], loose: [] } };
  let prevSplit = false;
  let stacked = false;
  const BARE = /^\(?([A-Za-z]|[ivxIVX]{1,4}|\d{1,2})[.)]?$/;
  // Labels in a column of their own ("A" | "Absolute humidity" | "I." …)
  const bareMode = lines.some((l) =>
    l.parts.some((p) => /^\(?([A-Za-z]|[ivxIVX]{1,4})[.)]?$/.test(p.text.trim()) && p.left - leftOf.get(`${l.page}:${l.col}`) < 6)
  );
  const other = (s) => (s === "L" ? "R" : "L");
  /** Start an item if the label continues a side's sequence; returns false if it doesn't. */
  const addItem = (s, label, rest, top) => {
    const target = fits(side[s], label) ? s : !stacked && fits(side[other(s)], label) ? other(s) : null;
    if (!target) return false;
    const sd = side[target];
    sd.style ??= FIRST_STYLE[label];
    sd.last = label;
    sd.items.push({ label, text: rest ? [rest] : [], own: rest, top });
    return true;
  };
  const titleTexts = new Set();
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const leftX = leftOf.get(`${l.page}:${l.col}`);
    const pos = l.page * 4000 + l.col * 2000 + l.top; // reading order across columns and pages
    // Touching parts ("A" + ". Saltation") are one piece; wide gaps separate cells.
    const groups = [];
    for (const p of l.parts) {
      const g = groups.at(-1);
      if (g && p.left - (g.at(-1).left + g.at(-1).width) <= 14) g.push(p);
      else groups.push([p]);
    }
    const pieces = [];
    for (const g of groups) {
      if (g.length > 1 && BARE.test(g[0].text.trim()) && !/[.)]$/.test(g[0].text.trim())) g[0] = { ...g[0], text: g[0].text.trim() + "." };
      const bits = joinParts(g).split(/\s{3,}/).filter((b) => b.trim());
      bits.forEach((b, k) => {
        splitInlineLabel(b).forEach((bb, kk) => pieces.push({ text: bb, x: k === 0 && kk === 0 ? g[0].left : Infinity }));
      });
    }
    // "List I (Author) List II (Works)" printed as one run of text
    if (li === 0 && pieces.length === 1) {
      const m = pieces[0].text.match(/^(.*?)\s+((?:List|Column)\s*[-–—]?\s*(?:II|2)\b.*)$/i);
      if (m) pieces.splice(0, 1, { text: m[1], x: leftX }, { text: m[2], x: Infinity });
    }
    pieces.forEach((pc, k) => {
      const t = pc.text.trim();
      // List II printed underneath List I rather than beside it.
      if (titleTexts.has(t)) return; // header repeated where the table continues on the next page
      if (!stacked && side.L.items.length >= 2 && !side.R.items.length && pc.x - leftX <= 45 && /^(List|Column)\s*[-–—]?\s*(II|2)\b/i.test(t))
        stacked = true;
      let s = stacked || k > 0 || pc.x - leftX > 45 ? "R" : "L";
      // Column titles ("List – I (Scholar)") wherever they turn up.
      const title = t.match(/^(?:List|Column)\s*[-–—]?\s*(II|2|I|1)\b/i);
      if (title) {
        const ts = /^(II|2)$/i.test(title[1]) ? "R" : "L";
        if (side[ts].items.length) return;
        {
          titleTexts.add(t);
          side[ts].title.push(pc.text);
          side[ts].loose.push({ text: pc.text, top: -Infinity });
          return;
        }
      }
      // A label alone in its own table cell ("A"), with the item text beside it.
      const bare = bareMode && pc.x !== Infinity ? t.match(/^\(?([A-Za-z]|[ivxIVX]{1,4}|\d{1,2})[.)]?$/) : null;
      if (bare && addItem(s, bare[1], "", pos)) return;
      const lab = labelOf(pc.text);
      if (lab && addItem(s, lab.label, lab.rest, pos)) return;
      // Unlabelled text continues an item. In "merged" rows ("(a) X    (i) Y"),
      // the wrapped tail belongs to the right-hand item.
      if (k === 0 && prevSplit && s === "L" && !stacked && !bareMode) s = "R";
      side[s].loose.push({ text: pc.text, top: pos });
      const target = side[s].items.at(-1)?.text ?? side[s].title;
      if (target === side[s].title) titleTexts.add(t);
      target.push(pc.text);
    });
    prevSplit = pieces.length > 1;
  }
  // Bare-label cells are vertically centred, so their text may sit above the
  // label: give each loose line to the nearest label instead.
  for (const sd of [side.L, side.R]) {
    if (!bareMode || !sd.items.length) continue;
    sd.title = sd.title.filter((t) => /^(List|Column)/i.test(t.trim()));
    for (const it of sd.items) it.text = [];
    const parts = sd.items.map((it) => ({ it, top: it.top, text: it.own }));
    const firstTop = sd.items[0].top;
    for (const piece of sd.loose) {
      if (piece.top === -Infinity) continue;
      if (piece.top < firstTop - 30) {
        sd.title.push(piece.text);
        continue;
      }
      const near = sd.items.reduce((a, b) => (Math.abs(b.top - piece.top) < Math.abs(a.top - piece.top) ? b : a));
      parts.push({ it: near, top: piece.top, text: piece.text });
    }
    parts.sort((a, b) => a.top - b.top).forEach((p) => p.text && p.it.text.push(p.text));
  }
  const tidy = (t) => esc(squash(t).replace(/\(\s+/g, "(").replace(/\s+\)/g, ")"));
  const items = (arr) => arr.map((x) => ({ label: x.label, text: tidy(x.text.join(" ")) }));
  const result = {
    leftTitle: tidy(side.L.title.join(" ")) || "List I",
    rightTitle: tidy(side.R.title.join(" ")) || "List II",
    left: items(side.L.items),
    right: items(side.R.items),
  };
  const ok =
    result.left.length >= 2 &&
    result.left.length === result.right.length &&
    [...result.left, ...result.right].every((x) => x.text);
  return ok ? result : null;
}

function buildQuestion(block, cutter, raster) {
  const n = block.number;
  const issues = [];
  const lines = block.lines;
  if (process.env.DEBUG_Q == n) for (const l of lines) console.error(l.page, l.col, l.top, l.left, l.image ? "[IMG]" : JSON.stringify(l.text), l.parts.map((p) => p.top));

  // Options: the last "(A)" line from which (B), (C), (D) follow in order.
  // Read from the raw text, before anything is cut out as an image.
  let options = null;
  let optAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].image || !/^\s*\(A\)/.test(lines[i].text)) continue;
    const text = lines.slice(i).filter((x) => !x.image).map((x) => x.text).join("\n");
    options = splitOptions(text);
    if (options) {
      optAt = i;
      break;
    }
  }
  // A picture for option (A) can start a few pixels above its label.
  while (options && optAt > 0 && lines[optAt - 1].image && sameColAny(lines[optAt - 1], lines[optAt]) && Math.abs(lines[optAt - 1].top - lines[optAt].top) <= 20) optAt--;
  if (!options) {
    issues.push("options not found");
    options = [];
  }
  // Picture options: each image belongs to the label printed beside or above it.
  const optImages = lines.slice(optAt).filter((x) => x.image);
  let looseImages = optImages;
  if (options.length === 4 && optImages.length) {
    const labels = lines.slice(optAt).filter((x) => !x.image && /^\s*\([A-D]\)\s*$/.test(x.text));
    if (labels.length === 4 && options.every((o) => !o.text)) {
      const order = (x) => x.page * 4000 + x.col * 2000 + x.top;
      looseImages = [];
      for (const im of optImages) {
        const beside = labels.find((lb) => lb.page === im.page && lb.col === im.col && Math.abs(lb.top - im.top) <= 20);
        const owner = beside ?? labels.filter((lb) => order(lb) < order(im)).at(-1);
        if (!owner) {
          looseImages.push(im);
          continue;
        }
        const opt = options.find((o) => o.key === owner.text.trim()[1]);
        const name = cutter.image(`q${n}-${opt.key.toLowerCase()}`, im.image, 1);
        opt.text = (opt.text + ` ![Option ${opt.key}](fig:${name})`).trim();
      }
    }
  }
  if (looseImages.length) issues.push("a figure sits among the options — check");
  if (lines.slice(optAt).some((x) => x.math)) issues.push("an option contains a formula — check how it reads");

  const stemItems = visualise(lines.slice(0, optAt), cutter, `q${n}`, { tables: false, raster });
  const trailing = looseImages;
  let match = null;
  let stem = stemItems;
  let after = [];
  const hi = stemItems.findIndex((x) => x.line && /^\s*(List|Column)\s*[-–—]?\s*(I|II|1|2)\b/i.test(x.line.text));
  if (hi >= 0) {
    let end = stemItems.findIndex(
      (x, i) => i > hi && x.line && (/^\s*(Choose|Select|Codes?\b|Code\s*:|Options|Answer|Correct|Which)/i.test(x.line.text) || /^\s*\(?a\)?\s+\(?b\)?\s+\(?c\)?\s+\(?d\)?\s*$/i.test(x.line.text))
    );
    if (end < 0) end = stemItems.length;
    const region = stemItems.slice(hi, end);
    if (region.every((x) => x.line)) {
      match = parseMatch(region.map((x) => x.line));
      if (match) {
        stem = stemItems.slice(0, hi);
        after = stemItems.slice(end);
      }
    }
    if (!match) issues.push("looks like a match question but the lists could not be read — kept as text");
  }
  let md = stemMarkdown(stem);
  if (!md && match) md = "Match List – I with List – II";
  if (!md) issues.push("empty question text");

  let kind = "mcq";
  if (match) kind = "match";
  else if (/Assertion/i.test(md)) kind = "assertion_reason";
  else if (/statement/i.test(md)) kind = "statements";
  let stemAfter = stemMarkdown(after);
  for (const [k, im] of trailing.entries()) {
    const fig = `\n\n![Figure](fig:${cutter.image(`q${n}-end`, im.image, k + 1)})`;
    if (match) stemAfter = (stemAfter + fig).trim();
    else md = (md + fig).trim();
  }
  return { number: n, kind, stem: md, match, stemAfter, options, issues };
}

// ---------------------------------------------------------------------------
// Solutions
// ---------------------------------------------------------------------------
function columnBases(lines) {
  const bases = [];
  for (const c of [0, 1]) {
    const counts = new Map();
    for (const l of lines) {
      if (l.image || l.col !== c || l.left < l.box.outer) continue;
      const k = Math.round(l.left / 2) * 2;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    bases[c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (lines.find((l) => l.col === c)?.box.outer ?? 60) + 25;
  }
  return bases;
}

function buildSolution(block, cutter, raster, bases) {
  const seq = visualise(block.lines, cutter, `s${block.number}`, { tables: true, raster });

  // Bullet levels: distinct text indents of bulleted lines, smallest first.
  const bulletIndents = [];
  for (const it of seq) {
    if (!it.line) continue;
    it.bullet = hasBullet(raster(it.line.page), it.line);
    if (!it.bullet) continue;
    const ind = it.line.left - bases[it.line.col];
    if (!bulletIndents.some((b) => Math.abs(b - ind) <= 6)) bulletIndents.push(ind);
  }
  bulletIndents.sort((a, b) => a - b);
  const levelOf = (ind) => {
    let best = 0;
    bulletIndents.forEach((b, k) => {
      if (Math.abs(b - ind) < Math.abs(bulletIndents[best] - ind)) best = k;
    });
    return best;
  };

  const blocks = []; // {type:'p'|'li'|'img', text, level, left}
  let prev = null;
  for (const it of seq) {
    if (it.fig) {
      blocks.push({ type: "img", text: `![${it.alt}](fig:${it.fig})` });
      prev = null;
      continue;
    }
    const l = it.line;
    const text = lineMarkdown(l);
    const cur = blocks.at(-1);
    const flows =
      prev &&
      (sameCol(prev, l) ? l.top - prev.bottom < 12 : /^[a-z(,;]/.test(l.text.trim()));
    if (it.bullet) {
      blocks.push({ type: "li", text, level: levelOf(l.left - bases[l.col]), left: l.left, col: l.col });
    } else if (cur && cur.type === "li" && flows && (cur.col !== l.col || Math.abs(l.left - cur.left) <= 8)) {
      cur.text += " " + text;
    } else if (cur && cur.type === "p" && flows && !NEW_LINE_START.test(l.text) && !/^Answer/i.test(l.text.trim())) {
      cur.text += " " + text;
    } else {
      blocks.push({ type: "p", text });
    }
    prev = l;
  }

  let md = "";
  let last = null;
  for (const b of blocks) {
    const text = mergeBold(b.text);
    if (b.type === "li") {
      md += (last === "li" ? "\n" : "\n\n") + "  ".repeat(b.level) + "- " + escStart(text);
    } else {
      md += "\n\n" + (b.type === "p" ? escStart(text) : text);
    }
    last = b.type;
  }
  md = md.trim();
  const plain = block.lines.map((l) => l.text).join(" ");
  const ans = plain.match(/Answer\s*:?\s*\(?\s*([A-D])\s*\)/i)?.[1]?.toUpperCase() ?? null;
  return { markdown: md, answer: ans };
}

// ---------------------------------------------------------------------------
// One paper
// ---------------------------------------------------------------------------
function parsePaper(pdf) {
  const meta = paperMeta(pdf);
  const work = join(OUT_DIR, meta.key);
  const figDir = join(work, "figures");
  rmSync(figDir, { recursive: true, force: true });
  mkdirSync(figDir, { recursive: true });
  const tmp = join(work, "tmp");
  mkdirSync(tmp, { recursive: true });

  const { total, keyStart, solStart } = findSections(pdf);
  const key = parseAnswerKey(pdf, keyStart, solStart - 1);
  const embedded = embeddedImages(pdf, join(work, "embedded"));
  const textPages = loadText(embedded.xmlPath);
  const geo = measureColumns(textPages);
  console.log(`\n${meta.key}\n   ${meta.session} ${meta.year} | ${total} pages | key: ${key.size} answers`);

  const cutter = makeCutter(pdf, figDir);
  const rasters = new Map();
  const raster = (p) => pageRaster(pdf, p, rasters, tmp);

  const qLines = readLines(textPages, embedded.images, 1, keyStart - 1, geo);
  const { blocks: qBlocks, passages } = segment(qLines, { passages: true });
  const sLines = readLines(textPages, embedded.images, solStart, total, geo);
  const { blocks: sBlocks } = segment(sLines, { passages: false });
  const bases = columnBases(sLines);

  // Passages: "(91-95)" if printed, otherwise the next five questions.
  const passageMd = passages.map((p) => {
    const after = [...qBlocks.keys()].filter((k) => qBlocks.get(k).lines[0] && qLines.indexOf(qBlocks.get(k).lines[0]) > qLines.indexOf(p.lines[0])).sort((a, b) => a - b)[0];
    const from = p.from ?? after;
    const to = p.to ?? (from ? from + 4 : null);
    const body = p.lines.map((l) => lineMarkdown(l)).join(" ");
    return { from, to, text: mergeBold(body) };
  });

  const lastQ = Math.max(...key.keys(), ...qBlocks.keys());
  const out = [];
  const report = [];
  for (let n = 1; n <= lastQ; n++) {
    const block = qBlocks.get(n);
    if (!block) {
      report.push(`Q${n}: question not found — skipped`);
      continue;
    }
    const q = buildQuestion(block, cutter, raster);
    const passage = passageMd.find((p) => p.from && n >= p.from && n <= p.to);
    if (passage) q.stem = `${passage.text}\n\n---\n\n${q.stem}`;

    const sBlock = sBlocks.get(n);
    const sol = sBlock ? buildSolution(sBlock, cutter, raster, bases) : null;
    if (!sol) q.issues.push("no text solution found");
    const keyAnswer = key.get(n) ?? null;
    if (keyAnswer && sol?.answer && keyAnswer !== sol.answer)
      q.issues.push(`answer key says ${keyAnswer}, solution says ${sol.answer} (using key)`);
    const answer = keyAnswer ?? sol?.answer ?? null;
    if (!answer) q.issues.push("no answer in key or solution");
    if (q.options.length === 4 && q.options.some((o) => !o.text)) q.issues.push("an option is empty");

    if (q.issues.length) report.push(`Q${n}: ${q.issues.join("; ")}`);
    out.push({ ...q, answer, explanation: sol?.markdown ?? "" });
  }
  rmSync(tmp, { recursive: true, force: true });

  writeFileSync(
    join(OUT_DIR, `${meta.key}.json`),
    JSON.stringify(
      { source: basename(pdf), examCode: EXAM_CODE, year: meta.year, session: meta.session, citation: meta.citation, figuresDir: figDir, questions: out },
      null,
      2
    )
  );
  writeFileSync(join(OUT_DIR, `${meta.key}.report.txt`), report.join("\n") + "\n");
  const ready = out.filter((x) => x.answer && x.options.length === 4 && x.stem).length;
  const matches = out.filter((x) => x.match).length;
  const figs = readdirSync(figDir).length;
  console.log(`   ${out.length} questions (${ready} importable) | ${matches} match lists | ${figs} images | ${report.length} report lines`);
  return { total: out.length, ready };
}

// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let files = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--all")) {
    files = readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().map((f) => join(PDF_DIR, f));
  }
  if (!files.length) {
    console.error('Usage: node parse-paper.mjs "<file.pdf>" … | --all');
    process.exit(1);
  }
  let failed = 0;
  for (const f of files) {
    try {
      if (!existsSync(f)) throw new Error(`no such file: ${f}`);
      parsePaper(resolve(f));
    } catch (err) {
      failed++;
      console.error(`   FAILED ${basename(f)}: ${err.stack}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

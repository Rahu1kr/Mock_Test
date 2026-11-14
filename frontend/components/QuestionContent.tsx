"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import { API_BASE } from "@/lib/api";
import type { MatchList as MatchListData } from "@/lib/types";

/** Imported figures are stored as "figure:<id>" and served by the API. */
function urlTransform(url: string): string {
  if (url.startsWith("figure:")) return `${API_BASE}/api/figures/${url.slice("figure:".length)}`;
  return defaultUrlTransform(url);
}

/**
 * Renders question / option / explanation text. Content is Markdown: tables
 * (GFM), LaTeX math ($…$ and $$…$$), figures, and single line breaks kept as
 * printed — older plain-text questions render unchanged.
 */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`rich-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) => {
            // Tables and formulas are cut from the PDF page at 200 dpi: show them
            // at about the size of the surrounding text rather than stretched.
            const crop = alt === "Table" || alt === "Formula";
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={typeof src === "string" ? src : undefined}
                alt={alt ?? "Figure"}
                loading="lazy"
                className={crop ? "pdf-crop" : undefined}
                onLoad={
                  crop
                    ? (e) => {
                        const img = e.currentTarget;
                        img.style.width = `${Math.round(img.naturalWidth * 0.6)}px`;
                      }
                    : undefined
                }
              />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** "a" → "(a)", "A" → "A.", "(iv)" stays — matches how NTA papers print labels. */
function formatLabel(label: string): string {
  const bare = label.trim().replace(/^\(|\)$|\.$/g, "");
  if (!bare) return "";
  return /^[a-z]+$/.test(bare) ? `(${bare})` : `${bare}.`;
}

/** "Match List I with List II": both lists side by side, row by row, as on the paper. */
export function MatchListTable({ match }: { match: MatchListData }) {
  const rows = Math.max(match.left.length, match.right.length);
  return (
    <div className="my-3 overflow-x-auto">
      <table className="match-list w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-1/2">{match.leftTitle || "List I"}</th>
            <th className="w-1/2">{match.rightTitle || "List II"}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const l = match.left[i];
            const r = match.right[i];
            return (
              <tr key={i}>
                <td>
                  {l && (
                    <div className="flex gap-2">
                      <span className="shrink-0 font-semibold">{formatLabel(l.label)}</span>
                      <RichText text={l.text} className="min-w-0 flex-1" />
                    </div>
                  )}
                </td>
                <td>
                  {r && (
                    <div className="flex gap-2">
                      <span className="shrink-0 font-semibold">{formatLabel(r.label)}</span>
                      <RichText text={r.text} className="min-w-0 flex-1" />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface QuestionLike {
  questionText: string;
  matchList?: MatchListData | null;
  stemAfter?: string;
}

/** Question stem, then the match lists (if any), then the line printed after them. */
export function QuestionBody({ question, className = "" }: { question: QuestionLike; className?: string }) {
  const hasLists = !!question.matchList && question.matchList.left.length > 0;
  return (
    <div className={className}>
      <RichText text={question.questionText} className="font-medium" />
      {hasLists && <MatchListTable match={question.matchList!} />}
      {question.stemAfter && <RichText text={question.stemAfter} className="font-medium" />}
    </div>
  );
}

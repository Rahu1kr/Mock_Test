"use client";

import Link from "next/link";
import type { Exam } from "@/lib/types";

// State sections use a two-letter badge taken from their code prefix
// (KL_SET2 -> KL); UGC NET and catch-all sections use a glyph instead.
function iconFor(exam: Exam): { badge: string; isGlyph: boolean } {
  if (exam.code === "OTHER") return { badge: "📚", isGlyph: true };
  if (!exam.code.includes("_")) return { badge: "🌐", isGlyph: true };
  return { badge: exam.code.split("_")[0], isGlyph: false };
}

export function SectionTile({ exam }: { exam: Exam }) {
  const { badge, isGlyph } = iconFor(exam);

  return (
    <Link href={`/exams/${exam._id}`} className="block">
      <div className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-4 text-center transition active:scale-[0.97] hover:border-brand">
        <span
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${
            isGlyph ? "text-2xl" : "bg-brand/10 text-sm font-bold tracking-wide text-brand"
          }`}
          aria-hidden="true"
        >
          {badge}
        </span>
        <span className="text-xs font-medium leading-tight sm:text-sm">{exam.name}</span>
      </div>
    </Link>
  );
}

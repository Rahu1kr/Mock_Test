"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function remainingMs(startedAt: string | Date, durationMinutes: number): number {
  const start = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  return start + durationMinutes * 60_000 - Date.now();
}

export function formatRemaining(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Derives remaining time from the absolute start timestamp on every tick rather
 * than decrementing a counter. iOS Safari throttles or suspends timers in
 * backgrounded tabs, so a naive countdown drifts or freezes; recomputing from
 * `startedAt` stays correct no matter how long the tab was asleep. Expiry is
 * also re-checked on visibility/focus so returning to a stale tab fires
 * `onExpire` immediately instead of waiting for the next interval.
 */
export function useCountdown(
  startedAt: string | null,
  durationMinutes: number | null,
  onExpire: () => void,
  active: boolean
) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const evaluate = useCallback(() => {
    if (!startedAt || durationMinutes == null) return;
    const ms = remainingMs(startedAt, durationMinutes);
    setRemaining(ms);
    if (ms <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpireRef.current();
    }
  }, [startedAt, durationMinutes]);

  useEffect(() => {
    if (!active || !startedAt || durationMinutes == null) return;
    firedRef.current = false;
    evaluate();

    const interval = window.setInterval(evaluate, 1000);
    const onWake = () => {
      if (document.visibilityState === "visible") evaluate();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", evaluate);
    window.addEventListener("pageshow", evaluate);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", evaluate);
      window.removeEventListener("pageshow", evaluate);
    };
  }, [active, startedAt, durationMinutes, evaluate]);

  return remaining;
}

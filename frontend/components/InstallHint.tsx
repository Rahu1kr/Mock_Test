"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "geo-pyq-install-hint-dismissed";

// iOS never fires `beforeinstallprompt`, so the only way to get the app onto the
// Home Screen is to walk the user through the Share sheet manually.
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(DISMISS_KEY)) return;

    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isStandalone =
      nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;

    const isIos = /iphone|ipad|ipod/i.test(nav.userAgent);
    // iPadOS 13+ reports itself as a Mac; the touch-point check separates them.
    const isIpadOs = nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
    if (!isIos && !isIpadOs) return;

    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-border bg-surface p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none">📲</div>
        <div className="flex-1 text-sm">
          <p className="font-semibold">Install Geo PYQ</p>
          <p className="mt-1 text-muted">
            Tap the Share button in Safari, then choose{" "}
            <span className="font-medium text-foreground">Add to Home Screen</span> to use this like
            a normal app.
          </p>
        </div>
        <button
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setShow(false);
          }}
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:bg-background"
          aria-label="Dismiss install hint"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

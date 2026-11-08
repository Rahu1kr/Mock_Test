"use client";

import { useEffect, useState } from "react";

export function ServiceWorkerRegistrar() {
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        // iOS Safari is slow to adopt new SW versions, so surface the update
        // explicitly rather than assuming a silent swap.
        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          incoming?.addEventListener("statechange", () => {
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(incoming);
            }
          });
        });
      })
      .catch(() => {});

    return () => {
      registration = undefined;
    };
  }, []);

  if (!updateReady) return null;

  return (
    <button
      onClick={() => {
        updateReady.postMessage("SKIP_WAITING");
        window.location.reload();
      }}
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-contrast shadow-lg"
    >
      Update available — tap to reload
    </button>
  );
}

"use client";

import { api } from "./api";

const DB_NAME = "geo-pyq";
const STORE = "pending-answers";

interface PendingAnswer {
  key: string; // `${attemptId}:${questionId}` — one pending write per question
  attemptId: string;
  questionId: string;
  selectedOption: "A" | "B" | "C" | "D" | null;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function enqueue(entry: PendingAnswer) {
  await withStore("readwrite", (s) => s.put(entry));
}

async function dequeue(key: string) {
  await withStore("readwrite", (s) => s.delete(key));
}

async function allPending(): Promise<PendingAnswer[]> {
  return withStore<PendingAnswer[]>("readonly", (s) => s.getAll() as IDBRequest<PendingAnswer[]>);
}

/**
 * Writes the answer to IndexedDB first so a tab kill or dropped connection
 * can't lose it, then syncs to the API. A failed sync leaves the entry queued
 * for `flushQueue` to retry; a successful one clears it.
 */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  selectedOption: "A" | "B" | "C" | "D" | null
): Promise<{ synced: boolean }> {
  const key = `${attemptId}:${questionId}`;
  const entry: PendingAnswer = {
    key,
    attemptId,
    questionId,
    selectedOption,
    queuedAt: Date.now(),
  };
  try {
    await enqueue(entry);
  } catch {
    // IndexedDB unavailable (e.g. private browsing) — fall through to network.
  }

  try {
    await api(`/attempts/${attemptId}/answer`, {
      method: "PATCH",
      body: { questionId, selectedOption },
    });
    await dequeue(key).catch(() => {});
    return { synced: true };
  } catch {
    return { synced: false };
  }
}

export async function flushQueue(attemptId?: string): Promise<number> {
  let pending: PendingAnswer[];
  try {
    pending = await allPending();
  } catch {
    return 0;
  }
  const scoped = attemptId ? pending.filter((p) => p.attemptId === attemptId) : pending;

  let flushed = 0;
  for (const entry of scoped) {
    try {
      await api(`/attempts/${entry.attemptId}/answer`, {
        method: "PATCH",
        body: { questionId: entry.questionId, selectedOption: entry.selectedOption },
      });
      await dequeue(entry.key);
      flushed += 1;
    } catch {
      // Leave it queued; a later flush or reconnect will retry.
    }
  }
  return flushed;
}

export async function pendingCount(attemptId: string): Promise<number> {
  try {
    const all = await allPending();
    return all.filter((p) => p.attemptId === attemptId).length;
  } catch {
    return 0;
  }
}

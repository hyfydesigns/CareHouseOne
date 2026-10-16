/**
 * Browser-only queue for vital signs and progress notes entered while the tablet is offline.
 *
 * Entries are encrypted with AES-GCM before they touch IndexedDB. The key is generated in the
 * browser as non-extractable, so its bytes can't be read out or copied off the tablet; only this
 * site, in this browser profile, can use it. Who made an entry and what kind it is stay readable
 * so the right person's entries are sent; everything about the resident is inside the ciphertext.
 */

export type QueueKind = "vitals" | "note";

export interface QueuedEntry {
  clientId: string;
  userId: string;
  kind: QueueKind;
  createdAt: string;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
  /** Set when the server refused the entry; it stays until someone reads the reason and discards it. */
  error?: string;
}

export interface QueueSummary {
  mine: number;
  others: number;
  problems: Array<{ clientId: string; kind: QueueKind; createdAt: string; error: string }>;
}

const DB_NAME = "ch1-offline";
const QUEUE = "queue";
const KEYS = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(QUEUE, { keyPath: "clientId" });
      req.result.createObjectStore(KEYS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

async function key(): Promise<CryptoKey> {
  const existing = await run<CryptoKey | undefined>(KEYS, "readonly", (s) => s.get("entries"));
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await run(KEYS, "readwrite", (s) => s.put(k, "entries"));
  return k;
}

export async function enqueue(userId: string, kind: QueueKind, payload: Record<string, string>): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(payload)));
  const entry: QueuedEntry = { clientId: crypto.randomUUID(), userId, kind, createdAt: new Date().toISOString(), iv, data };
  await run(QUEUE, "readwrite", (s) => s.put(entry));
  window.dispatchEvent(new Event("ch1-queue"));
}

async function all(): Promise<QueuedEntry[]> {
  return run<QueuedEntry[]>(QUEUE, "readonly", (s) => s.getAll());
}

export async function summary(userId: string): Promise<QueueSummary> {
  const rows = await all();
  return {
    mine: rows.filter((r) => r.userId === userId && !r.error).length,
    others: rows.filter((r) => r.userId !== userId).length,
    problems: rows.filter((r) => r.userId === userId && r.error).map((r) => ({ clientId: r.clientId, kind: r.kind, createdAt: r.createdAt, error: r.error! })),
  };
}

export async function discard(clientId: string): Promise<void> {
  await run(QUEUE, "readwrite", (s) => s.delete(clientId));
  window.dispatchEvent(new Event("ch1-queue"));
}

type Outcome = { clientId: string; status: "saved" | "duplicate" | "rejected"; error?: string };

/** Sends the signed-in person's entries. Returns how many were saved, or null if the server couldn't be reached. */
export async function flush(userId: string): Promise<number | null> {
  const rows = (await all()).filter((r) => r.userId === userId && !r.error);
  if (!rows.length) return 0;
  const k = await key();
  const items = await Promise.all(
    rows.map(async (r) => ({
      clientId: r.clientId,
      kind: r.kind,
      userId: r.userId,
      createdAt: r.createdAt,
      payload: JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv }, k, r.data))),
    })),
  );
  let res: Response;
  try {
    res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const { results } = (await res.json()) as { results: Outcome[] };
  let saved = 0;
  for (const o of results) {
    const row = rows.find((r) => r.clientId === o.clientId);
    if (!row) continue;
    if (o.status === "rejected") await run(QUEUE, "readwrite", (s) => s.put({ ...row, error: o.error ?? "Couldn't be saved." }));
    else {
      await run(QUEUE, "readwrite", (s) => s.delete(o.clientId));
      if (o.status === "saved") saved++;
    }
  }
  window.dispatchEvent(new Event("ch1-queue"));
  return saved;
}

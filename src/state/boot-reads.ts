// The reads the app needs before it can draw a chat start as the page loads (src/main.tsx), so they cross a slow link
// to the server while the app's code is still arriving. Each is taken once; one nobody takes soon is dropped.
import { readLastConversation } from "@/lib/last-conversation";

export const MESSAGE_PAGE_SIZE = 200;
export const SESSION_PATH = "/api/auth/session";
const KEPT_MS = 15_000;

export function chatSnapshotPath(selected: string): string {
  return `/api/bots?messages=${MESSAGE_PAGE_SIZE}&selected=${encodeURIComponent(selected)}`;
}

const reads = new Map<string, { at: number; response: Promise<Response> }>();

function startRead(path: string, init: RequestInit, fetchImpl: typeof fetch, now: number): void {
  const response = fetchImpl(path, init);
  response.catch(() => {});
  reads.set(path, { at: now, response });
}

/** The session and the open chat's snapshot, as src/lib/session.ts and the store would ask for them. */
export function startBootReads(fetchImpl: typeof fetch = fetch, now = Date.now()): void {
  startRead(SESSION_PATH, { credentials: "same-origin" }, fetchImpl, now);
  startRead(chatSnapshotPath(readLastConversation() ?? ""), { headers: { "content-type": "application/json" } }, fetchImpl, now);
}

export function takeBootRead(path: string, now = Date.now()): Promise<Response> | undefined {
  const read = reads.get(path);
  reads.delete(path);
  return read && now - read.at <= KEPT_MS ? read.response : undefined;
}

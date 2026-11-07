// The server sends stored pictures with `cache-control: no-store` (visibility is decided per request), so the browser
// fetches one again every time a chat that shows it opens. This page keeps the ones it has shown, as decoded in-memory
// copies, for as long as it stays open: a chat opened again draws its pictures in the first frame.
const MAX_ENTRIES = 300;
const MAX_BYTES = 96 * 1024 * 1024;

interface Entry { url: string; bytes: number; image: HTMLImageElement }
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<string | null>>();
let used = 0;

/** Pictures this app serves itself, never a link to somewhere else. */
export const cacheableImage = (src: string) => src.startsWith("/api/attachments/") || /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\//.test(src);

export function cachedImageUrl(src: string): string | undefined {
  const entry = entries.get(src);
  if (!entry) return undefined;
  entries.delete(src);
  entries.set(src, entry);
  return entry.url;
}

function evict() {
  while (entries.size > MAX_ENTRIES || used > MAX_BYTES) {
    const [src, entry] = entries.entries().next().value!;
    entries.delete(src);
    used -= entry.bytes;
    URL.revokeObjectURL(entry.url);
  }
}

/** Fetches a picture once and keeps it decoded; null when it could not be fetched as a picture. */
export function loadCachedImage(src: string): Promise<string | null> {
  const known = cachedImageUrl(src);
  if (known) return Promise.resolve(known);
  let request = pending.get(src);
  if (request) return request;
  request = fetch(src, { credentials: "same-origin" })
    .then(async (response) => {
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("image/")) return null;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      await image.decode().catch(() => undefined);
      if (!image.naturalWidth) { URL.revokeObjectURL(url); return null; }
      entries.set(src, { url, bytes: blob.size, image });
      used += blob.size;
      evict();
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(src));
  pending.set(src, request);
  return request;
}

/** Keeps a picture that just loaded from the network for the next time it is drawn, fetched again when the page is
 * idle (the first load could not be kept: an image element's bytes are not readable). */
export function keepLoadedImage(src: string) {
  if (!cacheableImage(src) || entries.has(src) || pending.has(src) || typeof URL.createObjectURL !== "function") return;
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(() => void loadCachedImage(src), { timeout: 4_000 });
  else setTimeout(() => void loadCachedImage(src), 1_000);
}

import type { LinkPreview } from "../../shared/link-preview";

/** Null means the server had nothing to show (or could not be asked): the card falls back to the address. */
export type LoadedPreview = LinkPreview | null;

const KEEP = 300;
const loaded = new Map<string, LoadedPreview>();
const pending = new Map<string, Promise<LoadedPreview>>();

function keep(href: string, value: LoadedPreview) {
  loaded.delete(href);
  loaded.set(href, value);
  if (loaded.size > KEEP) loaded.delete(loaded.keys().next().value!);
}

/** Resolves once the picture has loaded or failed, so a card never grows after it appears. */
export function preloadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
}

/** undefined: not asked yet or still loading. */
export function cachedLinkPreview(href: string): LoadedPreview | undefined {
  return loaded.get(href);
}

export function loadLinkPreview(href: string): Promise<LoadedPreview> {
  const known = loaded.get(href);
  if (known !== undefined) return Promise.resolve(known);
  let running = pending.get(href);
  if (!running) {
    running = (async () => {
      let preview: LoadedPreview = null;
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(href)}`);
        if (response.ok) preview = ((await response.json()) as { preview?: LinkPreview }).preview ?? null;
      } catch {
        preview = null;
      }
      if (preview?.image && !(await preloadImage(preview.image.src))) preview = { ...preview, image: null };
      const useful = preview && (preview.title || preview.description || preview.image) ? preview : null;
      keep(href, useful);
      return useful;
    })().finally(() => pending.delete(href));
    pending.set(href, running);
  }
  return running;
}

export function forgetLinkPreviews(): void {
  loaded.clear();
  pending.clear();
}

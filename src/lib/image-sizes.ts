export interface ImageSize { width: number; height: number }

const sizes = new Map<string, ImageSize | null>();
const learned = new WeakSet<object>();

/** The pixel size of a picture by its URL: a size, null when it failed to load, undefined when not known yet. */
export function knownImageSize(src: string): ImageSize | null | undefined {
  return sizes.get(src);
}

export function rememberImageSize(src: string, size: ImageSize | null) {
  if (sizes.has(src)) return;
  sizes.set(src, size);
}

/** Takes the sizes the server sent with these messages, by the stored-picture URL a transcript draws them from. Safe to
 * call while rendering: it only fills in what no one has drawn yet, so it never asks anything to draw again. */
export function learnMessageImageSizes(messages: readonly { imageSizes?: Record<string, ImageSize> }[]) {
  for (const message of messages) {
    if (!message.imageSizes || learned.has(message)) continue;
    learned.add(message);
    for (const [name, size] of Object.entries(message.imageSizes)) {
      const src = `/api/attachments/${encodeURIComponent(name)}`;
      if (!sizes.has(src) && size.width > 0 && size.height > 0) sizes.set(src, { width: size.width, height: size.height });
    }
  }
}

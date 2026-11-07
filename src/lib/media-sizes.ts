import type { MediaSize } from "../../shared/wire.ts";

export type { MediaSize };

/** Sizes of stored pictures by stored file name, from messages' `media` and upload replies. */
const sizesByName = new Map<string, MediaSize>();
/** Sizes learned from a loaded image, by the URL it loaded from (pictures that are not stored attachments). */
const sizesBySrc = new Map<string, MediaSize>();

export const validSize = (size: MediaSize | null | undefined): size is MediaSize =>
  Boolean(size && Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0);

const nameOf = (pathOrSrc: string) => {
  const last = pathOrSrc.split(/[?#]/, 1)[0]!.split(/[\\/]/).pop() ?? "";
  try { return decodeURIComponent(last); } catch { return last; }
};

export function noteMediaSizes(media: Readonly<Record<string, MediaSize>> | undefined): void {
  if (!media) return;
  for (const [name, size] of Object.entries(media)) if (validSize(size) && !sizesByName.has(name)) sizesByName.set(name, size);
}

/** What a picture's box should be, known before any byte loads: by stored name first, then by a URL seen before. */
export function knownImageSize(pathOrSrc: string, media?: Readonly<Record<string, MediaSize>>): MediaSize | undefined {
  const name = nameOf(pathOrSrc);
  const fromMessage = media?.[name];
  if (validSize(fromMessage)) return fromMessage;
  return sizesByName.get(name) ?? sizesBySrc.get(pathOrSrc);
}

export function rememberImageSize(src: string, size: { width: number; height: number } | null): void {
  if (!size || sizesBySrc.has(src)) return;
  const next = { w: size.width, h: size.height };
  if (validSize(next)) sizesBySrc.set(src, next);
}

/** The box a picture gets before it loads: its own shape when known, otherwise a fixed default it never leaves. */
export function reservedAspect(size: MediaSize | undefined, fallback = 4 / 3, clamp: [number, number] = [0.6, 2.4]): { ratio: number; known: boolean } {
  if (!validSize(size)) return { ratio: fallback, known: false };
  return { ratio: Math.min(Math.max(size.w / size.h, clamp[0]), clamp[1]), known: true };
}

export function __resetMediaSizesForTests(): void {
  sizesByName.clear();
  sizesBySrc.clear();
}

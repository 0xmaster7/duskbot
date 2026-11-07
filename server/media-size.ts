import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MediaSize, WireMessage } from "../shared/wire.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";

const HEAD_BYTES = 256 * 1024;
const IMAGE_NAME = /^[A-Za-z0-9-]+\.(?:png|jpg|gif|webp)$/;

/** Pixel size as a browser lays the image out: a JPEG's EXIF orientation 5-8 swaps width and height. */
export function imageDimensions(bytes: Uint8Array): MediaSize | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("latin1", 12, 16) === "IHDR") {
    return sized(b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (b.length >= 10 && b.toString("latin1", 0, 4) === "GIF8") return sized(b.readUInt16LE(6), b.readUInt16LE(8));
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return webpSize(b);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  return null;
}

function sized(w: number, h: number): MediaSize | null {
  return Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0 && w <= 65_535 * 4 && h <= 65_535 * 4 ? { w, h } : null;
}

function webpSize(b: Buffer): MediaSize | null {
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8X") return sized(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
  if (chunk === "VP8L" && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return sized(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
  }
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return sized(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

function jpegSize(b: Buffer): MediaSize | null {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) { offset += 1; continue; }
    const marker = b[offset + 1]!;
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = b.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && b.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      orientation = exifOrientation(b, offset + 10, Math.min(b.length, offset + 2 + length)) ?? orientation;
    }
    // every SOFn except DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > b.length) return null;
      const h = b.readUInt16BE(offset + 5);
      const w = b.readUInt16BE(offset + 7);
      return orientation >= 5 && orientation <= 8 ? sized(h, w) : sized(w, h);
    }
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(b: Buffer, start: number, end: number): number | null {
  if (start + 8 > end) return null;
  const little = b.toString("latin1", start, start + 2) === "II";
  const u16 = (at: number) => (little ? b.readUInt16LE(at) : b.readUInt16BE(at));
  const u32 = (at: number) => (little ? b.readUInt32LE(at) : b.readUInt32BE(at));
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function readHead(path: string, bytes: number): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Stored names never change bytes, so a measurement holds until the file goes. */
const measured = new Map<string, MediaSize | null>();
/** A missing file (cleared, or still on its way from another computer) is looked for again after a minute. */
const absentUntil = new Map<string, number>();
const ABSENT_RECHECK_MS = 60_000;

export function attachmentImageSize(name: string, dir = ATTACHMENTS_DIR): MediaSize | null {
  if (!IMAGE_NAME.test(name)) return null;
  const key = `${dir}\0${name}`;
  if (measured.has(key)) return measured.get(key)!;
  if ((absentUntil.get(key) ?? 0) > Date.now()) return null;
  const path = join(dir, name);
  let size: MediaSize | null = null;
  const head = readHead(path, HEAD_BYTES);
  if (head) {
    size = imageDimensions(head);
    // a JPEG with a large EXIF or ICC block can put its frame header past the first read
    if (!size && head.length === HEAD_BYTES) {
      try {
        const whole = readHead(path, statSync(path).size);
        size = whole ? imageDimensions(whole) : null;
      } catch {
        size = null;
      }
    }
  }
  if (head) measured.set(key, size);
  else absentUntil.set(key, Date.now() + ABSENT_RECHECK_MS);
  return size;
}

const NAME_IN_TEXT = /(?:<attached-image[\t ]+path="[^"\r\n]*?|\/api\/attachments\/)([A-Za-z0-9-]+\.(?:png|jpg|gif|webp))\b/g;

/** Every stored picture a message shows: its own image attachments, the person's attached-image lines and any
 * /api/attachments/ link in its text. */
export function messageImageNames(message: Pick<WireMessage, "text" | "attachments">): string[] {
  const names = new Set<string>();
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind !== "image") continue;
    const name = attachment.path.split(/[\\/]/).pop() ?? "";
    if (IMAGE_NAME.test(name)) names.add(name);
  }
  if (message.text && (message.text.includes("attached-image") || message.text.includes("/api/attachments/"))) {
    for (const match of message.text.matchAll(NAME_IN_TEXT)) names.add(match[1]!);
  }
  return [...names];
}

/** Key of a screen row's own picture (kind "screen", sent as `png`) in its `media`. */
export const SCREEN_MEDIA_KEY = "screen";

type Measurable = Pick<WireMessage, "kind" | "text" | "attachments" | "media" | "png">;

/** The `media` a message should carry, or null when it already has every size it can get. */
export function missingMediaSizes(message: Measurable, dir = ATTACHMENTS_DIR): Record<string, MediaSize> | null {
  const have = message.media ?? {};
  const next: Record<string, MediaSize> = { ...have };
  let changed = false;
  if (message.kind === "screen" && message.png && !have[SCREEN_MEDIA_KEY]) {
    // 64k base64 characters decode to 48 KiB, past any frame header a screen capture writes
    const size = imageDimensions(Buffer.from(message.png.slice(0, 65_536), "base64"));
    if (size) { next[SCREEN_MEDIA_KEY] = size; changed = true; }
  }
  for (const name of messageImageNames(message)) {
    if (next[name]) continue;
    const size = attachmentImageSize(name, dir);
    if (size) { next[name] = size; changed = true; }
  }
  return changed ? next : null;
}

/** A message with the sizes of its pictures filled in; the same object when nothing was missing. */
export function withMediaSizes<T extends Measurable>(message: T, dir = ATTACHMENTS_DIR): T {
  const media = missingMediaSizes(message, dir);
  return media ? { ...message, media } : message;
}

import { closeSync, openSync, readSync } from "node:fs";
import { basename, join } from "node:path";

export interface ImageSize { width: number; height: number }

const HEAD_BYTES = 256 * 1024;
const SIZE_MEMO_MAX = 10_000;

/** A PNG, GIF, JPEG or WebP's pixel size from its first bytes, or null when the header is not one of those. */
export function imageSizeOf(head: Buffer): ImageSize | null {
  const valid = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : null;
  if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47 && head.toString("ascii", 12, 16) === "IHDR") {
    return valid(head.readUInt32BE(16), head.readUInt32BE(20));
  }
  if (head.length >= 10 && head.toString("ascii", 0, 3) === "GIF") return valid(head.readUInt16LE(6), head.readUInt16LE(8));
  if (head.length >= 30 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    const format = head.toString("ascii", 12, 16);
    if (format === "VP8 ") return valid(head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff);
    if (format === "VP8L") {
      const bits = head.readUInt32LE(21);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (format === "VP8X") return valid(1 + head.readUIntLE(24, 3), 1 + head.readUIntLE(27, 3));
    return null;
  }
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) {
    let at = 2;
    while (at + 9 < head.length) {
      if (head[at] !== 0xff) { at += 1; continue; }
      const marker = head[at + 1]!;
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return valid(head.readUInt16BE(at + 7), head.readUInt16BE(at + 5));
      }
      at += 2 + head.readUInt16BE(at + 2);
    }
  }
  return null;
}

const STORED_IMAGE = /^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/;
const ATTACHED_IMAGE_TAG = /<attached-image[\t ]+path="([^"\r\n]*)"/g;

/** Stored pictures' sizes by file name. Stored names never change content, so each is read once. */
export function storedImageSizes(dir: string) {
  const memo = new Map<string, ImageSize | null>();
  const read = (name: string): ImageSize | null => {
    if (memo.has(name)) return memo.get(name)!;
    let size: ImageSize | null = null;
    let fd: number | null = null;
    try {
      fd = openSync(join(dir, name), "r");
      const head = Buffer.alloc(HEAD_BYTES);
      size = imageSizeOf(head.subarray(0, readSync(fd, head, 0, HEAD_BYTES, 0)));
    } catch {
      size = null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
    if (memo.size >= SIZE_MEMO_MAX) memo.delete(memo.keys().next().value!);
    memo.set(name, size);
    return size;
  };
  return (message: { text?: string; attachments?: ReadonlyArray<{ kind: string; path: string }> }): Record<string, ImageSize> | undefined => {
    const names = new Set<string>();
    for (const attachment of message.attachments ?? []) if (attachment.kind === "image") names.add(basename(attachment.path));
    if (message.text?.includes("<attached-image")) {
      for (const match of message.text.matchAll(ATTACHED_IMAGE_TAG)) names.add(basename(match[1]!.replace(/&quot;/g, '"')));
    }
    let sizes: Record<string, ImageSize> | undefined;
    for (const name of names) {
      if (!STORED_IMAGE.test(name)) continue;
      const size = read(name);
      if (size) (sizes ??= {})[name] = size;
    }
    return sizes;
  };
}

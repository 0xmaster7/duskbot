// SECURITY: a preview image reaches the app only as bytes whose own header says PNG, JPEG, GIF or WebP, of a size a
// browser can decode without trouble; the type it is served with comes from those bytes, never from the site.
import { rasterInfo } from "../site-icons.ts";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 8192, MAX_PIXELS = 16e6;

export interface SniffedImage { type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; width: number; height: number }

function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function sniffImage(bytes: Buffer): SniffedImage | null {
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  const webp = webpSize(bytes);
  if (webp) {
    const { width, height } = webp;
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return null;
    return { type: "image/webp", width, height };
  }
  const raster = rasterInfo(bytes);
  return raster ? { type: raster.mime, width: raster.width, height: raster.height } : null;
}

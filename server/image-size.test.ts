import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, expect, it } from "vitest";
import { imageSizeOf, storedImageSizes } from "./image-size.ts";

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), header, deflateSync(Buffer.alloc(1))]);
}
const dir = mkdtempSync(join(tmpdir(), "omb-image-size-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("reads PNG, GIF, JPEG and WebP sizes from their headers", () => {
  expect(imageSizeOf(png(1200, 800))).toEqual({ width: 1200, height: 800 });
  const gif = Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1");
  expect(imageSizeOf(gif)).toEqual({ width: 320, height: 240 });
  // SOI, an APP0 segment, then SOF0 with height 480 and width 640
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
  expect(imageSizeOf(jpeg)).toEqual({ width: 640, height: 480 });
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii"); webp.write("WEBP", 8, "ascii"); webp.write("VP8X", 12, "ascii");
  webp.writeUIntLE(999, 24, 3); webp.writeUIntLE(499, 27, 3);
  expect(imageSizeOf(webp)).toEqual({ width: 1000, height: 500 });
  expect(imageSizeOf(Buffer.from("not a picture at all, just words"))).toBeNull();
});

it("sizes a message's stored pictures by file name, from attachments and attached-image tags alike", () => {
  writeFileSync(join(dir, "a1b2-c3.png"), png(640, 960));
  writeFileSync(join(dir, "d4e5.png"), png(300, 200));
  const sizes = storedImageSizes(dir);
  expect(sizes({ attachments: [{ kind: "image", path: join("/elsewhere", "a1b2-c3.png") }, { kind: "file", path: "d4e5.png" }] }))
    .toEqual({ "a1b2-c3.png": { width: 640, height: 960 } });
  expect(sizes({ text: `look\n<attached-image path="/x/d4e5.png" name="d.png" />` })).toEqual({ "d4e5.png": { width: 300, height: 200 } });
  expect(sizes({ text: `<attached-image path="../../etc/passwd" />`, attachments: [{ kind: "image", path: "missing.png" }] })).toBeUndefined();
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.stubGlobal("window", {});
const { learnMessageImageSizes, knownImageSize } = await import("@/lib/image-sizes");
const { ImageRow } = await import("./ImageRow");
const { AttachmentThumbnail } = await import("./AttachmentPreview");

const picture = (name: string) => ({ src: `/api/attachments/${name}`, name });

it("holds a picture's box from the size sent with its message, before it loads", () => {
  learnMessageImageSizes([{ imageSizes: { "wide-1.png": { width: 1200, height: 800 } } }]);
  expect(knownImageSize("/api/attachments/wide-1.png")).toEqual({ width: 1200, height: 800 });
  const row = renderToStaticMarkup(createElement(ImageRow, { images: [picture("wide-1.png")], onOpen: () => {} }));
  expect(row).toContain("width:288px;height:192px");
  const thumb = renderToStaticMarkup(createElement(AttachmentThumbnail, { image: picture("wide-1.png"), onPreview: () => {} }));
  expect(thumb).toContain("aspect-ratio:1.5");
  expect(thumb).toContain("object-cover");
});

it("fits a picture of unknown size into a fixed box instead of resizing it once it loads", () => {
  const row = renderToStaticMarkup(createElement(ImageRow, { images: [picture("unknown-2.png")], onOpen: () => {} }));
  expect(row).toContain("width:256px;height:192px");
  const thumb = renderToStaticMarkup(createElement(AttachmentThumbnail, { image: picture("unknown-2.png"), onPreview: () => {} }));
  expect(thumb).not.toContain("aspect-ratio:");
  expect(thumb).toContain("object-contain");
  expect(thumb).not.toContain("animate-spin");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { __resetImageCacheForTests, knownImageSize, noteMediaSizes, rememberRenderedSize, renderedSize } from "@/lib/image-cache";
import { AttachmentGallery } from "./AttachmentGallery";
import { markdownImageBox, MarkdownImagePreview } from "./AttachmentPreview";

const wide = "77777777-7777-4777-8777-777777777777.png";
const tall = "88888888-8888-4888-8888-888888888888.png";
const path = (name: string) => `/data/attachments/${name}`;
const tiles = (html: string) => [...html.matchAll(/data-image-tile="true" style="width:(\d+)px;height:(\d+)px"/g)].map((m) => [Number(m[1]), Number(m[2])]);

afterEach(() => __resetImageCacheForTests());

describe("pictures get their box before any byte loads", () => {
  it("plans a row from the message's stored sizes, not the 4:3 default", () => {
    const media = { [wide]: { w: 1600, h: 900 }, [tall]: { w: 600, h: 900 } };
    const html = renderToStaticMarkup(createElement(AttachmentGallery, { images: [path(wide), path(tall)], media, message: { threadId: "t", messageId: "m" } }));
    expect(tiles(html)).toEqual([[341, 192], [128, 192]]);
    expect(html).toContain("object-cover");
    expect(html).not.toContain("object-contain");
  });

  it("keeps an unknown picture in the fixed default tile and letterboxes it", () => {
    const html = renderToStaticMarkup(createElement(AttachmentGallery, { images: [path(wide)], message: { threadId: "t", messageId: "m" } }));
    expect(tiles(html)).toEqual([[256, 192]]);
    expect(html).toContain("object-contain");
  });

  it("sizes a single inline image like grok: as wide as the picture up to 560px and at most 200px tall", () => {
    expect(markdownImageBox({ w: 1536, h: 864 })).toMatchObject({ width: "min(100%, 356px)", known: true });
    expect(markdownImageBox({ w: 300, h: 150 })).toMatchObject({ width: "min(100%, 300px)", known: true });
    expect(markdownImageBox(undefined)).toMatchObject({ width: "min(100%, 560px)", maxHeight: 200, known: false });
    noteMediaSizes({ [wide]: { w: 1536, h: 864 } });
    const html = renderToStaticMarkup(createElement(MarkdownImagePreview, { src: `/api/attachments/${wide}`, name: "shot" }));
    expect(html).toContain("width:min(100%, 356px)");
    expect(html).toContain("data-markdown-image=\"size\"");
    expect(html).toContain("max-height:200px");
  });

  it("finds a stored size by file name for a just-sent picture shown from its local preview", () => {
    noteMediaSizes({ [tall]: { w: 600, h: 900 } });
    expect(knownImageSize(`/somewhere/else/${tall}`)).toEqual({ w: 600, h: 900 });
    expect(knownImageSize("/api/attachments/unknown.png")).toBeUndefined();
  });

  it("remembers a late drawing's size across launches", () => {
    rememberRenderedSize("mermaid:abc", { w: 420, h: 300 });
    expect(renderedSize("mermaid:abc")).toEqual({ w: 420, h: 300 });
  });
});

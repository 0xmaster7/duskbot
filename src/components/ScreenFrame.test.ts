import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { ScreenFrame, screenFramePreview } from "./ScreenFrame";

const shot = (patch: Partial<Message> = {}): Message =>
  ({ id: "shot 1", role: "bot", kind: "screen", hasImage: true, at: 1, ...patch }) as Message;

describe("screen frame preview", () => {
  it("loads the frame from the image route and picks a download extension from the mime type", () => {
    expect(screenFramePreview({ threadId: "t1", messageId: "shot 1" })).toMatchObject({
      src: "/api/threads/t1/messages/shot%201/image",
      name: "Bot's screen",
      downloadUrl: "/api/threads/t1/messages/shot%201/image",
      downloadName: "screen.png",
    });
    expect(screenFramePreview({ threadId: "t1", messageId: "shot" }, "image/jpeg").downloadName).toBe("screen.jpg");
  });

  it("renders the frame as one row tile whose box is reserved from its stored size", () => {
    const html = renderToStaticMarkup(createElement(ScreenFrame, { threadId: "t1", message: shot({ mime: "image/jpeg", media: { screen: { w: 1280, h: 800 } } }) }));

    expect(html).toContain("role=\"button\"");
    expect(html).toContain("aria-label=\"Open image full screen\"");
    expect(html).toContain("src=\"/api/threads/t1/messages/shot%201/image\"");
    expect(html).toContain("alt=\"Bot&#x27;s screen\"");
    expect(html).toContain("width:min(100%, 307px)");
    expect(html).toContain("aspect-ratio:1.6");
    expect(html).toContain("data-reserved=\"size\"");
    expect(html).not.toContain("role=\"dialog\"");
  });

  it("keeps an unknown frame in the default box rather than its natural size", () => {
    const html = renderToStaticMarkup(createElement(ScreenFrame, { threadId: "t1", message: shot() }));
    expect(html).toContain("width:min(100%, 256px)");
    expect(html).toContain("data-reserved=\"default\"");
    expect(html).toContain("object-contain");
  });

  it("renders nothing for a screen message with no image", () => {
    expect(renderToStaticMarkup(createElement(ScreenFrame, { threadId: "t1", message: shot({ hasImage: undefined }) }))).toBe("");
  });
});

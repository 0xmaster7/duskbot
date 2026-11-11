import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
  type MausAvatarProps,
} from "./Avatar";

// the body outline: the first path of the mark
const outline = (markup: string) => markup.match(/class="bb"><path fill="currentColor" d="([^"]+)"/)?.[1] ?? "";
const bodyOf = (markup: string) => markup.match(/data-body="([a-z]+)"/)?.[1];

const render = (props: Partial<MausAvatarProps>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props }));

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
  );

describe("MausAvatar body", () => {
  it("wears the squircle when no body is given", () => {
    expect(bodyOf(render({}))).toBe("squircle");
    expect(outline(render({}))).toBe(outline(render({ bodyId: "squircle" })));
    expect(outline(render({}))).not.toBe("");
  });

  it("wears the body it is given, drawing an older body as the one it moved to", () => {
    expect(outline(render({ bodyId: "star" }))).not.toBe(outline(render({ bodyId: "squircle" })));
    expect(bodyOf(render({ bodyId: "cursor" }))).toBe("squircle");
    expect(bodyOf(render({ bodyId: "flower" }))).toBe("cloud");
    expect(bodyOf(render({ bodyId: "teardrop" }))).toBe("drop");
    expect(outline(render({ bodyId: "fruit" }))).toBe(outline(render({ bodyId: "circle" })));
  });

  it("falls back to the squircle for an unknown body", () => {
    // SAFETY: "hexagram" is deliberately not a body id, to exercise the runtime fallback for persisted or streamed data.
    expect(bodyOf(render({ bodyId: "hexagram" as MausAvatarProps["bodyId"] }))).toBe("squircle");
  });

  it("paints the body with the bot's colour, never a flat black fill", () => {
    const markup = render({ bodyId: "circle", color: "blue" });
    expect(markup).not.toContain('fill="#000000"');
    expect(markup).toContain("color:#377FE6");
  });

  it("draws the face of the state it rests in", () => {
    expect(render({ state: "happy" })).not.toBe(render({ state: "idle" }));
    expect(render({ state: "sleeping" })).toContain('data-state="sleeping"');
  });
});

describe("mascot facial feature colors", () => {
  it.each(["white", "black"] as const)("uses %s for the eyes on every body type, and the mouth where there is one", (mascotFaceColor) => {
    const ink = mascotFaceColor === "white" ? "#ffffff" : "#000000";
    for (const mascotBody of ["cursor", "star", "pumpkin", "vampire"] as const) {
      for (const color of ["green", "chrome"] as const) {
        const markup = renderBot({ color, mascotBody, mascotFaceColor });
        expect(markup).toContain(`fill="${ink}"`);
        expect(markup).not.toContain('visibility="hidden"');
        if (mascotBody === "pumpkin" || mascotBody === "vampire") expect(markup).toContain(`stroke="${ink}"`);
      }
    }
  });

  it("draws the eyes white when no face ink is chosen", () => {
    for (const bot of [{ color: "chrome" as const, mascotFaceColor: null }, {}]) {
      const markup = renderBot(bot);
      expect(markup).toContain('<path fill="#fff" d="M-1 0');
    }
    expect(renderBot({ mascotBody: "pumpkin" })).toContain('stroke="#0d0a10"');
  });

  it("paints a body with one flat colour", () => {
    const markup = renderBot({ color: "blue" });
    expect(markup.match(/fill="currentColor"/g)?.length).toBe(1);
    expect(markup).not.toContain("Gradient");
  });

  it("does not paint features over an uploaded image", () => {
    const markup = renderBot({ mascotFaceColor: "black", avatarUrl: "/api/attachments/photo.png", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });
});

describe("BotAvatar's two avatar outcomes", () => {
  it("zooms and positions a custom image inside its crop", () => {
    const markup = renderBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 2,
      avatarFocusX: 0.25,
      avatarFocusY: 0.75,
    });
    expect(markup).toContain("scale(2)");
    expect(markup).toContain("25% 75%");
    expect(markup).toContain("border-radius:50%");
  });

  it("renders a flat cropped image for circle/rounded/square, with no mascot at all", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("shows the image as it is, with no mascot face painted on it", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "square" });
    expect(markup).toContain("border-radius:0");
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("radialGradient");
  });

  it("renders the gradient mascot when the crop is mascot, image or not", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "mascot" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<svg");
  });

  it("falls back to the gradient mascot when a flat crop has no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "circle" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<svg");
  });
});

describe("resolveBotAvatarOutcome", () => {
  // imageFailed is set by the <img>'s onError, which renderToStaticMarkup never fires, so the decision is a pure
  // function.
  it("falls back to the gradient mascot for an image that failed to load", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "circle", hasUrl: true, imageFailed: true }),
    ).toBe("gradientMascot");
  });

  it("renders a good flat image flat", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "rounded", hasUrl: true, imageFailed: false }),
    ).toBe("flatImage");
  });

  it("keeps the mascot crop on the gradient mascot even with a loaded image", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "mascot", hasUrl: true, imageFailed: false }),
    ).toBe("gradientMascot");
  });

  it("falls back to the gradient mascot when there is no image at all", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "square", hasUrl: false, imageFailed: false }),
    ).toBe("gradientMascot");
  });
});

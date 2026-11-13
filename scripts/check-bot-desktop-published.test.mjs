import { describe, expect, it } from "vitest";

import { botDesktopImage, checkBotDesktopPublished } from "./check-bot-desktop-published.mjs";

const registry = (tokenOk, status, platforms) => async (url) => {
  if (url.includes("/token?")) return new Response(tokenOk ? JSON.stringify({ token: "t" }) : "{}", { status: tokenOk ? 200 : 403 });
  return new Response(JSON.stringify({ manifests: platforms.map((architecture) => ({ platform: { os: "linux", architecture } })) }), { status });
};

describe("whether the bot computer image is published", () => {
  it("only when anyone can pull it for both architectures", async () => {
    const image = botDesktopImage();
    expect(await checkBotDesktopPublished(image, registry(true, 200, ["amd64", "arm64"]))).toBeNull();
    expect(await checkBotDesktopPublished(image, registry(true, 200, ["amd64"]))).toMatch(/without linux\/arm64/);
    expect(await checkBotDesktopPublished(image, registry(true, 404, []))).toMatch(/not published/);
    expect(await checkBotDesktopPublished(image, registry(false, 200, []))).toMatch(/make it public/);
  });

  it("refuses anything but a ghcr.io tag", async () => {
    await expect(checkBotDesktopPublished("docker.io/library/debian:12", registry(true, 200, []))).rejects.toThrow(/ghcr\.io/);
  });
});

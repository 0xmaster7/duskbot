import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], bots: [] as Bot[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: fixture.instances, bots: fixture.bots },
    dispatch: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { RoomToolChip } = await import("./GroupView");
const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");

const claude = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
  snapshot: { state: "available", authenticated: false },
  install: { command: { darwin: "npm i -g x", linux: "npm i -g x", win32: "npm i -g x" }, signInCommand: "claude /login", server: { package: "@anthropic-ai/claude-code" } },
  authentication: { method: "paste-code" },
  models: { default: "sonnet", options: [] },
} as InstanceInfo;
const NAMES = ["Echo", "Quill", "Rivet", "Nova"];
fixture.instances = [claude];
fixture.bots = NAMES.map((name) => ({ id: name.toLowerCase(), name, modelSelection: { instanceId: "claude", model: "sonnet" } }) as Bot);

const ask: Message = { id: "ask", role: "user", kind: "text", at: 1, text: "hi all" };
const failed = (name: string, cause: string, patch: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `failed-${name}`, role: "bot", kind: "activity", at: 2,
  from: { botId: name.toLowerCase(), name, color: "blue" },
  tool: { name: `error: ${cause}`, ok: false, ...patch },
});
const card = (messages: Message[], group = true) =>
  renderToStaticMarkup(createElement(FailedReplyCard, { rows: trailingRows(messages), group, threadId: "room" }));
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("failed replies in a room", () => {
  const signedOut = NAMES.map((name) => failed(name, "Not logged in · Please run /login", { setup: true }));

  it("leaves no row in the chat", () => {
    expect(renderToStaticMarkup(createElement(RoomToolChip, { message: signedOut[0]!, roomId: "room" }))).toBe("");
  });

  it("says every bot that failed in one card, the reason in plain words, with the sign-in", () => {
    const markup = card([ask, ...signedOut]);
    expect(count(markup, "data-chat-error")).toBe(1);
    expect(markup).toContain("Echo, Quill and 2 more couldn&#x27;t respond");
    expect(markup).toContain("Claude isn&#x27;t signed in on this computer");
    expect(markup).toContain("Sign in</button>");
    expect(markup).toContain('aria-label="Dismiss"');
    expect(markup).not.toContain("/login");
    expect(markup).not.toContain("Not logged in");
  });

  it("says the most actionable reason when they differ, and never the engine's raw words", () => {
    const markup = card([ask, failed("Echo", "API Error: 529 overloaded_error"), failed("Quill", "Not logged in · Please run /login", { setup: true })]);
    expect(markup).toContain("Echo and Quill couldn&#x27;t respond");
    expect(markup).toContain("Claude isn&#x27;t signed in on this computer");
    expect(markup).not.toContain("529");
  });

  it("maps a stored reason, and falls back to a short generic line", () => {
    expect(card([ask, failed("Echo", "x", { reason: "rate_limit" })])).toContain("This request has been rate limited, try again shortly");
    expect(card([ask, failed("Echo", "The operation timed out.")])).toContain("The reply timed out");
    const generic = card([ask, failed("Echo", "Your Pro plan includes 2 cloud computers at once.")]);
    expect(generic).toContain("Echo couldn&#x27;t respond");
    expect(generic).toContain("Something went wrong. Try again.");
    expect(generic).not.toContain("Pro plan");
  });

  it("goes away once a bot replies or the person writes again", () => {
    const reply: Message = { id: "r", role: "bot", kind: "text", at: 3, text: "here", from: { botId: "echo", name: "Echo", color: "blue" } };
    expect(card([ask, signedOut[0]!, reply])).toBe("");
    expect(card([ask, ...signedOut, { ...ask, id: "again", at: 4 }])).toBe("");
  });

  it("folds a sign-out notice into the same card, one card total", () => {
    const notice: Message = { id: "n", role: "bot", kind: "activity", at: 3, from: { botId: "echo", name: "Echo", color: "blue" },
      tool: { name: "notice: Claude is signed out on this computer. Sign in again in Settings → AI to keep using it.", ok: true, setup: true } };
    const rows = trailingRows([ask, signedOut[0]!, notice]);
    expect(rows.notices.map((m) => m.id)).toEqual(["n"]);
    const markup = card([ask, signedOut[0]!, notice]);
    expect(count(markup, "data-chat-error")).toBe(1);
    expect(count(markup, "Sign in</button>")).toBe(1);
    expect(markup).not.toContain("Settings → AI");
  });

  it("titles a direct chat's card the way grok does", () => {
    expect(card([ask, signedOut[0]!], false)).toContain("Bot failed to respond");
  });
});

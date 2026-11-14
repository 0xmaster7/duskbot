// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  return { dispatch: vi.fn(), bots: [] as Bot[], instances: [] as InstanceInfo[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {}, instances: fixture.instances, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
}));
vi.mock("./onboarding/ConnectAi", () => ({ ConnectAiDialog: () => createElement("div", { "data-connect-ai-dialog": "" }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.now();
const free = { instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", snapshot: { state: "available", authenticated: true, freeFallback: true } } as InstanceInfo;
const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo;
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "opencodeGo", model: "opencode/big-pickle" } } as Bot];

const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "hi" };
const noReply: Message = {
  id: "failed", role: "bot", kind: "activity", at: T0 + 2,
  tool: { name: "error: No free backup model answered just now, so this message got no reply.", ok: false, reason: "no_ai" },
};

let root: ReturnType<typeof createRoot> | null = null;
const show = async (instances: InstanceInfo[]) => {
  fixture.instances = instances;
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, noReply]), botId: "echo", threadId: "main", onRetry: vi.fn() })); });
  return document.querySelector("[data-chat-error]");
};
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a first reply with no AI connected", () => {
  it("is a card to connect one, with one button that opens the connect flow", async () => {
    const card = await show([free]);
    expect(card?.textContent).toContain("Connect your AI to start");
    expect(card?.textContent).not.toContain("failed to respond");
    const buttons = [...card!.querySelectorAll<HTMLButtonElement>("button:not([aria-label])")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Connect your AI"]);
    await act(async () => buttons[0]!.click());
    expect(document.querySelector("[data-connect-ai-dialog]")).not.toBeNull();
  });

  it("is an ordinary failure once an AI of the person's own is ready", async () => {
    const card = await show([free, claude]);
    expect(card?.textContent).not.toContain("Connect your AI to start");
    expect(card?.textContent).toContain("failed to respond");
  });
});

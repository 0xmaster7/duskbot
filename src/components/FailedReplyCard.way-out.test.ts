// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo];
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "claude", model: "sonnet" } } as Bot];

const ask: Message = { id: "ask", role: "user", kind: "text", at: 1, text: "hi" };
let seq = 0;
const failed = (cause: string, patch: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `failed-${++seq}`, role: "bot", kind: "activity", at: 2, tool: { name: `error: ${cause}`, ok: false, ...patch },
});

let root: ReturnType<typeof createRoot> | null = null;
const show = async (message: Message, onRetry?: () => void) => {
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, message]), botId: "echo", threadId: "main", onRetry })); });
  return [...document.querySelectorAll<HTMLButtonElement>("[data-chat-error] button:not([aria-label])")];
};
const labels = (buttons: HTMLButtonElement[]) => buttons.map((button) => button.textContent);

beforeEach(() => fixture.dispatch.mockClear());
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a failure card always offers a way on", () => {
  it("out of credits: Switch AI, which opens the bot's AI settings", async () => {
    const buttons = await show(failed("Your credit balance is too low: insufficient credits"), vi.fn());
    expect(labels(buttons)).toEqual(["Switch AI"]);
    await act(async () => buttons[0]!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "toggleSettings", open: true, section: "model", botId: "echo" }));
  });

  it("a usage limit with no known reset: Switch AI", async () => {
    expect(labels(await show(failed("You've hit your usage limit")))).toEqual(["Switch AI"]);
  });

  it("a usage limit with a known reset keeps its continue action", async () => {
    const buttons = labels(await show(failed("You've hit your usage limit", { limitResetsAt: Date.now() + 3_600_000 })));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBe("Switch AI");
  });

  it("a failure nothing can retry: Switch AI instead of nothing", async () => {
    expect(labels(await show(failed("API Error: 529 Overloaded")))).toEqual(["Switch AI"]);
  });

  it("a failure that can be retried keeps Try again alone", async () => {
    expect(labels(await show(failed("API Error: 529 Overloaded"), vi.fn()))).toEqual(["Try again"]);
  });
});

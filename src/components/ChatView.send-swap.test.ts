// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppState, Bot, Message } from "../state/store";

vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ ready: true, capabilities: { dictation: { available: false },
    host: { packaged: true, platform: "other" }, localComputer: { available: false } } }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("../state/store");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

it("keeps the person's bubble as the same element when the server's copy replaces the optimistic one", async () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const hello: Message = { id: "hello", kind: "text", role: "bot", text: "Hi there", at: 1 };
  const bot: Bot = { id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", color: "green",
    modelSelection: { instanceId: "fake", model: "fake" }, notifications: true, unread: false, messages: [hello], activeLeafId: hello.id };
  let state: AppState = { ...initialState, connected: true, selectedId: bot.id, bots: [bot] };
  const host = document.createElement("div");
  root = createRoot(host);
  const draw = () => root!.render(createElement(BotEditorStore, { value: { state, dispatch: vi.fn(),
    flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
    children: createElement(ChatView, { bot: state.bots[0]! }) }));
  await act(async () => draw());

  const at = Date.now();
  const optimistic: Message = { id: "optimistic-s1", kind: "text", role: "user", text: "plan my week", at, sendId: "s1", parentId: "hello" };
  state = { ...state, bots: [{ ...bot, messages: [hello, optimistic], activeLeafId: optimistic.id }] };
  await act(async () => draw());
  const sentRow = host.querySelector('[data-mid="optimistic-s1"]');
  const sentBubble = sentRow?.querySelector("[data-message-row]");
  expect(sentRow).not.toBeNull();

  const confirmed: Message = { ...optimistic, id: "server-1" };
  state = { ...state, bots: [{ ...bot, messages: [hello, confirmed], activeLeafId: confirmed.id }] };
  await act(async () => draw());
  // the same node, so it neither remounts nor plays its entrance a second time
  expect(host.querySelector('[data-mid="server-1"]')).toBe(sentRow);
  expect(sentRow?.querySelector("[data-message-row]")).toBe(sentBubble);
  expect(host.textContent?.match(/plan my week/g)).toHaveLength(1);
});

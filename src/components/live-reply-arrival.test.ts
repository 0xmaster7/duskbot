// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AppState, Bot, Group, Message } from "../state/store";

vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ ready: true, capabilities: { dictation: { available: false },
    host: { packaged: true, platform: "other" }, localComputer: { available: false } } }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { TYPING_MIN_MS } = await import("@/hooks/use-typing-hold");
const { GroupView } = await import("./GroupView");
const { BotEditorStore, initialState } = await import("../state/store");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

it.each(["bot", "group"])("renders completed live replies for a %s in order, a bot's after its typing beat", async (kind) => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const user: Message = { id: "person", kind: "text", role: "user", text: "Please reply", at: Date.now() };
  const bot: Bot = { id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", color: "green",
    modelSelection: { instanceId: "fake", model: "fake" }, notifications: true, unread: false, messages: [user], activeLeafId: user.id };
  const group: Group = { id: "room", threadId: "thread", name: "Fixture room", memberIds: [bot.id], defaultResponder: { kind: "mentions" },
    createdAt: 1, bulletin: "", unread: false, messages: [user], setupCompletedAt: 1 };
  let state: AppState = { ...initialState, connected: true, selectedId: kind === "bot" ? bot.id : group.id, bots: [bot], groups: [group] };
  const host = document.createElement("div");
  root = createRoot(host);
  const draw = () => root!.render(createElement(BotEditorStore, { value: { state, dispatch: vi.fn(),
    flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
    children: kind === "bot" ? createElement(ChatView, { bot: state.bots[0]! }) : createElement(GroupView, { group: state.groups[0]! }) }));
  await act(async () => draw());
  const replies: Message[] = ["first", "second", "third"].map((id, index, rows) => ({ id, kind: "text", role: "bot", text: `${id} completed reply`,
    at: Date.now(), parentId: index ? rows[index - 1] : user.id, ...(kind === "group" ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}) }));
  state = { ...state, bots: [{ ...bot, messages: [user, ...replies], activeLeafId: "third" }], groups: [{ ...group, messages: [user, ...replies] }] };
  await act(async () => draw());
  // a bubble still being typed is in its place but unseen: it is not shown yet
  const rows = () => [...host.querySelectorAll("[data-mid]")].filter((row) => !row.querySelector("[data-message-row][aria-hidden]")).map((row) => row.getAttribute("data-mid"));
  if (kind === "bot") {
    // a bot's chat says Typing… first, then its finished turn's bubbles land together
    expect(rows()).toEqual(["person"]);
    // each wait is its own act: an update a timer queues inside one only renders when that act ends
    for (const ms of [TYPING_MIN_MS + 20]) await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  expect(rows()).toEqual(["person", "first", "second", "third"]);
  for (const reply of replies) expect(host.textContent).toContain(reply.text);
});

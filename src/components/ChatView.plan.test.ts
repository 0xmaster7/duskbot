// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  root.unmount();
  container.remove();
  vi.unstubAllGlobals();
});

const STEPS = ["Find flights", "Compare hotels", "Check visa rules", "Price local transport", "Draft the itinerary", "Total the budget"];
const instances = [{ instanceId: "test", driverKind: "claude", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo];
const started = Date.now() - 60_000;
const ask: Message = { id: "u1", role: "user", kind: "text", text: "Plan a five-day Lisbon trip for two in May.", at: started };
/** A plan call as the server streams it: TodoWrite with its input, the call's own JSON. */
const planCall = (done: number, ok?: boolean): Message => ({
  id: `plan-${done}`, role: "bot", kind: "activity", at: started + done * 1_000, turnId: `turn-${done}`,
  tool: { name: "TodoWrite", itemId: `item-${done}`, ok, input: JSON.stringify({ todos: STEPS.map((content, i) => ({ content, status: i < done ? "completed" : i === done ? "in_progress" : "pending" })) }) },
});
const planner = (messages: Message[], busy: boolean): Bot => ({
  id: "planner", threadId: "t", name: "Planner", title: "", description: "", color: "green", notifications: true, unread: false,
  busy, messages, turnStartedAt: started, modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "t", title: "Lisbon", createdAt: 1, busy, activity: busy ? "working" : "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});
const draw = (bot: Bot) => {
  const state: AppState = { ...initialState, connected: true, selectedId: bot.id, bots: [bot], instances };
  const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot }) })));
};
const checklists = () => [...container.querySelectorAll<HTMLElement>("[data-plan-checklist]")];
const states = () => [...checklists()[0]!.querySelectorAll("[data-plan-step]")].map((step) => step.getAttribute("data-plan-step"));
const toggle = () => checklists()[0]!.querySelector<HTMLButtonElement>("[data-plan-toggle]")!;

it("shows the plan as one live checklist that moves forward with each plan call, then folds to six of six", () => {
  draw(planner([ask, planCall(0, true)], true));
  expect(checklists()).toHaveLength(1);
  expect(toggle().textContent).toBe("0 of 6 done");
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(states()).toEqual(["now", "todo", "todo", "todo", "todo", "todo"]);
  expect(checklists()[0]!.textContent).toContain("Compare hotels");

  // a later plan call in the same ask, a carried-on turn included, takes over: still one checklist
  draw(planner([ask, planCall(0, true), { id: "b1", role: "bot", kind: "text", text: "Flights found.", at: started + 1_500 }, planCall(2)], true));
  expect(checklists()).toHaveLength(1);
  expect(toggle().textContent).toBe("2 of 6 done");
  expect(states()).toEqual(["done", "done", "now", "todo", "todo", "todo"]);
  expect(checklists()[0]!.hasAttribute("data-plan-live")).toBe(true);

  const finished = [ask, planCall(0, true), planCall(6, true), { id: "b2", role: "bot", kind: "text", text: "Your Lisbon trip plan is ready.", at: started + 9_000, turnId: "turn-6", turnTerminal: true } as Message];
  draw(planner(finished, false));
  expect(checklists()).toHaveLength(1);
  expect(toggle().textContent).toBe("6 of 6 done");
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(checklists()[0]!.hasAttribute("data-plan-live")).toBe(false);
  expect(checklists()[0]!.querySelector("[data-plan-steps]")!.hasAttribute("inert")).toBe(true);

  flushSync(() => toggle().click());
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(states()).toEqual(["done", "done", "done", "done", "done", "done"]);
});

it("keeps an earlier ask's plan folded while the newest ask runs, and draws no checklist for a one-step plan", () => {
  const one: Message = { id: "solo", role: "bot", kind: "activity", at: started + 20_000, tool: { name: "TodoWrite", input: JSON.stringify({ todos: [{ content: "Book it", status: "in_progress" }] }) } };
  draw(planner([ask, planCall(6, true), { id: "u2", role: "user", kind: "text", text: "Now book it.", at: started + 19_000 }, one], true));
  expect(checklists()).toHaveLength(1);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
});

// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/testing/quiet-canceled-animations";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";
import { STATUS_QUIET_MS } from "./TurnPresence";
import { LIFE_MASCOT_MS, LIFE_MASCOT_STATE } from "@/lib/reply-life";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: null, instances: [{ instanceId: "test", driverKind: "claudeAgent", displayName: "Test" } as InstanceInfo] },
    dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
}));
vi.mock("./SidebarPopoverMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("./SidebarPopoverMenu")>(),
  SidebarPopoverMenu: (props: { renderTrigger: (state: { open: boolean }) => unknown }) => props.renderTrigger({ open: false }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (_props: ComponentProps<typeof ApprovalModeSelector>) => createElement("span") }));

const { ChatView } = await import("./ChatView");
const { noteTurnEvent, resetTurnLive } = await import("@/state/turn-status");
const { resetLandedReplies } = await import("@/hooks/use-landed-reply");

const THREAD = "selected";
const started = Date.UTC(2026, 9, 23, 12, 0, 0);
const busyBot = (messages: Message[], busy = true): Bot => ({
  id: "bot", threadId: THREAD, name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy, activity: busy ? "working" : "idle", turnStartedAt: busy ? started : undefined, messages,
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: THREAD, title: "Dashboard", createdAt: 1, busy, activity: busy ? "working" : "idle", turnStartedAt: busy ? started : undefined,
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "full" }],
});
const ask: Message = { id: "ask", role: "user", kind: "text", at: started, text: "Build me a sales dashboard" };
const intro: Message = { id: "intro", role: "bot", kind: "text", at: started + 5_000, text: "I'll build the dashboard now.", turnId: "t1" };

let seq = 0;
const engine = (event: Partial<RuntimeEvent>) => act(() => noteTurnEvent({
  eventId: `e${++seq}`, provider: "claudeAgent", threadId: THREAD, createdAt: new Date().toISOString(), turnId: "t1", ...event,
} as RuntimeEvent));

let host: HTMLDivElement;
let root: Root;
const render = (shown: Bot) => act(() => root.render(createElement(ChatView, { bot: shown })));
const mascot = () => host.querySelector(".turn-presence");
/** The line as it reads: the phrase fading out is not part of it. */
const statusLine = () => {
  const line = host.querySelector("[data-turn-status]")?.cloneNode(true) as HTMLElement | undefined;
  line?.querySelectorAll(".turn-phrase-out").forEach((node) => node.remove());
  return line?.textContent?.replace(/\s+/g, " ").trim() ?? null;
};

beforeEach(() => {
  vi.useFakeTimers({ now: started + 72_000 });
  resetTurnLive();
  resetLandedReplies();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the working line", () => {
  it("is the bot's 28px mark and one quiet friendly phrase, with the timer and size kept in its tooltip", () => {
    engine({ type: "turn.started" });
    render(busyBot([ask]));
    expect(mascot()).not.toBeNull();
    const first = statusLine();
    expect(["Working on it", "Chipping away", "Getting it done", "Making progress", "Handling it"]).toContain(first);
    expect(mascot()!.innerHTML).toMatch(/width(="|: )28px/);
    const row = mascot()!.firstElementChild as HTMLElement;
    expect([...row.classList]).toEqual(expect.arrayContaining(["h-9", "ps-2", "gap-[8.5px]"]));
    expect(row.title).toMatch(/^Working · /);
    expect(mascot()!.querySelector("[data-turn-status] .status-shimmer")).not.toBeNull();
    const slot = () => host.querySelector(".turn-status-slot")!;
    expect(slot().classList).not.toContain("-mt-3");

    engine({ type: "item.completed", itemType: "assistant_text", text: intro.text! } as Partial<RuntimeEvent>);
    render(busyBot([ask, intro]));
    expect(slot().classList, "under the bot's own bubble it sits close, as one more part of the reply").toContain("-mt-3");
    expect(mascot(), "the reply takes the line's place in the frame it lands").toBeNull();
    engine({ type: "turn.progress", activity: "write", itemId: "toolu_write", file: "index.html", bytes: 14 * 1024 + 300 } as Partial<RuntimeEvent>);
    expect(statusLine(), "the turn goes on with a named step: the line comes back saying it").toBe("Writing some code");
  });

  it("never stays under the reply that ended its wait, and comes back if the turn goes on", () => {
    const reply: Message = { id: "reply", role: "bot", kind: "text", at: started + 9_000, text: "Fair, quiet day", turnId: "t1" };
    engine({ type: "turn.started" });
    render(busyBot([ask]));
    engine({ type: "content.delta", streamKind: "assistant_text", delta: "Fair" } as Partial<RuntimeEvent>);
    expect(mascot()).not.toBeNull();
    render(busyBot([ask, reply]));
    expect(mascot(), "gone in the same frame, though the engine still says it is typing and the turn has not ended").toBeNull();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(mascot()).toBeNull();
    act(() => void vi.advanceTimersByTime(600));
    expect(mascot(), "a turn still running after its reply has more to do").not.toBeNull();
    engine({ type: "turn.completed", ok: true } as Partial<RuntimeEvent>);
    render(busyBot([ask, reply], false));
    expect(mascot()).toBeNull();
  });

  it("lives the quiet wait: the mascot, its typing dots, then the reply in the frame it lands", () => {
    vi.setSystemTime(started + 100);
    const markState = () => host.querySelector(".turn-presence [data-grok-state]")?.getAttribute("data-grok-state");
    engine({ type: "turn.started" });
    render(busyBot([ask]));
    expect(markState(), "the bot as itself first, not the dots").toBe(LIFE_MASCOT_STATE);
    act(() => void vi.advanceTimersByTime(LIFE_MASCOT_MS.max + 20));
    expect(markState(), "then it condenses into the typing dots").toBe("thinking");
    engine({ type: "content.delta", streamKind: "assistant_text", delta: "Fair" } as Partial<RuntimeEvent>);
    expect(markState(), "the reply being written holds the dots").toBe("thinking");
    render(busyBot([ask, { id: "reply", role: "bot", kind: "text", at: started + 3_000, text: "Fair", turnId: "t1" }]));
    expect(mascot(), "and the reply never waits on any of it").toBeNull();
  });

  it("skips the mascot's moment when the reply starts at once", () => {
    vi.setSystemTime(started + 100);
    const markState = () => host.querySelector(".turn-presence [data-grok-state]")?.getAttribute("data-grok-state");
    engine({ type: "turn.started" });
    render(busyBot([ask]));
    expect(markState()).toBe(LIFE_MASCOT_STATE);
    engine({ type: "content.delta", streamKind: "assistant_text", delta: "Hi" } as Partial<RuntimeEvent>);
    expect(markState()).toBe("thinking");
  });

  it("says Teammates working while the bot waits on its teammates", () => {
    const waiting = busyBot([ask, intro], false);
    render({ ...waiting, waitingForTeammates: true, tasks: waiting.tasks!.map((task) => ({ ...task, waitingForTeammates: true })) });
    act(() => void vi.advanceTimersByTime(STATUS_QUIET_MS.max));
    expect(statusLine()).toBe("Teammates working");
  });
});

describe("the mascot and its status line through a long turn", () => {
  it("hides while the bot waits on the person, and the next turn starts clean", () => {
    engine({ type: "turn.progress", activity: "edit", itemId: "toolu_edit", file: "app.ts", bytes: 2048 } as Partial<RuntimeEvent>);
    const asking = busyBot([ask, intro]);
    render({ ...asking, activity: "waiting-on-you", tasks: asking.tasks!.map((task) => ({ ...task, activity: "waiting-on-you" })) });
    expect(mascot()).toBeNull();

    engine({ type: "turn.completed", ok: true } as Partial<RuntimeEvent>);
    const next: Message = { id: "next", role: "user", kind: "text", at: started + 90_000, text: "Add a chart" };
    render(busyBot([ask, intro, next]));
    expect(mascot(), "a new prompt shows the line before the new turn's first frame").not.toBeNull();
  });
});

describe("what the bot is doing right now", () => {
  const search: Message = { id: "search", role: "bot", kind: "activity", at: started + 4_000, turnId: "t1",
    tool: { name: "WebSearch", itemId: "s1", ok: true, step: { activity: "web", target: "Acme construction leads" } } };
  const bash: Message = { id: "bash", role: "bot", kind: "activity", at: started + 6_000, turnId: "t1",
    tool: { name: "Bash", itemId: "b1", step: { activity: "command", target: "scrape.py", detail: "python3 scrape.py --pages 40" } } };
  const toggle = () => host.querySelector<HTMLButtonElement>(".turn-presence button[aria-expanded]");
  const steps = () => [...host.querySelectorAll("[data-now-step]")].map((step) => `${step.getAttribute("data-now-step")}: ${step.querySelector("[dir=auto]")?.textContent}`);

  it("is one calm line, where the card unfolds too", () => {
    engine({ type: "turn.started" });
    engine({ type: "item.started", itemType: "tool", itemId: "b1", title: "Bash" } as Partial<RuntimeEvent>);
    engine({ type: "turn.progress", activity: "command", itemId: "b1", target: "scrape.py", quiet: { kind: "idle" } } as Partial<RuntimeEvent>);
    render(busyBot([ask, search, bash]));
    expect(statusLine()).toBe("Running a few commands · idle, no output yet");
    act(() => toggle()!.click());
    expect(steps()).toEqual(["done: Searched the web for “Acme construction leads”", "now: Running scrape.py"]);
  });
});

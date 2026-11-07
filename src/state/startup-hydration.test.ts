// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StoreProvider, useStore, type AppState, type BotAnnouncement } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id = "fixture:1") { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const bot: BotAnnouncement = {
  id: "fixture", threadId: "fixture-thread", name: "Fixture", title: "", description: "",
  notifications: true, unread: false, color: "green", modelSelection: { instanceId: "fake", model: "fake" },
  messages: [], tasks: [{ threadId: "fixture-thread", title: "Fixture", createdAt: 1 }],
};
const json = (body: unknown) => new Response(JSON.stringify(body));
let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  FixtureEventSource.opened = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows live replies while startup settings and routines are still pending, and keeps newer settings", async () => {
  let finishConfig!: (response: Response) => void;
  let finishRoutines!: (response: Response) => void;
  const config = new Promise<Response>((resolve) => { finishConfig = resolve; });
  const routines = new Promise<Response>((resolve) => { finishRoutines = resolve; });
  const request = vi.fn(async (path: string) => {
    if (path === "/api/config") return config;
    if (path.startsWith("/api/routines?")) return routines;
    if (path.startsWith("/api/bots?")) return json({ bots: [bot], groups: [] });
    if (path === "/api/instances") return json({ instances: [] });
    if (path === "/api/webhooks") return json({ webhooks: [] });
    return json({});
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", request);
  let state!: AppState;
  function Probe() { state = useStore().state; return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(StoreProvider, null, createElement(Probe))));
  const stream = FixtureEventSource.opened[0]!;
  await act(async () => {
    stream.send({ kind: "hello", resumed: false, cursor: "fixture:0" });
  });
  expect(state.hydrated).toBe(true);
  await act(async () => {
    stream.send({ kind: "message", threadId: bot.threadId, message: { id: "reply", at: 1, role: "bot", kind: "text", text: "Already here" } });
    stream.send({ kind: "config", profile: { name: "New profile", email: "fixture@example.test" } });
  });
  expect(state.bots[0]!.messages.map((message) => message.text)).toEqual(["Already here"]);
  expect(state.config?.profile?.name).toBe("New profile");
  expect(FixtureEventSource.opened).toHaveLength(1);

  await act(async () => {
    finishConfig(json({ profile: { name: "Stale profile", email: "fixture@example.test" } }));
    finishRoutines(json({ routines: [], runs: [] }));
  });
  expect(state.config?.profile?.name).toBe("New profile");
  expect(state.routinesLoadState).toBe("ready");
});

it("bounds startup reads and cancels pending snapshots when the workspace page leaves", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const signals: AbortSignal[] = [];
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/live/call") return json({});
    signals.push(init!.signal!);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    });
  }));
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(StoreProvider)));
  await act(async () => { FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "fixture:0" }); });
  expect(signals).toHaveLength(6);
  expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 30_000)).toBe(true);
  await act(async () => root!.unmount());
  root = undefined;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

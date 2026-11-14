// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMPUTER_CONTROL_HEARTBEAT_MS } from "../../shared/wire";
import { useComputerTakeover, type TakeoverSnapshot } from "./computer-takeover";

let root: Root;
let seen: ReturnType<typeof useComputerTakeover>;
let finish: (snapshot: TakeoverSnapshot) => void;
const request = () => new Promise<TakeoverSnapshot>(resolve => { finish = resolve; });

function Probe({ botId, session, held }: { botId: string; session: string; held: boolean }) {
  seen = useComputerTakeover({ botId, session, held, request, viewerClose: null });
  return null;
}

const render = (botId = "first", session = botId, held = false) => act(async () => {
  root.render(createElement(Probe, { botId, session, held }));
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["bot", "conversation", "pagehide", "unmount"])("releases a late take after leaving its %s, without enabling the next viewer", async action => {
  await render();
  let taken!: Promise<void>;
  act(() => { taken = seen.take(); });
  if (action === "bot") await render("second");
  else if (action === "conversation") await render("first", "other-thread");
  else if (action === "pagehide") act(() => { window.dispatchEvent(new Event("pagehide")); });
  else act(() => root.unmount());
  await act(async () => {
    finish({ held: true, owned: true });
    await taken;
  });
  expect(seen.here).toBe(false);
  expect(fetch).toHaveBeenCalledWith("/api/bots/first/computer/control", expect.objectContaining({
    keepalive: true,
    body: expect.stringMatching(/^\{"action":"release","controlLeaseId":"[a-f0-9]{36}"\}$/),
  }));
  if (action === "unmount") root = createRoot(document.createElement("div"));
});

it("does not release another device's hold when a late take did not own it", async () => {
  await render();
  let taken!: Promise<void>;
  act(() => { taken = seen.take(); });
  await render("second");
  await act(async () => {
    finish({ held: true, owned: false });
    await taken;
  });
  expect(seen.here).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([true, false])("heartbeats only a hold this view owns (owned: %s), and stops once it leaves", async owned => {
  vi.useFakeTimers();
  await render("first", "first", true);
  let taken!: Promise<void>;
  act(() => { taken = seen.take(); });
  await act(async () => {
    finish({ held: true, owned });
    await taken;
  });
  expect(seen.here).toBe(true);
  const checks = () => vi.mocked(fetch).mock.calls.filter(([, init]) => String(init?.body).includes('"check"'));
  await act(async () => { vi.advanceTimersByTime(COMPUTER_CONTROL_HEARTBEAT_MS * 3); });
  expect(checks()).toHaveLength(owned ? 3 : 0);
  if (owned) {
    expect(checks()[0]).toEqual(["/api/bots/first/computer/control", expect.objectContaining({
      method: "POST", keepalive: true, body: expect.stringMatching(/^\{"action":"check","controlLeaseId":"[a-f0-9]{36}"\}$/),
    })]);
  }
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  await act(async () => { vi.advanceTimersByTime(COMPUTER_CONTROL_HEARTBEAT_MS * 3); });
  expect(checks()).toHaveLength(owned ? 3 : 0);
});

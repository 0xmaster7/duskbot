// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComputerTakeover, type TakeoverSnapshot } from "./computer-takeover";

let root: Root;
let seen: ReturnType<typeof useComputerTakeover>;
let finish: (snapshot: TakeoverSnapshot) => void;
const request = () => new Promise<TakeoverSnapshot>(resolve => { finish = resolve; });

function Probe({ botId, session }: { botId: string; session: string }) {
  seen = useComputerTakeover({ botId, session, held: false, request, viewerClose: null });
  return null;
}

const render = (botId = "first", session = botId) => act(async () => {
  root.render(createElement(Probe, { botId, session }));
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
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

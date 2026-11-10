// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Island } from "./Island";
import { LOOK_MS, attention, eventKey, isFresh, recentOf, useSeen } from "./seen";
import type { AmbientBot, AmbientBridge, AmbientSnapshot } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot>): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});

function fakeBridge(seen: string[] = []) {
  let state: (snapshot: AmbientSnapshot) => void = () => {};
  let told: (keys: string[]) => void = () => {};
  const marked: string[][] = [];
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { state = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {},
    ready: () => queueMicrotask(() => told(seen)),
    onSeen: (cb) => { told = cb; return () => {}; },
    seen: (keys) => marked.push(keys),
  };
  return { bridge, marked, feed: (bots: AmbientBot[]) => state({ bots, labels: { recent: "Recent", quiet: "All quiet" }, lang: "en" }) };
}

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("what the person has seen", () => {
  const failed = bot("Echo", { status: "error", unread: true, line: "Couldn't reach Gmail.", at: 9 });
  const replied = bot("Rivet", { status: "done", unread: true, line: "Fixed.", at: 7 });
  const asking = bot("Juno", { status: "needs-you", waits: "question", asks: 1 });

  it("keeps a reply or failure fresh until it is read anywhere or seen here, and never an ask", () => {
    expect(isFresh(failed, new Set())).toBe(true);
    // read on the phone or in another window: the chat is no longer unread
    expect(isFresh({ ...failed, unread: false }, new Set())).toBe(false);
    expect(isFresh(failed, new Set([eventKey(failed)]))).toBe(false);
    // a new failure later is news again
    expect(isFresh({ ...failed, at: 20 }, new Set([eventKey(failed)]))).toBe(true);
    expect(isFresh(asking, new Set(["Juno:needs-you:1"]))).toBe(false);
    const seen = new Set([eventKey(failed)]);
    expect(attention([failed, replied, asking], seen).map((entry) => entry.status)).toEqual(["idle", "done", "needs-you"]);
    expect(recentOf([failed, replied, asking], seen).map((entry) => entry.id)).toEqual(["Echo"]);
  });

  it("counts what an open panel showed as seen once it closes after a real look, and only then", async () => {
    vi.useFakeTimers();
    const { bridge, marked } = fakeBridge();
    let looking = false;
    let api: ReturnType<typeof useSeen> | null = null;
    const Probe = () => { api = useSeen(bridge, [failed, asking], looking); return null; };
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(createElement(Probe)));
    looking = true;
    await act(async () => root.render(createElement(Probe)));
    looking = false;
    await act(async () => root.render(createElement(Probe)));
    expect(marked).toEqual([]);
    looking = true;
    await act(async () => root.render(createElement(Probe)));
    vi.advanceTimersByTime(LOOK_MS + 10);
    looking = false;
    await act(async () => root.render(createElement(Probe)));
    expect(marked).toEqual([[eventKey(failed)]]);
    expect(api!.seen.has(eventKey(failed))).toBe(true);
    await act(async () => root.unmount());
  });

  it("puts the island back to the bare notch once everything is seen, keeping its mascot, quiet, in the row", async () => {
    const { bridge, feed } = fakeBridge([eventKey(failed)]);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(createElement(Island, { bridge })));
    await act(async () => { bridge.ready(); await Promise.resolve(); feed([failed]); });
    // the stale failure no longer sits on the island: no mascot, no face
    expect(host.querySelector(".amb-compact-tile")).toBeNull();
    expect(host.querySelector(".amb-emoji-glyph")).toBeNull();
    // its mascot stays in the row, with nothing to say
    expect(host.querySelector('[data-row="Echo"] .amb-strip-bot')).not.toBeNull();
    expect(host.querySelector('[data-row="Echo"] :is(.amb-bubble, .amb-state-dot)')).toBeNull();
    // a fresh one does, once it has held for a moment
    await act(async () => feed([{ ...failed, at: 20 }]));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    expect(host.querySelector(".amb-compact-tile")).not.toBeNull();
    expect(host.querySelector(".amb-emoji-glyph")?.textContent).toBe("😵");
    await act(async () => root.unmount());
  });
});

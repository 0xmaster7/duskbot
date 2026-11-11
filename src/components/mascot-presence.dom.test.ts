// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTLED_HOLD_MS, turnMarkState, useBotMarkState, type MarkBot } from "./mascot-presence";
import type { MarkState } from "./mascot-engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("turnMarkState, grok's bO", () => {
  const idle = { running: false, composing: false, awaiting: false };

  it("names the running step, streams while composing, and thinks before any step is named", () => {
    expect(turnMarkState({ ...idle, running: true }, 0)).toBe("thinking");
    expect(turnMarkState({ ...idle, running: true, activity: "command" }, 0)).toBe("running");
    expect(turnMarkState({ ...idle, running: true, activity: "web" }, 0)).toBe("searching");
    expect(turnMarkState({ ...idle, running: true, activity: "read" }, 0)).toBe("reading");
    expect(turnMarkState({ ...idle, running: true, activity: "edit" }, 0)).toBe("coding");
    expect(turnMarkState({ ...idle, running: true, activity: "tool" }, 0)).toBe("working");
    expect(turnMarkState({ ...idle, running: true, composing: true, activity: "command" }, 0)).toBe("streaming");
  });

  it("blocks while waiting on the person, then shows a fresh outcome for 8 s", () => {
    expect(turnMarkState({ ...idle, awaiting: true, settled: { at: 0, outcome: "success" } }, 10)).toBe("blocked");
    expect(turnMarkState({ ...idle, settled: { at: 0, outcome: "success" } }, SETTLED_HOLD_MS - 1)).toBe("finished");
    expect(turnMarkState({ ...idle, settled: { at: 0, outcome: "error" } }, 10)).toBe("failed");
    expect(turnMarkState({ ...idle, settled: { at: 0, outcome: "cancelled" } }, 10)).toBe("idle");
    expect(turnMarkState({ ...idle, settled: { at: 0, outcome: "success" } }, SETTLED_HOLD_MS)).toBe("idle");
  });
});

describe("useBotMarkState", () => {
  let host: HTMLDivElement;
  let root: Root;
  const seen: MarkState[] = [];
  function Probe({ bot }: { bot: MarkBot }) {
    seen.push(useBotMarkState(bot));
    return null;
  }
  const render = (bot: MarkBot) => act(() => root.render(createElement(Probe, { bot })));

  beforeEach(() => {
    vi.useFakeTimers();
    seen.length = 0;
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("starts idle and still, and unread changes nothing", () => {
    render({ threadId: "t1", busy: false, messages: [] });
    expect(seen.at(-1)).toBe("idle");
  });

  it("finishes for 8 s after a turn ends on screen, then idles", () => {
    render({ threadId: "t2", busy: true, messages: [] });
    // at work with no words coming yet: the mascot works, the typing dots (thinking) wait for the reply
    expect(seen.at(-1)).toBe("working");
    render({ threadId: "t2", busy: false, messages: [{ kind: "text" }] });
    expect(seen.at(-1)).toBe("finished");
    act(() => vi.advanceTimersByTime(SETTLED_HOLD_MS + 10));
    expect(seen.at(-1)).toBe("idle");
  });

  it("fails after a failed step, and blocks while a card waits", () => {
    render({ threadId: "t3", busy: true, messages: [] });
    render({ threadId: "t3", busy: false, messages: [{ kind: "activity", tool: { ok: false } }] });
    expect(seen.at(-1)).toBe("failed");
    render({ threadId: "t3", busy: false, activity: "waiting-on-you", messages: [] });
    expect(seen.at(-1)).toBe("blocked");
  });
});

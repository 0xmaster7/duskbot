// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lifeSpan } from "@/lib/reply-life";
import { useReplyLife, type LifeTurn } from "./use-reply-life";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const beats: Array<string | undefined> = [];
function Probe({ turns }: { turns: LifeTurn[] }) {
  beats.push(useReplyLife(turns).get("pepper"));
  return null;
}
const render = (turns: LifeTurn[]) => act(() => root.render(createElement(Probe, { turns })));
const beat = () => beats.at(-1);
const seed = "pepper:t1:1700000000000";

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  beats.length = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useReplyLife", () => {
  it("wakes for each beat: the mascot, the dots, the mascot again", () => {
    render([{ key: "pepper", seed, typing: false }]);
    expect(beat()).toBe("mascot");
    act(() => void vi.advanceTimersByTime(lifeSpan(seed, 0) - 1));
    expect(beat()).toBe("mascot");
    act(() => void vi.advanceTimersByTime(1));
    expect(beat()).toBe("dots");
    act(() => void vi.advanceTimersByTime(lifeSpan(seed, 1)));
    expect(beat()).toBe("mascot");
  });

  it("is the bot itself, never the dots, while the reply is being written", () => {
    render([{ key: "pepper", seed, typing: false }]);
    act(() => void vi.advanceTimersByTime(lifeSpan(seed, 0) + 10));
    expect(beat()).toBe("dots");
    render([{ key: "pepper", seed, typing: true }]);
    expect(beat()).toBe("mascot");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(beat()).toBe("mascot");
  });

  it("starts the next turn over on the mascot, and leaves no timer behind once nobody waits", () => {
    render([{ key: "pepper", seed, typing: false }]);
    act(() => void vi.advanceTimersByTime(lifeSpan(seed, 0) + 10));
    expect(beat()).toBe("dots");
    render([]);
    expect(beat()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    render([{ key: "pepper", seed: "pepper:t1:1700000090000", typing: false }]);
    expect(beat()).toBe("mascot");
  });
});

import { describe, expect, it } from "vitest";

import { createBucket } from "../src/fair-use.js";
import { createForwarder } from "../src/forwarder.js";

function clock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const timer = { at: t + ms, fn }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1); },
    advance(ms) {
      t += ms;
      for (let next; (next = timers.filter((one) => one.at <= t).sort((a, b) => a.at - b.at)[0]);) { timers.splice(timers.indexOf(next), 1); next.fn(); }
    },
  };
}

describe("createForwarder", () => {
  it("passes messages straight through within the burst and charges them", () => {
    const c = clock(), got = [];
    let charged = 0;
    const forwarder = createForwarder({ bucket: createBucket({ rate: 1000, burst: 10_000, now: c.now }), charge: (size) => { charged += size; }, setTimer: c.setTimer, clearTimer: c.clearTimer });
    expect(forwarder.forward((data) => got.push(data), "a", 100)).toBe(true);
    expect(got).toEqual(["a"]);
    expect(charged).toBe(100);
  });

  it("holds messages to the rate, in order, and delivers them later", () => {
    const c = clock(), got = [];
    const forwarder = createForwarder({ bucket: createBucket({ rate: 1000, burst: 1000, now: c.now }), setTimer: c.setTimer, clearTimer: c.clearTimer });
    const send = (data) => got.push(data);
    for (const one of ["1", "2", "3", "4"]) forwarder.forward(send, one, 1000);
    expect(got).toEqual(["1", "2"]);
    expect(forwarder.stats().queued).toBe(2000);
    c.advance(999);
    expect(got).toEqual(["1", "2"]);
    c.advance(1);
    expect(got).toEqual(["1", "2", "3"]);
    c.advance(1000);
    expect(got).toEqual(["1", "2", "3", "4"]);
    expect(forwarder.stats().queued).toBe(0);
  });

  it("refuses a sender that outruns the queue limit instead of holding unbounded memory", () => {
    const c = clock();
    const forwarder = createForwarder({ bucket: createBucket({ rate: 1, burst: 1, now: c.now }), maxQueue: 2500, setTimer: c.setTimer, clearTimer: c.clearTimer });
    const send = () => {};
    expect(forwarder.forward(send, "x", 1000)).toBe(true);
    expect(forwarder.forward(send, "x", 1000)).toBe(true);
    expect(forwarder.forward(send, "x", 1000)).toBe(true);
    expect(forwarder.forward(send, "x", 1000)).toBe(false);
  });

  it("keeps going when a peer closed under a queued message", () => {
    const c = clock(), got = [];
    const forwarder = createForwarder({ bucket: createBucket({ rate: 1000, burst: 1000, now: c.now }), setTimer: c.setTimer, clearTimer: c.clearTimer });
    forwarder.forward(() => got.push("a"), "a", 1000);
    forwarder.forward(() => got.push("a2"), "a2", 1000);
    forwarder.forward(() => { throw new Error("closed"); }, "b", 1000);
    forwarder.forward((data) => got.push(data), "c", 10);
    c.advance(5000);
    expect(got).toEqual(["a", "a2", "c"]);
  });
});

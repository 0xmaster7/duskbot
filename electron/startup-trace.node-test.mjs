import assert from "node:assert/strict";
import test from "node:test";
import { createStartupTrace } from "./startup-trace.mjs";

test("logs each milestone once, in order, when the launch finishes", () => {
  let clock = 0;
  const lines = [];
  const trace = createStartupTrace({ now: () => clock, log: (line) => lines.push(line) });
  clock = 120.4; trace.mark("ready");
  clock = 300; trace.mark("server");
  trace.mark("ready");
  clock = 910; trace.finish("shown");
  clock = 2000; trace.mark("late"); trace.finish("again");
  assert.deepEqual(lines, ["startup: ready 120ms, server 300ms, shown 910ms"]);
  assert.deepEqual(trace.marks().map(({ name }) => name), ["ready", "server", "shown"]);
});

test("reports each new milestone as it happens, once, and a throwing listener cannot break the trace", () => {
  const seen = [];
  const trace = createStartupTrace({ now: () => 0, log: () => {}, onMark: (name) => { seen.push(name); throw new Error("listener"); } });
  trace.mark("ready"); trace.mark("ready"); trace.mark("server"); trace.finish("shown"); trace.mark("late");
  assert.deepEqual(seen, ["ready", "server", "shown"]);
});

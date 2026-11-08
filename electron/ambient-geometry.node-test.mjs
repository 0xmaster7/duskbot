import assert from "node:assert/strict";
import test from "node:test";
import { DOCK, ISLAND_SIZES, ISLAND_WINDOW, PILL_TOP, dockBodyHeight, dockLayout, islandLayout, notchOf, pickDisplay } from "./ambient-geometry.mjs";

const display = (fields) => ({ id: 1, internal: false, label: "", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 }, ...fields });
const builtIn = display({ id: 1, internal: true, label: "Built-in Liquid Retina XDR Display" });
const external = display({ id: 2, bounds: { x: 1512, y: -200, width: 2560, height: 1440 }, workArea: { x: 1512, y: -175, width: 2560, height: 1415 } });

test("a built-in display with a notch-tall menu bar has a notch, and the island is never narrower than it", () => {
  const notch = notchOf(builtIn, "darwin");
  assert.deepEqual(notch, { width: 192, height: 37 });
  for (const size of Object.keys(ISLAND_SIZES)) {
    const { collapsed } = islandLayout(builtIn, { platform: "darwin", size });
    assert.equal(collapsed.kind, "notch");
    assert.equal(collapsed.top, 0);
    assert.equal(collapsed.height, 37);
    assert.ok(collapsed.width >= notch.width + 2 * ISLAND_SIZES.small.side);
  }
});

test("no notch off macOS, on an external display, or under a classic 24 pt menu bar", () => {
  assert.equal(notchOf(builtIn, "win32"), null);
  assert.equal(notchOf({ ...external, internal: false }, "darwin"), null);
  assert.equal(notchOf(display({ internal: true, label: "Built-in Retina Display", workArea: { x: 0, y: 24, width: 1440, height: 876 } }), "darwin"), null);
  // an auto-hidden menu bar measures nothing: the panel's name decides
  const hidden = { ...builtIn, workArea: { ...builtIn.bounds } };
  assert.deepEqual(notchOf(hidden, "darwin"), { width: 192, height: 37 });
  assert.equal(notchOf({ ...hidden, label: "Built-in Retina Display" }, "darwin"), null);
});

test("the island window sits at the top middle of its own display, and a display without a notch gets a floating pill", () => {
  const { window, collapsed } = islandLayout(external, { platform: "darwin", size: "large" });
  assert.deepEqual(window, { x: 1512 + (2560 - ISLAND_WINDOW.width) / 2, y: -200, width: ISLAND_WINDOW.width, height: ISLAND_WINDOW.height });
  assert.deepEqual(collapsed, { kind: "pill", width: ISLAND_SIZES.large.pill, height: ISLAND_SIZES.large.pillHeight, top: PILL_TOP, notch: 0 });
  assert.equal(islandLayout(external, { platform: "darwin", size: "huge" }).size, "medium");
});

test("the dock hugs the right edge of the work area, centred, as tall as its bots and never taller than the display", () => {
  const { window, body, top } = dockLayout(external, { count: 3 });
  assert.equal(body, DOCK.pad * 2 + 4 * DOCK.cell);
  assert.equal(window.x + window.width, 1512 + 2560);
  assert.equal(window.width, DOCK.body + DOCK.cardRoom);
  assert.equal(Math.round(window.y + window.height / 2), Math.round(-175 + 1415 / 2));
  assert.equal(top, (window.height - body) / 2);
  const many = dockBodyHeight(500, 600);
  assert.ok(many <= 600 - 2 * (DOCK.ear + DOCK.spill));
  assert.equal(dockBodyHeight(0, 900), DOCK.pad * 2 + DOCK.cell);
  // a Dock pinned to the right leaves a narrower work area; the bot dock stays left of it
  const pinned = { ...external, workArea: { ...external.workArea, width: 2480 } };
  assert.equal(dockLayout(pinned, { count: 1 }).window.x + dockLayout(pinned, { count: 1 }).window.width, 1512 + 2480);
});

test("the surfaces follow the pointer's display, or stay on the built-in or main one", () => {
  const all = [builtIn, external];
  assert.equal(pickDisplay(all, "active", { primary: builtIn, cursor: { x: 2000, y: 100 } }).id, 2);
  assert.equal(pickDisplay(all, "active", { primary: builtIn, cursor: { x: 9999, y: 9999 } }).id, 1);
  assert.equal(pickDisplay(all, "built-in", { primary: external, cursor: { x: 2000, y: 100 } }).id, 1);
  assert.equal(pickDisplay([external], "built-in", { primary: external }).id, 2);
  assert.equal(pickDisplay(all, "main", { primary: external, cursor: { x: 10, y: 10 } }).id, 2);
  assert.equal(pickDisplay([], "active", {}), null);
});

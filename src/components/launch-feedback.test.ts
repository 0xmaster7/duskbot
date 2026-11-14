import { expect, it } from "vitest";
import { onDockLauncher, screenChanged } from "./launch-feedback";

it("knows the dock launchers from the rest of the desktop", () => {
  expect(onDockLauncher(640, 775, 1280, 800)).toBe(true);
  expect(onDockLauncher(590, 790, 1280, 800)).toBe(true);
  expect(onDockLauncher(640, 700, 1280, 800)).toBe(false);
  expect(onDockLauncher(100, 775, 1280, 800)).toBe(false);
  expect(onDockLauncher(640, 775, 0, 0)).toBe(false);
});

it("counts a new window as a change, not a tooltip", () => {
  const before = new Uint8ClampedArray(32 * 18 * 4);
  const tooltip = before.slice();
  for (let i = 0; i < 12 * 4; i += 4) tooltip[i] = tooltip[i + 1] = tooltip[i + 2] = 200;
  expect(screenChanged(before, tooltip)).toBe(false);
  const window = before.map((value, i) => (i % 4 === 3 ? value : i < before.length / 2 ? 230 : value));
  expect(screenChanged(before, window)).toBe(true);
});

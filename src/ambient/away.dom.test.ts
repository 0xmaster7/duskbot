// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ambientAway, onAmbientAway, useAmbientAway } from "./away";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Screen({ reason, active }: { reason: string; active: boolean }) {
  useAmbientAway(reason, active);
  return null;
}

it("keeps the surfaces away while the welcome or the places hub shows, and back once neither does", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  let told = 0;
  const off = onAmbientAway(() => { told++; });
  const render = (welcome: boolean, hub: boolean) => act(async () => root.render([
    createElement(Screen, { key: "w", reason: "welcome", active: welcome }), createElement(Screen, { key: "h", reason: "places-hub", active: hub }),
  ]));
  await render(true, false);
  expect(ambientAway()).toBe(true);
  await render(false, true);
  expect(ambientAway()).toBe(true);
  await render(false, false);
  expect(ambientAway()).toBe(false);
  expect(told).toBeGreaterThan(0);
  await render(true, true);
  await act(async () => root.unmount());
  expect(ambientAway()).toBe(false);
  off();
});

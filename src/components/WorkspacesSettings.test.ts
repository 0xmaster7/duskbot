// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { currentKind, placeHealth } from "./WorkspacesSettings";
import { Segmented } from "./ui/Segmented";

it("dots a place green while it answers, gray while asleep or setting up, red when it needs the person", () => {
  expect(placeHealth({ opens: true })).toBe("online");
  expect(placeHealth({ opens: true, offline: true })).toBe("offline");
  expect(placeHealth({ opens: false })).toBe("offline");
  expect(placeHealth({ opens: true, progress: 0.4 })).toBe("setting-up");
  expect(placeHealth({ opens: true, ended: true })).toBe("problem");
  expect(placeHealth({ opens: false, waiting: true, progress: 0 })).toBe("problem");
});

it("names the window's own place by what it is when there is no list: a server connected by hand is never this computer", () => {
  expect(currentKind({ local: false })).toBe("server");
  expect(currentKind({ local: false, role: "Admin" })).toBe("team");
  expect(currentKind({ local: false, home: true })).toBe("cloud");
  expect(currentKind({ local: true })).toBe("computer");
  expect(currentKind(null)).toBe("computer");
});

it("moves a segmented pill's choice with the arrows, wrapping, and keeps one tab stop", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [value, setValue] = useState<"a" | "b" | "c">("a");
    return createElement(Segmented<"a" | "b" | "c">, { value, onChange: setValue, "aria-label": "pick", options: [{ value: "a", label: "a" }, { value: "b", label: "b" }, { value: "c", label: "c" }] });
  }
  await act(async () => root.render(createElement(Harness)));
  const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const checked = () => radios().find((radio) => radio.getAttribute("aria-checked") === "true")?.textContent;
  expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  const group = host.querySelector('[role="radiogroup"]')!;
  await act(async () => { group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
  expect(checked()).toBe("c");
  await act(async () => { group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(checked()).toBe("a");
  await act(async () => radios()[1]!.click());
  expect(checked()).toBe("b");
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

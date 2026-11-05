// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "./SettingsSelect";

let host: HTMLDivElement;
let root: Root;
const changes: string[] = [];
const outer = vi.fn();

function Harness() {
  const [value, setValue] = useState("light");
  return createElement(SettingsSelect, {
    value,
    "aria-label": "Theme",
    options: [{ value: "system", label: "Follow System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
    onChange: (event) => { changes.push(event.target.value); setValue(event.target.value); },
  });
}

const trigger = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  changes.length = 0;
  outer.mockReset();
  window.addEventListener("keydown", outer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Harness)); });
});
afterEach(async () => {
  window.removeEventListener("keydown", outer);
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("SettingsSelect", () => {
  it("shows its value as a pill and opens Grok's listbox on the chosen row, checked", async () => {
    expect(trigger().querySelector("span")!.textContent).toBe("Light");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await act(async () => { trigger().click(); });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const options = [...listbox()!.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.querySelector("span")!.textContent)).toEqual(["Follow System", "Light", "Dark"]);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(options[1]!.hasAttribute("data-highlighted")).toBe(true);
    expect(options[1]!.querySelector('[data-icon-name="check"]')).not.toBeNull();
    expect(document.activeElement).toBe(listbox());
  });

  it("moves with the arrows, chooses with Enter and gives focus back to the pill", async () => {
    await key(trigger(), "ArrowDown");
    await key(listbox()!, "ArrowDown");
    await key(listbox()!, "Enter");
    expect(changes).toEqual(["dark"]);
    expect(listbox()).toBeNull();
    expect(trigger().querySelector("span")!.textContent).toBe("Dark");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape without letting Settings close too", async () => {
    await act(async () => { trigger().click(); });
    await key(listbox()!, "Escape");
    expect(listbox()).toBeNull();
    expect(changes).toEqual([]);
    expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  });

  it("closes when a press lands outside it", async () => {
    await act(async () => { trigger().click(); });
    await act(async () => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(listbox()).toBeNull();
  });
});

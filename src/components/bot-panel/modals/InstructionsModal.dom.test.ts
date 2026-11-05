// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { InstructionsModal } from "./InstructionsModal";

let root: Root | null = null;
afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(bot: Partial<Bot>) {
  const patch = vi.fn();
  const onClose = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const derived = { patch } as unknown as ReturnType<typeof useBotSettingsDerived>;
  flushSync(() => root!.render(createElement(InstructionsModal, { bot: { id: "scout", name: "Scout", soul: "Be brief.", yourAccess: "edit", ...bot } as Bot, derived, onClose })));
  return { patch, onClose };
}

const sheet = () => document.querySelector<HTMLElement>('[data-panel-modal="instructions"]')!;
const field = () => sheet().querySelector("textarea")!;
const save = () => sheet().querySelector<HTMLButtonElement>('[data-modal-action="save"]')!;
const type = (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("the Instructions dialog", () => {
  it("is Grok's settings sheet: a titled, described dialog with no rule under the header or over the footer", () => {
    mount({});
    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().className).toContain("rounded-[14px]");
    expect(sheet().className).toContain("bg-app");
    expect(sheet().querySelector("h2")!.className).toContain("text-[17px]");
    expect(document.getElementById(sheet().getAttribute("aria-describedby")!)!.textContent).toBe("How should Scout work? What should it always or never do?");
    expect(sheet().querySelector(".border-b, .border-t")).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("saves only a changed draft, then closes", () => {
    const { patch, onClose } = mount({});
    expect(save().disabled).toBe(true);
    type("Be brief. Use lists.");
    expect(save().disabled).toBe(false);
    flushSync(() => save().click());
    expect(patch).toHaveBeenCalledWith({ soul: "Be brief. Use lists." });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the instructions as they were on Cancel, Escape or the close button", () => {
    const { patch, onClose } = mount({});
    type("Something else");
    flushSync(() => [...sheet().querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    flushSync(() => sheet().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(patch).not.toHaveBeenCalled();
  });

  it("is read-only for someone who can only view the bot", () => {
    mount({ yourAccess: "view" });
    expect(field().disabled).toBe(true);
    expect(sheet().textContent).toContain("Only people who can edit Scout can change this.");
  });
});

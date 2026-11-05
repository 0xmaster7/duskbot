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
  it("on its own is Grok's form dialog: a 14px titled, described sheet with no rule under the header or over the footer", () => {
    mount({});
    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().className).toContain("rounded-[14px]");
    expect(sheet().className).toContain("bg-menu");
    expect(sheet().querySelector("h2")!.className).toContain("text-[14px]");
    expect(sheet().querySelector('button[aria-label="Close"]')!.className).toContain("size-6");
    expect(document.getElementById(sheet().getAttribute("aria-describedby")!)!.textContent).toBe("How should Scout work? What should it always or never do?");
    expect(sheet().querySelector(".border-b, .border-t")).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("saves only a changed draft and stays open", () => {
    const { patch, onClose } = mount({});
    expect(save().disabled).toBe(true);
    type("Be brief. Use lists.");
    expect(save().disabled).toBe(false);
    flushSync(() => save().click());
    expect(patch).toHaveBeenCalledWith({ soul: "Be brief. Use lists." });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the size only once it is too long to save", () => {
    mount({});
    type("x".repeat(20_000));
    expect(sheet().querySelector("[data-instructions-count]")).toBeNull();
    type("x".repeat(24_001));
    expect(sheet().querySelector("[data-instructions-count]")!.textContent).toBe("Too long to save. 24,001 / 24,000");
    expect(save().disabled).toBe(true);
  });

  it("leaves the instructions as they were on Escape or the close button", () => {
    const { patch, onClose } = mount({});
    type("Something else");
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    flushSync(() => sheet().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(patch).not.toHaveBeenCalled();
  });

  it("is read-only for someone who can only view the bot", () => {
    mount({ yourAccess: "view" });
    expect(field().disabled).toBe(true);
    expect(sheet().textContent).toContain("Only people who can edit Scout can change this.");
  });
});

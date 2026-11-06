// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { clearInstructionDrafts, InstructionsModal } from "./InstructionsModal";

let root: Root | null = null;
afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  clearInstructionDrafts();
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
  it("is one calm card under the prompt in a pane of the sheet, Save at its bottom right, with no counter or rule", () => {
    mount({});
    expect(sheet().getAttribute("role")).toBeNull();
    expect(sheet().querySelector("h2")!.textContent).toBe("Instructions");
    expect(sheet().querySelector("[data-instructions-card]")!.previousElementSibling!.textContent).toBe("How should Scout work? What should it always or never do?");
    const card = sheet().querySelector<HTMLElement>("[data-instructions-card]")!;
    expect(card.className).toContain("rounded-[12px]");
    expect(card.className).toContain("border-edge");
    expect(card.contains(field())).toBe(true);
    expect(card.lastElementChild!.lastElementChild).toBe(save());
    expect(sheet().querySelector("[data-instructions-count], .border-b, .border-t")).toBeNull();
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

  it("leaves the instructions as they were when the pane goes without Save", () => {
    const { patch } = mount({});
    type("Something else");
    flushSync(() => root!.unmount());
    expect(patch).not.toHaveBeenCalled();
    root = null;
  });

  it("keeps an unsaved draft for the session when it closes, and drops it once saved", () => {
    mount({});
    type("Be brief. Use tables.");
    flushSync(() => root!.unmount());
    const { patch } = mount({});
    expect(field().value).toBe("Be brief. Use tables.");
    expect(save().disabled).toBe(false);
    flushSync(() => save().click());
    expect(patch).toHaveBeenCalledWith({ soul: "Be brief. Use tables." });
    flushSync(() => root!.unmount());
    mount({ soul: "Be brief. Use tables." });
    expect(save().disabled).toBe(true);
  });

  it("is read-only for someone who can only view the bot", () => {
    mount({ yourAccess: "view" });
    expect(field().disabled).toBe(true);
    expect(sheet().textContent).toContain("Only people who can edit Scout can change this.");
  });
});

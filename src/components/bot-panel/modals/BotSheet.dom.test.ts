// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";

vi.mock("../../Avatar", () => ({ BotAvatar: () => null }));
vi.mock("./PanelModals", async () => {
  const { GrokDialog } = await import("../../ui/GrokDialog");
  return {
    PanelModal: ({ page, onClose }: { page: string; onClose: () => void }) =>
      createElement(GrokDialog, { "data-panel-modal": page, title: page, onClose, children: createElement("p", null, page) }),
  };
});

const { BotSheet } = await import("./BotSheet");

let root: Root | null = null;
afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(initial: "instructions" | "memory" | "backups") {
  const onClose = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const derived = { patch: vi.fn() } as unknown as ReturnType<typeof useBotSettingsDerived>;
  flushSync(() => root!.render(createElement(BotSheet, { initial, bot: { id: "scout", name: "Scout" } as Bot, derived, onClose })));
  return { onClose };
}

const current = () => document.querySelector<HTMLElement>("[data-bot-sheet-page][aria-current='page']")?.dataset.botSheetPage;
const pane = () => document.querySelector<HTMLElement>("[data-panel-modal]")!;
const item = (page: string) => document.querySelector<HTMLButtonElement>(`[data-bot-sheet-page="${page}"]`)!;
const press = (key: string) => flushSync(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

describe("the bot's settings sheet", () => {
  it("opens on the asked page as a pane of Grok's settings sheet, not a dialog of its own", () => {
    mount("memory");
    expect(document.querySelector(".settings-dialog")!.getAttribute("role")).toBe("dialog");
    expect(current()).toBe("memory");
    expect(pane().dataset.panelModal).toBe("memory");
    expect(pane().getAttribute("role")).toBeNull();
    expect(pane().querySelector("h2")!.className).toContain("text-[17px]");
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1);
  });

  it("switches pages from the rail and with the arrow keys, wrapping at the ends", () => {
    mount("instructions");
    flushSync(() => item("skills").click());
    expect(current()).toBe("skills");
    expect(pane().dataset.panelModal).toBe("skills");
    item("skills").focus();
    press("ArrowDown");
    expect(current()).toBe("folder");
    expect(document.activeElement).toBe(item("folder"));
    press("End");
    expect(current()).toBe("backups");
    press("ArrowDown");
    expect(current()).toBe("instructions");
    press("ArrowUp");
    expect(current()).toBe("backups");
    expect(document.activeElement).toBe(item("backups"));
  });

  it("closes on Escape, the close button and the scrim", () => {
    const { onClose } = mount("backups");
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    flushSync(() => document.querySelector<HTMLButtonElement>(".settings-close")!.click());
    const scrim = document.querySelector<HTMLElement>("[data-bot-sheet]")!;
    flushSync(() => scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

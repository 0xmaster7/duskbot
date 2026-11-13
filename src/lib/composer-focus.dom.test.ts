// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeIsUnclaimed, keyTypesIntoComposer, openOverlays, watchComposerFocus } from "./composer-focus";

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => ({ key: k, defaultPrevented: false, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });

describe("typing with nothing editable focused goes to the chat box", () => {
  it("takes one printable character", () => {
    expect(keyTypesIntoComposer(key("a"), document.body, false)).toBe(true);
    expect(keyTypesIntoComposer(key("É"), document.body, false)).toBe(true);
  });
  it("leaves shortcuts, keys that are not characters, an input method and space alone", () => {
    for (const k of ["Enter", "Tab", "ArrowDown", "Dead", "Process", "Escape", " "]) expect(keyTypesIntoComposer(key(k), document.body, false), k).toBe(false);
    expect(keyTypesIntoComposer(key("k", { metaKey: true }), document.body, false)).toBe(false);
    expect(keyTypesIntoComposer(key("k", { ctrlKey: true }), document.body, false)).toBe(false);
    expect(keyTypesIntoComposer(key("k", { altKey: true }), document.body, false)).toBe(false);
    expect(keyTypesIntoComposer({ ...key("k"), isComposing: true }, document.body, false)).toBe(false);
  });
  it("never takes a key from a field, a menu or anything open on top", () => {
    const input = document.createElement("input");
    expect(keyTypesIntoComposer(key("a"), input, false)).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);
    expect(keyTypesIntoComposer(key("a"), item, false)).toBe(false);
    expect(keyTypesIntoComposer(key("a"), document.body, true)).toBe(false);
  });
  it("takes it from the bot panel docked beside the chat, not from a dialog over it", () => {
    const slot = document.createElement("div");
    slot.setAttribute("data-panel-slot", "open");
    const panel = document.createElement("aside");
    panel.setAttribute("role", "dialog");
    slot.append(panel);
    expect(keyTypesIntoComposer(key("a"), panel, false)).toBe(true);
    panel.setAttribute("aria-modal", "true");
    expect(keyTypesIntoComposer(key("a"), panel, false)).toBe(false);
  });
  it("leaves an Escape on a field to the field", () => {
    expect(escapeIsUnclaimed(document.createElement("textarea"), false)).toBe(false);
    expect(escapeIsUnclaimed(document.createElement("button"), false)).toBe(true);
    expect(escapeIsUnclaimed(document.body, true)).toBe(true);
  });
});

describe("watchComposerFocus", () => {
  let stop: () => void;
  let field: HTMLTextAreaElement;
  beforeEach(() => {
    vi.useFakeTimers();
    // happy-dom lays nothing out; everything attached counts as shown
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    document.body.innerHTML = '<div data-tour="composer"><textarea>draft</textarea></div><button id="pill">profile</button>';
    field = document.querySelector("textarea")!;
    stop = watchComposerFocus(window);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("moves focus into the chat box, caret at the end, on a printable key", () => {
    document.getElementById("pill")!.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h" }));
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(field.value.length);
  });

  it("does not move focus out of a field the person is using", () => {
    const search = document.createElement("input");
    document.body.append(search);
    search.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h" }));
    expect(document.activeElement).toBe(search);
  });

  it("leaves ? to the keyboard shortcuts", () => {
    document.getElementById("pill")!.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    expect(document.activeElement).not.toBe(field);
  });

  it("hands focus back when Escape closes a dialog and focus returns to its button", () => {
    const pill = document.getElementById("pill")!;
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    document.body.append(dialog);
    inside.focus();
    expect(openOverlays()).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    dialog.remove();
    pill.focus();
    vi.advanceTimersByTime(800);
    expect(document.activeElement).toBe(field);
  });

  it("hands focus back when the field that had it leaves the page", () => {
    const search = document.createElement("input");
    document.body.append(search);
    search.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    search.remove();
    (document.activeElement as HTMLElement | null)?.blur?.();
    vi.advanceTimersByTime(800);
    expect(document.activeElement).toBe(field);
  });

  it("hands focus back when Enter picks a search result and the search folds away", () => {
    const search = document.createElement("input");
    document.body.append(search);
    search.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    search.remove();
    (document.activeElement as HTMLElement | null)?.blur?.();
    vi.advanceTimersByTime(800);
    expect(document.activeElement).toBe(field);
  });

  it("leaves focus where it is when Escape closed nothing", () => {
    const pill = document.getElementById("pill")!;
    pill.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    vi.advanceTimersByTime(800);
    expect(document.activeElement).toBe(pill);
  });
});

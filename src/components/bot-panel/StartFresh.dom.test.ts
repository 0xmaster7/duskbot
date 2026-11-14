// @vitest-environment happy-dom
// Start fresh in a real DOM: the button shows only where main says it may, nothing runs until the confirm words are typed,
// and a step that failed is listed with a retry while the dialog can't just be closed.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartFreshView } from "../../../electron/start-fresh.mjs";

const { StartFreshButton, StartFreshDialog, startFreshTyped } = await import("./StartFresh");

const pending: StartFreshView = { phase: "idle", steps: [
  { id: "server:s1", kind: "server", label: "Box", status: "pending" },
  { id: "plan:c1", kind: "plan", label: "My cloud", status: "pending" },
  { id: "account", kind: "account", label: "tester@qa.dusk.test", clouds: 1, status: "pending" },
  { id: "ai", kind: "ai", label: "", status: "pending" },
  { id: "local", kind: "local", label: "", status: "pending" },
] };
const partial: StartFreshView = { phase: "partial", steps: pending.steps.map((step) => step.id === "server:s1"
  ? { ...step, status: "failed", error: "The server answered 502.", uninstall: "curl -fsSL https://link.dusk.bot/uninstall | sh" }
  : { ...step, status: "done" }) };
const done: StartFreshView = { phase: "done", steps: pending.steps.map((step) => ({ ...step, status: "done" })) };

function fakeBridge(runs: StartFreshView = partial) {
  const listeners: Array<(view: StartFreshView) => void> = [];
  return {
    available: vi.fn(async () => true),
    preview: vi.fn(async () => pending),
    run: vi.fn(async (_typed: string) => runs),
    retry: vi.fn(async () => done),
    finish: vi.fn(async () => ({ ...done, phase: "restarting" as const })),
    onChanged: vi.fn((cb: (view: StartFreshView) => void) => { listeners.push(cb); return () => {}; }),
    emit: (view: StartFreshView) => listeners.forEach((cb) => cb(view)),
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  delete (window as { duskDesktop?: unknown }).duskDesktop;
});

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
function type(text: string) {
  const input = $<HTMLInputElement>("[data-start-fresh-input]")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Start fresh", () => {
  it("accepts only the confirm words, any case or spacing around them", () => {
    expect(startFreshTyped("delete everything")).toBe(true);
    expect(startFreshTyped("  DELETE everything ")).toBe(true);
    for (const typed of ["", "delete", "delete everything!", "delete  everything", "everything"]) expect(startFreshTyped(typed)).toBe(false);
  });

  it("shows its button only when main says this page may", async () => {
    const yes = fakeBridge();
    (window as { duskDesktop?: unknown }).duskDesktop = { startFresh: yes };
    act(() => root.render(createElement(StartFreshButton)));
    await settle();
    expect($("[data-start-fresh]")?.getAttribute("aria-label")).toBe("Start fresh");
    act(() => root.unmount());
    root = createRoot(host);
    (window as { duskDesktop?: unknown }).duskDesktop = { startFresh: { ...yes, available: async () => false } };
    act(() => root.render(createElement(StartFreshButton)));
    await settle();
    expect($("[data-start-fresh]")).toBeNull();
  });

  it("keeps the red button disabled until the words match, and sends exactly what was typed", async () => {
    const bridge = fakeBridge();
    act(() => root.render(createElement(StartFreshDialog, { bridge: bridge as never, onClose: vi.fn() })));
    await settle();
    expect($("[role=alertdialog]")?.textContent).toContain("This deletes everything and cannot be undone");
    const confirm = () => $<HTMLButtonElement>("[data-start-fresh-confirm]")!;
    expect(confirm().disabled).toBe(true);
    type("delete everythin");
    expect(confirm().disabled).toBe(true);
    act(() => confirm().click());
    expect(bridge.run).not.toHaveBeenCalled();
    type("Delete everything");
    expect(confirm().disabled).toBe(false);
    await act(async () => { confirm().click(); });
    await settle();
    expect(bridge.run).toHaveBeenCalledWith("Delete everything");
  });

  it("lists what failed with a retry and the server's uninstall line, and can't be closed halfway", async () => {
    const bridge = fakeBridge();
    const onClose = vi.fn();
    act(() => root.render(createElement(StartFreshDialog, { bridge: bridge as never, onClose })));
    await settle();
    type("delete everything");
    await act(async () => { $<HTMLButtonElement>("[data-start-fresh-confirm]")!.click(); });
    await settle();
    expect($("[data-start-fresh-dialog]")?.getAttribute("data-start-fresh-dialog")).toBe("partial");
    const failed = $("[data-start-fresh-step='server:s1']")!;
    expect(failed.dataset.status).toBe("failed");
    expect(failed.textContent).toContain("The server answered 502.");
    expect(failed.textContent).toContain("curl -fsSL https://link.dusk.bot/uninstall | sh");
    expect($("[data-start-fresh-step=account]")?.dataset.status).toBe("done");
    // no close button, Escape and the scrim do nothing
    expect($("[aria-label=Close]")).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    act(() => { $("[data-modal-scrim]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { $<HTMLButtonElement>("[data-start-fresh-retry]")!.click(); });
    await settle();
    expect(bridge.retry).toHaveBeenCalledOnce();
    expect($("[data-start-fresh-dialog]")?.getAttribute("data-start-fresh-dialog")).toBe("done");
    await act(async () => { $<HTMLButtonElement>("[data-start-fresh-restart]")!.click(); });
    await settle();
    expect(bridge.finish).toHaveBeenCalledOnce();
  });

  it("shows each step's progress as main reports it", async () => {
    const bridge = fakeBridge();
    act(() => root.render(createElement(StartFreshDialog, { bridge: bridge as never, onClose: vi.fn() })));
    await settle();
    act(() => bridge.emit({ phase: "running", steps: pending.steps.map((step, index) => ({ ...step, status: index === 0 ? "done" : index === 1 ? "running" : "pending" })) }));
    expect($("[data-start-fresh-dialog]")?.getAttribute("data-start-fresh-dialog")).toBe("running");
    expect($("[data-start-fresh-step='plan:c1']")?.dataset.status).toBe("running");
    expect($("[data-start-fresh-step=account]")?.textContent).toContain("Your account and dusk cloud computers");
  });

  it("closes from Cancel before anything is deleted", async () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(StartFreshDialog, { bridge: fakeBridge() as never, onClose })));
    await settle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});

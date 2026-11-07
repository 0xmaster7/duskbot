// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({ ready: true, capabilities: {} as any }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => fx }));
const { NativeComputerSettings } = await import("./NativeComputerSettings");
let host: HTMLDivElement;
let root: Root;
const render = async () => { await act(async () => root.render(createElement(NativeComputerSettings))); };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  fx.ready = true;
  fx.capabilities = { host: { platform: "darwin" }, localComputer: { available: true, enabled: true, status: "ready" } };
  window.ogb = { localControl: { retry: vi.fn() }, permOpenSettings: vi.fn() } as any;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected setup request"); }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.ogb;
  vi.unstubAllGlobals();
});

it("offers the ready native Mac without Docker, VPS, or any setup side effect", () => {
  expect(host.textContent).toContain("This computer");
  expect(host.textContent).toContain("No Docker or VPS required.");
  expect(host.querySelector('[data-native-computer-state="working"]')?.textContent).toBe("Working");
  expect(fetch).not.toHaveBeenCalled();
  expect(window.ogb!.localControl.retry).not.toHaveBeenCalled();
  expect(window.ogb!.permOpenSettings).not.toHaveBeenCalled();
});

it("shows only the missing macOS permission and never calls it Working", async () => {
  fx.capabilities.localComputer = { available: false, message: "Screen Recording required", reasonCode: "permission-missing" };
  await render();
  expect(host.querySelector('[data-native-computer-state="working"]')).toBeNull();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.some((button) => button.textContent === "Open Accessibility Settings")).toBe(false);
  await act(async () => buttons.find((button) => button.textContent === "Open Screen Recording Settings")!.click());
  expect(window.ogb!.permOpenSettings).toHaveBeenCalledExactlyOnceWith("screen");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps Windows native control independent and hides the local machine for remote servers", async () => {
  fx.capabilities.host.platform = "win32";
  await render();
  expect(host.querySelector('[data-native-computer-state="working"]')).not.toBeNull();
  fx.capabilities.localComputer = { available: false, reasonCode: "remote-server" };
  await render();
  expect(host.textContent).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

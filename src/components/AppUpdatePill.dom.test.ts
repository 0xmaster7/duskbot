// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppUpdateState } from "../../electron/app-update.mjs";
import { AppUpdatePill } from "./AppUpdatePill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tell: (state: AppUpdateState) => void = () => {};
let now: AppUpdateState = { ready: null, available: null, progress: null };
const bridge = {
  state: vi.fn(async () => now),
  restart: vi.fn(async () => true),
  download: vi.fn(async () => "0.2.7" as string | null),
  onState: vi.fn((cb: (state: AppUpdateState) => void) => { tell = cb; return () => {}; }),
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  now = { ready: null, available: null, progress: null };
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { appUpdate: bridge };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

const pill = () => host.querySelector<HTMLButtonElement>("[data-app-update]");
const mount = async () => { await act(async () => { root.render(createElement(AppUpdatePill)); }); };
const hear = async (state: AppUpdateState) => { await act(async () => { tell(state); }); };

it("shows nothing until a newer version is found, then offers it, its download and its restart", async () => {
  await mount();
  expect(pill()).toBeNull();
  await hear({ ready: null, available: "0.2.7", progress: null });
  expect(pill()?.textContent).toBe("Update to 0.2.7");
  expect(pill()?.dataset.appUpdateState).toBe("available");
  await hear({ ready: null, available: "0.2.7", progress: 0.4 });
  expect(pill()?.textContent).toBe("Downloading 0.2.740%");
  expect(pill()?.getAttribute("aria-busy")).toBe("true");
  await hear({ ready: "0.2.7", available: "0.2.7", progress: null });
  expect(pill()?.textContent).toBe("Restart to update");
  await hear({ ready: null, available: null, progress: null });
  expect(pill()).toBeNull();
});

it("hides on a page that isn't this computer's own", async () => {
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { appUpdate: bridge, remoteClient: { active: true } };
  now = { ready: "0.2.7", available: "0.2.7", progress: null };
  await mount();
  expect(pill()).toBeNull();
});

it("a click on a found update downloads it, then restarts into it once it's ready", async () => {
  now = { ready: null, available: "0.2.7", progress: null };
  await mount();
  await act(async () => { pill()!.click(); });
  expect(bridge.download).toHaveBeenCalledTimes(1);
  expect(bridge.restart).not.toHaveBeenCalled();
  expect(pill()?.dataset.appUpdateState).toBe("downloading");
  await hear({ ready: null, available: "0.2.7", progress: 0.5 });
  await act(async () => { pill()!.click(); });
  expect(bridge.download).toHaveBeenCalledTimes(1);
  await hear({ ready: "0.2.7", available: "0.2.7", progress: null });
  expect(bridge.restart).toHaveBeenCalledTimes(1);
});

it("a click on a ready update restarts right away; a download that finds nothing lets the person try again", async () => {
  now = { ready: "0.2.7", available: "0.2.7", progress: null };
  await mount();
  await act(async () => { pill()!.click(); });
  expect(bridge.restart).toHaveBeenCalledTimes(1);
  expect(bridge.download).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); });
  root = createRoot(host);
  now = { ready: null, available: "0.2.7", progress: null };
  bridge.download.mockResolvedValueOnce(null);
  await mount();
  await act(async () => { pill()!.click(); });
  expect(pill()?.dataset.appUpdateState).toBe("available");
});

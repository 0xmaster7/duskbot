// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudSendNotice } from "../../electron/cloud-send.mjs";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown>, tracked: [] as Array<[string, unknown]> }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({ track: (name: string, props: unknown) => { fixture.tracked.push([name, props]); } }));
vi.mock("./Avatar", () => ({ MausAvatar: () => null }));

const { CloudMoveOffer } = await import("./CloudMoveOffer");
const { CloudMoveSettings } = await import("./CloudMoveSettings");
const { setLocale } = await import("@/lib/i18n");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: CloudSendNotice = { ready: false, bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: 0, signature: "", dismissed: false, running: false, last: null };
let host: HTMLDivElement, root: Root;
let current: CloudSendNotice;
let listener: ((notice: CloudSendNotice) => void) | null;
const calls: string[] = [];
const bridge = {
  notice: vi.fn(async () => current),
  onNotice: (cb: (notice: CloudSendNotice) => void) => { listener = cb; return () => { listener = null; }; },
  dismiss: vi.fn(async (signature: string) => { calls.push(`dismiss:${signature}`); current = { ...current, move: undefined }; return current; }),
  moveRetry: vi.fn(async () => { calls.push("retry"); return current; }),
  moveOfferAccept: vi.fn(async (from: string) => {
    calls.push(`accept:${from}`);
    current = { ...BASE, move: { phase: "copy", chats: { done: 3, total: 40 } } };
    return current;
  }),
  moveOfferDismiss: vi.fn(async (which: string) => {
    calls.push(`dismiss-offer:${which}`);
    current = { ...BASE, offer: { stage: which === "prompt" ? "banner" : "settings", bots: 12 } };
    return current;
  }),
};
const workspaces = { state: vi.fn(async () => ({ local: true, name: "This computer" })), menu: vi.fn(async () => { calls.push("menu"); }), onChanged: () => () => {} };

const render = async (node: ReturnType<typeof createElement>) => { await act(async () => root.render(node)); await act(async () => {}); };
const push = async (next: CloudSendNotice) => { current = next; await act(async () => listener?.(next)); };
const click = async (selector: string) => { await act(async () => (document.querySelector(selector) as HTMLElement).click()); await act(async () => {}); };
const button = (text: string) => [...document.querySelectorAll("button")].find((found) => found.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  setLocale("en");
  fixture.state = { connected: true, config: {}, appSettingsOpen: false, settingsOpen: false, pluginsOpen: false, shortcutsOpen: false };
  fixture.tracked = [];
  calls.length = 0;
  listener = null;
  current = { ...BASE, offer: { stage: "prompt", bots: 12 } };
  vi.stubGlobal("ogb", undefined);
  (window as unknown as { ogb: unknown }).ogb = { cloudSendPage: bridge, workspaces };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

it("asks with a sheet by itself, starts the move on the one button and then follows it with its progress", async () => {
  await render(createElement(CloudMoveOffer));
  const sheet = document.querySelector('[data-panel-modal="cloud-move-offer"]');
  expect(sheet?.getAttribute("role")).toBe("dialog");
  expect(sheet?.textContent).toContain("Your dusk cloud is ready");
  expect(sheet?.textContent).toContain("Your 12 bots, their chats, memory, skills and routines go over.");
  expect(fixture.tracked).toEqual([["cloud_move_prompt", { action: "shown" }]]);
  await click('[data-cloud-move-accept="prompt"]');
  expect(calls).toEqual(["accept:prompt"]);
  const progress = document.querySelector('[data-panel-modal="cloud-move-progress"]');
  expect(progress?.textContent).toContain("3");
  expect(progress?.textContent).toContain("40");
  await act(async () => button("Keep using the app")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("not now closes the sheet for good, then the slim line asks; its close leaves only Settings", async () => {
  await render(createElement(CloudMoveOffer));
  await act(async () => button("Not now")!.click());
  await act(async () => {});
  expect(calls).toEqual(["dismiss-offer:prompt"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const banner = document.querySelector("[data-cloud-move-banner]");
  expect(banner?.textContent).toContain("Move your bots to dusk cloud");
  expect(fixture.tracked).toContainEqual(["cloud_move_banner", { action: "shown" }]);
  await click('[aria-label="Close"]');
  expect(calls).toEqual(["dismiss-offer:prompt", "dismiss-offer:banner"]);
  expect(document.querySelector("[data-cloud-move-banner]")).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("the line's Move now starts the move", async () => {
  current = { ...BASE, offer: { stage: "banner", bots: 2 } };
  await render(createElement(CloudMoveOffer));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('[data-cloud-move-accept="banner"]');
  expect(calls).toEqual(["accept:banner"]);
  expect(document.querySelector('[data-panel-modal="cloud-move-progress"]')).not.toBeNull();
});

it("waits while Settings or another sheet is open", async () => {
  fixture.state = { ...fixture.state, appSettingsOpen: true };
  await render(createElement(CloudMoveOffer));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(fixture.tracked).toEqual([]);
});

it("a start that fails says so in the sheet and changes nothing else", async () => {
  bridge.moveOfferAccept.mockRejectedValueOnce(new Error("Error invoking remote method 'cloud-send:move-offer-accept': Error: There is nothing to move to Dusk Cloud right now."));
  await render(createElement(CloudMoveOffer));
  await click('[data-cloud-move-accept="prompt"]');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("The move didn't start. There is nothing to move to Dusk Cloud right now.");
  expect(document.querySelector('[data-panel-modal="cloud-move-offer"]')).not.toBeNull();
});

it("on My Cloud's page, once the move is done, says how many bots moved, and Got it closes it", async () => {
  current = { ...BASE, move: { phase: "done", phone: false, held: [], counts: { bots: 12, skills: 4, logins: 0, onePassword: false, chats: 48, routines: 2 } } };
  await render(createElement(CloudMoveOffer, { cloudHome: true }));
  const done = document.querySelector('[data-panel-modal="cloud-move-done"]');
  expect(done?.textContent).toContain("12 bots moved to dusk cloud");
  expect(done?.textContent).toContain("They keep working 24/7 now. 4 skills, 48 chats, and 2 routines came with them.");
  await act(async () => button("Got it")!.click());
  await act(async () => {});
  expect(calls).toEqual(["dismiss:one-home"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("Settings → Computer keeps the move and the workspace switch, then shows the move's progress and its Try again", async () => {
  current = { ...BASE, offer: { stage: "settings", bots: 12 } };
  await render(createElement(CloudMoveSettings));
  expect(host.querySelector('[data-panel-row="workspace"]')?.textContent).toContain("This computer");
  await act(async () => (host.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click());
  expect(calls).toEqual(["menu"]);
  expect(host.querySelector('[data-panel-row="cloud-move"]')?.textContent).toContain("Your 12 bots on this computer keep working 24/7 there.");
  await click('[data-cloud-move-accept="settings"]');
  expect(calls).toEqual(["menu", "accept:settings"]);
  expect(host.querySelector('[data-panel-row="cloud-move"]')?.textContent).toContain("Moving your bots to dusk cloud");
  await push({ ...BASE, move: { phase: "copy", failing: { error: "My Cloud did not answer." } } });
  await act(async () => button("Try again")!.click());
  expect(calls.at(-1)).toBe("retry");
});

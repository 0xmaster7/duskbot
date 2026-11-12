// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));

const { BotsElsewhere } = await import("./BotsElsewhere");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
let finish: ((value: boolean) => void) | null = null;
const bridge = {
  state: vi.fn(async () => ({ places: [{ id: "srv", name: "instance-1", why: "moved" }], known: null })),
  open: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })),
  connect: vi.fn(async () => null),
  counts: vi.fn(async () => ({ srv: 3, bogus: -1 })),
};

const render = async () => { await act(async () => { root.render(createElement(BotsElsewhere)); }); };
const screen = () => host.querySelector("[data-elsewhere]");
const primary = () => host.querySelector<HTMLButtonElement>("button[data-place-row]")!;

beforeEach(() => {
  fixture.state = { hydrated: true, connected: true, bots: [], appSettingsOpen: false, cloudAdd: null };
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { elsewhere: bridge };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); finish = null; vi.clearAllMocks(); });

it("opening a place keeps this screen up until main answers, never this computer's empty page in between", async () => {
  await render();
  expect(screen()?.getAttribute("data-elsewhere")).toBe("bots-on");
  expect(host.querySelector("h1")?.textContent).toBe("pick where to open");
  expect(host.querySelector("[data-place-row=computer]")?.getAttribute("aria-current")).toBe("true");
  expect(primary().textContent).toContain("instance-1");
  expect(primary().textContent).toContain("3 bots");
  expect(primary().hasAttribute("data-lit")).toBe(true);
  await act(async () => { primary().click(); });
  expect(bridge.open).toHaveBeenCalledWith("srv");
  expect(screen()).not.toBeNull();
  expect(screen()?.getAttribute("aria-busy")).toBe("true");
  expect(primary().disabled).toBe(true);
  await act(async () => { finish?.(true); });
  expect(screen()?.getAttribute("aria-busy")).toBeNull();
  expect(primary().disabled).toBe(false);
});

it("steps aside while Settings is open, so connect a server shows the connect flow instead of this screen", async () => {
  fixture.state = { ...fixture.state, appSettingsOpen: true };
  await render();
  expect(screen()).toBeNull();
  fixture.state = { ...fixture.state, appSettingsOpen: false };
  await render();
  expect(screen()).not.toBeNull();
});

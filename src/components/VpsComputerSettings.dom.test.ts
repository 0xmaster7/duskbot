// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({
  state: { connected: true, config: { vps: { configured: true, sshAlias: "fixture", mode: "shared", autoStart: true, idleTimeoutMinutes: 10, sharingAllowed: true } } } as any,
  owner: true as boolean | null,
  api: vi.fn(), dispatch: vi.fn(),
}));
vi.mock("@/state/store", () => ({ api: fx.api, useStore: () => ({ state: fx.state, dispatch: fx.dispatch }) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fx.owner }));
const { VpsComputerSettings } = await import("./VpsComputerSettings");
let host: HTMLDivElement;
let root: Root;
const render = async () => { await act(async () => root.render(createElement(VpsComputerSettings))); };
const choose = async (label: string, text: string) => {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((item) => item.textContent === text)!;
  expect(option).toBeDefined();
  await act(async () => option.click());
};
beforeEach(async () => {
  setLocale("en");
  fx.owner = true;
  fx.state = { connected: true, config: { vps: { configured: true, sshAlias: "fixture", mode: "shared", autoStart: true, idleTimeoutMinutes: 10, sharingAllowed: true } } };
  fx.api.mockReset();
  fx.dispatch.mockReset().mockImplementation((action) => { fx.state.config = action.config; root.render(createElement(VpsComputerSettings)); });
  window.ogb = { app: { ownPage: true } } as any;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.ogb;
});

it("saves a partial sharing policy and rolls back a rejected idle change", async () => {
  fx.api.mockResolvedValueOnce({ vps: { ...fx.state.config.vps, mode: "per-bot" } });
  await choose("Computer sharing", "Per bot");
  expect(fx.api).toHaveBeenCalledWith("/api/config", { method: "PATCH", body: '{"vps":{"mode":"per-bot"}}' });
  expect(host.querySelector('[aria-label="Computer sharing"]')?.textContent).toContain("Per bot");
  fx.api.mockRejectedValueOnce(new Error("fixture turn still active"));
  await choose("Sleep when idle", "Off");
  expect(host.querySelector('[aria-label="Sleep when idle"]')?.textContent).toContain("10 minutes");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("fixture turn still active");
});

it("persists wake and idle controls without replacing the saved SSH alias", async () => {
  fx.api.mockImplementation(async (_path, request) => ({ vps: { ...fx.state.config.vps, ...JSON.parse(request.body).vps } }));
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await choose("Sleep when idle", "5 minutes");
  expect(fx.state.config.vps).toMatchObject({ sshAlias: "fixture", autoStart: false, idleTimeoutMinutes: 5 });
  expect(fx.api.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([{ vps: { autoStart: false } }, { vps: { idleTimeoutMinutes: 5 } }]);
});

it("keeps workspace privacy and owner permissions authoritative", async () => {
  fx.state.config.vps.sharingAllowed = false;
  fx.owner = false;
  await render();
  expect(host.querySelector('[aria-label="Computer sharing"]')).toBeNull();
  expect(host.textContent).toContain("This workspace keeps bot computers separate.");
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  expect(host.textContent).toContain("Only an admin");
  fx.owner = null;
  await render();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Sleep when idle"]')!.disabled).toBe(true);
  expect(fx.api).not.toHaveBeenCalled();
});

it("keeps independent screens under Advanced and only offers them for shared computers", async () => {
  const advanced = host.querySelector("details")!;
  expect(advanced.open).toBe(false);
  expect(advanced.textContent).toContain("Shared files, separate screens and browser sign-ins");
  expect(advanced.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(advanced.querySelector('[aria-label="Simultaneous screens"]')?.textContent).toContain("20");
  fx.api.mockImplementation(async (_path, request) => ({ vps: { ...fx.state.config.vps, ...JSON.parse(request.body).vps } }));
  await act(async () => { advanced.open = true; advanced.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); });
  expect(fx.api.mock.calls[0][1].body).toBe('{"vps":{"independentScreens":false}}');
  expect(advanced.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(advanced.querySelector('[aria-label="Simultaneous screens"]')).toBeNull();
  fx.state.config = { vps: { ...fx.state.config.vps, mode: "per-bot" } };
  await render();
  expect(host.querySelector("details")).toBeNull();
});

it("preserves an explicit shared screen preference and custom screen count", async () => {
  fx.state.config.vps = { ...fx.state.config.vps, independentScreens: false, maxScreens: 7 };
  await render();
  expect(host.querySelector('details [role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(host.querySelector('[aria-label="Simultaneous screens"]')).toBeNull();
  fx.state.config.vps.independentScreens = true;
  await render();
  expect(host.querySelector('[aria-label="Simultaneous screens"]')?.textContent).toContain("7");
  fx.api.mockImplementation(async (_path, request) => ({ vps: { ...fx.state.config.vps, ...JSON.parse(request.body).vps } }));
  await choose("Simultaneous screens", "15");
  expect(fx.api.mock.calls[0][1].body).toBe('{"vps":{"maxScreens":15}}');
  expect(host.querySelector('[aria-label="Simultaneous screens"]')?.textContent).toContain("15");
});

it("rolls back a rejected screen limit without changing other policy", async () => {
  fx.api.mockRejectedValueOnce(new Error("fixture screen still active"));
  await choose("Simultaneous screens", "4");
  expect(host.querySelector('[aria-label="Simultaneous screens"]')?.textContent).toContain("20");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("fixture screen still active");
  expect(fx.state.config.vps).toMatchObject({ sshAlias: "fixture", mode: "shared" });
});

it("does not apply a response to a different linked server", async () => {
  let resolve!: (value: unknown) => void;
  fx.api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await choose("Computer sharing", "Per bot");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Computer sharing"]')!.disabled).toBe(true);
  fx.state.config = { vps: { ...fx.state.config.vps, sshAlias: "other-server" } };
  await render();
  await act(async () => resolve({ vps: { configured: true, sshAlias: "fixture", mode: "per-bot" } }));
  expect(fx.dispatch).not.toHaveBeenCalled();
  expect(host.textContent).toContain("other-server");
});

it("shows Working only for a connected active server page, without probing", async () => {
  expect(host.querySelector('[data-vps-connection="configured"]')).not.toBeNull();
  window.ogb = { app: { ownPage: false } } as any;
  await render();
  expect(host.querySelector('[data-vps-connection="working"]')?.textContent).toBe("Working");
  fx.state.connected = false;
  await render();
  expect(host.querySelector('[data-vps-connection="reconnecting"]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  expect(fx.api).not.toHaveBeenCalled();
});

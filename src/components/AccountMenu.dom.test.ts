// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/places", async (original) => ({ ...await original<typeof import("@/lib/places")>(), usePlaces: () => ({ beside: true, places: [] }) }));
const { AccountsSheet, useAccounts } = await import("./AccountMenu");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = { active: { id: "a", email: "a@example.test" } };
const bridge = {
  list: vi.fn(async () => view),
  onChanged: vi.fn(() => () => {}),
  signOut: vi.fn(async () => ({ outcome: "signed-out", view: { active: null } })),
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { accounts: bridge, app: { ownPage: true } };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

const dialog = () => document.body.querySelector<HTMLElement>("[role=alertdialog], [role=dialog][aria-modal=true]:not([data-accounts-sheet])");
const button = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);

it("the accounts sheet asks before signing out of dusk cloud, with art and what happens; cancel keeps the account", async () => {
  await act(async () => { root.render(createElement(AccountsSheet, { onClose: vi.fn() })); });
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-accounts-sign-out]")!.click(); });
  expect(bridge.signOut).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain("Sign out of dusk cloud?");
  expect(dialog()?.textContent).toContain("Your plan and your cloud bots keep going.");
  expect(dialog()?.querySelector("svg, canvas, img, [data-pixel-icon]")).not.toBeNull();
  await act(async () => { (button("Cancel") ?? button("Cancel")!).click(); });
  expect(dialog()).toBeNull();
  expect(bridge.signOut).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-accounts-sign-out]")!.click(); });
  const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === "Sign out")!;
  await act(async () => { confirm.click(); });
  expect(bridge.signOut).toHaveBeenCalledWith("a");
});

it("the You menu and settings sign out through the same question", async () => {
  let access: ReturnType<typeof useAccounts> | null = null;
  function Probe() { access = useAccounts(); return access.signOutConfirm as never; }
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { access!.signOut("a"); });
  expect(bridge.signOut).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain("Sign out of dusk cloud?");
  const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === "Sign out")!;
  await act(async () => { confirm.click(); });
  expect(bridge.signOut).toHaveBeenCalledWith("a");
  expect(dialog()).toBeNull();
});

it("the account card shows the photo, name, address and plan, and Manage account opens the account page", async () => {
  const at = Date.UTC(2026, 11, 14, 12);
  bridge.list.mockResolvedValueOnce({ active: { id: "a", email: "a@example.test", name: "Ada Lovelace", avatarUrl: "https://photos.example.test/ada.png", plan: { status: "active", tier: "pro", renewsAt: at } } } as never);
  const openPage = vi.fn(async () => ({ opened: true })), openDashboard = vi.fn(async () => {});
  (window as unknown as { duskDesktop: Record<string, unknown> }).duskDesktop.cloudAccount = { openPage, openDashboard };
  await act(async () => { root.render(createElement(AccountsSheet, { onClose: vi.fn() })); });
  const card = host.querySelector<HTMLElement>("[data-accounts-active]")!;
  expect(card.querySelector("img")?.getAttribute("src")).toBe("https://photos.example.test/ada.png");
  expect(card.textContent).toContain("Ada Lovelace");
  expect(card.textContent).toContain("a@example.test");
  expect(card.querySelector("[data-accounts-plan]")?.textContent).toBe("dusk cloud · Pro, renews Dec 14");
  expect(card.textContent).not.toContain("Signed in as");
  await act(async () => { button("Manage account")!.click(); });
  expect(openPage).toHaveBeenCalledWith("account");
  expect(openDashboard).not.toHaveBeenCalled();
  expect(button("Sign out")).toBeDefined();
});

it("without a photo or a name the card shows the address's initial; a photo that fails to load falls back to the initials", async () => {
  bridge.list.mockResolvedValueOnce({ active: { id: "a", email: "zed@example.test", plan: { status: "free" } } } as never);
  await act(async () => { root.render(createElement(AccountsSheet, { onClose: vi.fn() })); });
  const card = host.querySelector<HTMLElement>("[data-accounts-active]")!;
  expect(card.querySelector("img")).toBeNull();
  expect(card.textContent).toContain("Z");
  expect(card.querySelector("[data-accounts-plan]")?.textContent).toBe("Free");
  act(() => root.unmount());
  root = createRoot(host);
  bridge.list.mockResolvedValueOnce({ active: { id: "a", email: "zed@example.test", name: "Zed Ward", avatarUrl: "https://photos.example.test/gone.png" } } as never);
  await act(async () => { root.render(createElement(AccountsSheet, { onClose: vi.fn() })); });
  await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(host.querySelector("[data-accounts-active] img")).toBeNull();
  expect(host.querySelector("[data-accounts-active]")!.textContent).toContain("ZW");
});

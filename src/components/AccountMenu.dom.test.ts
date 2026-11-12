// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/places", () => ({ usePlaces: () => ({ beside: true, places: [] }) }));
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
  expect(dialog()?.textContent).toContain("sign out of dusk cloud?");
  expect(dialog()?.textContent).toContain("Your plan and your cloud bots keep going.");
  expect(dialog()?.querySelector("svg, canvas, img, [data-pixel-icon]")).not.toBeNull();
  await act(async () => { button("Cancel")?.click() ?? button("cancel")!.click(); });
  expect(dialog()).toBeNull();
  expect(bridge.signOut).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-accounts-sign-out]")!.click(); });
  const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === "sign out")!;
  await act(async () => { confirm.click(); });
  expect(bridge.signOut).toHaveBeenCalledWith("a");
});

it("the You menu and settings sign out through the same question", async () => {
  let access: ReturnType<typeof useAccounts> | null = null;
  function Probe() { access = useAccounts(); return access.signOutConfirm as never; }
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { access!.signOut("a"); });
  expect(bridge.signOut).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain("sign out of dusk cloud?");
  const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === "sign out")!;
  await act(async () => { confirm.click(); });
  expect(bridge.signOut).toHaveBeenCalledWith("a");
  expect(dialog()).toBeNull();
});

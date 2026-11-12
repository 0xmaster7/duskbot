// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  session: { account: { id: "acct_a", email: "current@duskbot.test" } as { id: string; email: string } | null },
  api: { handoff: async (_token: string, _opts?: { confirm?: boolean; replace?: boolean }): Promise<{ account: unknown; next: string } | { ask: "confirm" | "other_account"; email: string }> => ({ account: {}, next: "/billing?plan=pro&src=app_computer_move" }) },
  left: [] as string[],
}));
vi.mock("../data/session", () => ({ useSession: () => state.session }));
vi.mock("../lib/api", () => ({ api: state.api, ApiError: class extends Error { status = 410 } }));
vi.mock("../data/handoff", async (original) => ({ ...await original<typeof import("../data/handoff")>(), leaveHandoff: (path: string) => void state.left.push(path) }));

const token = "T".repeat(43);
const roots: Root[] = [];
beforeEach(() => { state.left = []; });
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function land(hash: string) {
  history.replaceState(null, "", `/handoff${hash}`);
  const { stashHandoff } = await import("../data/handoff");
  stashHandoff();
  const { HandoffPage } = await import("./Handoff");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(HandoffPage)));
  return host;
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label)) ?? null;

test("takes the token out of the address bar before rendering; the same account signed in goes straight to the plan", async () => {
  const handoff = vi.spyOn(state.api, "handoff");
  await land(`#t=${token}`);
  expect(location.hash).toBe("");
  expect(location.href).not.toContain(token);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledWith(token, {});
  expect(state.left).toEqual(["/billing?plan=pro&src=app_computer_move"]);
});

test("signed out: asks first, then confirms once with the same token", async () => {
  const handoff = vi.spyOn(state.api, "handoff").mockResolvedValueOnce({ ask: "confirm", email: "owner@duskbot.test" });
  const host = await land(`#t=${token}`);
  expect(state.left).toEqual([]);
  expect(button(host, "continue to checkout as owner@duskbot.test")).not.toBeNull();
  await act(async () => button(host, "continue to checkout as")!.click());
  expect(handoff).toHaveBeenLastCalledWith(token, { confirm: true });
  expect(state.left).toEqual(["/billing?plan=pro&src=app_computer_move"]);
});

test("another account in this browser: asks first, then switches with replace; not you? goes to sign in", async () => {
  const handoff = vi.spyOn(state.api, "handoff").mockResolvedValueOnce({ ask: "other_account", email: "owner@duskbot.test" });
  let host = await land(`#t=${token}`);
  expect(host.textContent).toContain("this browser is signed in as current@duskbot.test");
  await act(async () => button(host, "continue to checkout as")!.click());
  expect(handoff).toHaveBeenLastCalledWith(token, { confirm: true, replace: true });
  expect(state.left).toEqual(["/billing?plan=pro&src=app_computer_move"]);
  state.left = [];
  handoff.mockResolvedValueOnce({ ask: "other_account", email: "owner@duskbot.test" });
  host = await land(`#t=${token}`);
  await act(async () => button(host, "not you? sign in")!.click());
  expect(state.left).toEqual(["/sign-in"]);
});

test("a used or unknown link says so plainly; a malformed fragment is stripped and never sent", async () => {
  const handoff = vi.spyOn(state.api, "handoff").mockRejectedValueOnce(Object.assign(new Error("Sign-in has expired."), { status: 410 }));
  let host = await land(`#t=${token}`);
  expect(host.querySelector("h2")?.textContent).toBe("that link has expired");
  handoff.mockClear();
  host = await land("#t=short");
  expect(location.hash).toBe("");
  expect(handoff).not.toHaveBeenCalled();
});

test("a next that is not the plans page is never followed", async () => {
  const { handoffNext } = await import("../data/handoff");
  expect(handoffNext("/billing?plan=plus&src=app_card")).toBe("/billing?plan=plus&src=app_card");
  for (const bad of ["//evil.test", "https://evil.test/billing", "/billing/../account", "/account", null]) expect(handoffNext(bad)).toBe("/");
});

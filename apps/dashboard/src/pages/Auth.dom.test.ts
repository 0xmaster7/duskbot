// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  session: { setAccount: (_account: unknown) => {} },
  api: {
    authProviders: async () => ({ providers: [{ id: "google", enabled: true }, { id: "apple", enabled: true }] }),
    start: async (_email: string, _intent?: string, _pending?: string, _recover?: boolean) => ({ attempt: "a".repeat(43), resendAfter: 30, expiresIn: 600, codeLength: 8 }),
    verify: async (_attempt: string, _code: string) => ({ account: { id: "acct", email: "sid@duskbot.test" }, created: false }),
    oauthUrl: () => "/v1/auth/oauth/google/start",
  },
}));
vi.mock("../data/session", () => ({ useSession: () => state.session }));
vi.mock("../lib/api", () => ({ api: state.api, FIXTURE: null, ApiError: class extends Error { code?: string } }));

const roots: Root[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function render() {
  const { AuthScreen } = await import("./Auth");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(AuthScreen, { mode: "signin" })));
  return host;
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) ?? null;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("Can't sign in? asks for the address, sends a recovery start and says what was sent without telling whether an account exists", async () => {
  history.replaceState(null, "", "/sign-in");
  const start = vi.spyOn(state.api, "start");
  const host = await render();
  await act(async () => button(host, "Can't sign in?")!.click());
  expect(host.querySelector("h1")?.textContent).toBe("Can't sign in?");
  expect(host.textContent).toContain("Lost access to that email?");
  expect(host.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')?.href).toBe("mailto:hello@dusk.bot");
  await type(host.querySelector<HTMLInputElement>("#recover-email")!, "sid@duskbot.test");
  await act(async () => button(host, "Email me a sign-in link")!.click());
  expect(start).toHaveBeenCalledWith("sid@duskbot.test", "signin", undefined, true);
  expect(host.textContent).toContain("If an account uses sid@duskbot.test, we sent a link and a 8-digit code.");
  await act(async () => button(host, "Use another email")!.click());
  expect(host.querySelector("h1")?.textContent).toBe("Can't sign in?");
});

test("the emailed link waits for a click, signs in once, and leaves the address bar", async () => {
  const attempt = "b".repeat(43);
  history.replaceState(null, "", `/sign-in?next=/account#attempt=${attempt}&code=12345678`);
  const verify = vi.spyOn(state.api, "verify");
  const host = await render();
  expect(location.hash).toBe("");
  expect(location.pathname + location.search).toBe("/sign-in?next=/account");
  expect(verify).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Sign in to Dusk Bot");
  await act(async () => button(host, "Sign in")!.click());
  expect(verify).toHaveBeenCalledWith(attempt, "12345678");
});

test("a malformed link is ignored and the page starts at sign-in", async () => {
  history.replaceState(null, "", "/sign-in#attempt=short&code=12");
  const host = await render();
  expect(host.querySelector("h1")?.textContent).toBe("Sign in to Dusk Bot");
  expect(button(host, "Continue")).not.toBeNull();
});

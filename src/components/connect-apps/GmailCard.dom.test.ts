// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppPage, type AppPageModel } from "./AppPage";
import type { ConnectorPhase, Connectors } from "./use-connectors";
import type { ViaFlow } from "./via-flow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GMAIL = { slug: "gmail", label: "Gmail", blurb: "Email from Google", logo: null, domain: "mail.google.com" };

function connectorsWith(over: Partial<Connectors> = {}): Connectors {
  return {
    cards: [GMAIL], ready: true, configured: true, mode: "managed", setup: "ready", stale: false, phase: "ready",
    status: {}, error: null, aliasFor: null, setupFor: null, keyFor: null, via: null, viaApps: {}, viaFlow: {},
    viaRoute: () => false, authorizeComposio: vi.fn(async () => {}), reopenVia: vi.fn(), checkVia: vi.fn(), setError: vi.fn(),
    askAlias: vi.fn(), askKey: vi.fn(), phaseOf: () => ({ kind: "connect" }), isConnected: () => false,
    connect: vi.fn(async () => {}), cancel: vi.fn(), continueAfterKey: vi.fn(async () => {}), resume: vi.fn(),
    disconnect: vi.fn(async () => true), reload: vi.fn(),
    ...over,
  } as Connectors;
}

function model(connectors: Connectors, phase: ConnectorPhase, over: Partial<AppPageModel> = {}): AppPageModel {
  return {
    entry: { id: "gmail", kind: "composio", label: "Gmail", description: "Email from Google", categories: ["communication"], icon: { glyph: "envelope" } },
    composioSlug: "gmail", ways: [], connection: "disconnected", phase, card: GMAIL, connectors, categoryLabel: "Communication",
    usedBy: [], remoteClient: false, onOpenLogins: vi.fn(), onOpenKeys: vi.fn(),
    toolkit: { slug: "gmail", name: "Gmail", description: "Email from Google", category: "email", tools: 63 },
    ...over,
  } as AppPageModel;
}

let root: Root;
const render = async (page: AppPageModel) => {
  await act(async () => { root.render(createElement(AppPage, { model: page })); });
};
const card = () => document.querySelector<HTMLElement>("[data-gmail-card]")!;
// every main button on the page, wherever it sits: the card's is the only one
const primaries = () => [...document.querySelectorAll<HTMLButtonElement>("[data-app-page] .ca-primary")];
const shown = (button: HTMLButtonElement) => button.querySelector("span:not([aria-hidden])")?.textContent;
const line = () => card().querySelector("[data-gmail-line]");
const said = () => line()?.querySelector("span")?.textContent;

beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("Gmail connects on one card", () => {
  it("idle: the promise, how the sign-in goes, and one Connect Gmail button; no step list, no tool list", async () => {
    const connectors = connectorsWith();
    await render(model(connectors, { kind: "connect" }));
    expect(card().getAttribute("data-state")).toBe("idle");
    expect(card().textContent).toContain("Read and draft first. Nothing is sent without your OK.");
    expect(card().textContent).toContain("You sign in with Google on its own page. Your password never reaches dusk.");
    expect(primaries()).toHaveLength(1);
    expect(card().contains(primaries()[0]!)).toBe(true);
    expect(shown(primaries()[0]!)).toBe("Connect Gmail");
    expect(document.querySelector("[data-composio-key]")).toBeNull();
    expect(document.querySelector("[data-toolkit-group]")).toBeNull();
    expect(line()).toBeNull();
    await act(async () => { primaries()[0]!.click(); });
    expect(connectors.connect).toHaveBeenCalledWith("gmail");
  });

  it("connecting: the button says so, Cancel sits beside it, and a page left open says to finish there", async () => {
    const connectors = connectorsWith();
    await render(model(connectors, { kind: "connecting" }));
    expect(card().getAttribute("data-state")).toBe("connecting");
    expect(primaries()[0]!.disabled).toBe(true);
    expect(shown(primaries()[0]!)).toBe("Connecting…");
    await act(async () => { card().querySelector<HTMLButtonElement>("[data-cancel]")!.click(); });
    expect(connectors.cancel).toHaveBeenCalledWith("gmail");

    await render(model(connectors, { kind: "continue", url: null }));
    expect(card().getAttribute("data-state")).toBe("connecting");
    expect(shown(primaries()[0]!)).toBe("Open page again");
    expect(line()?.getAttribute("role")).toBe("status");
    expect(said()).toBe("Finish signing in on the page that opened. This updates by itself.");
    await act(async () => { primaries()[0]!.click(); });
    expect(connectors.resume).toHaveBeenCalledWith("gmail");
  });

  it("connected: a check and what bots can do now, nothing left to click on the card", async () => {
    const connectors = connectorsWith({ status: { gmail: { connected: true, accounts: [{ id: "ca_1", status: "ACTIVE" }] } } as Connectors["status"] });
    await render(model(connectors, { kind: "connected" }, { connection: "connected" }));
    expect(card().getAttribute("data-state")).toBe("connected");
    expect(card().querySelector(".ca-primary")).toBeNull();
    expect(card().querySelector(".ca-added")?.textContent).toContain("Connected");
    expect(said()).toBe("Connected. Your bots can read your email and draft replies now.");
    expect(document.querySelector("[data-accounts]"), "the account stays manageable below").not.toBeNull();
  });

  it("error: an expired sign-in says so and the one button reconnects it", async () => {
    const account = { id: "ca_1", alias: "work", status: "EXPIRED" } as never;
    const connectors = connectorsWith();
    await render(model(connectors, { kind: "reconnect", account }));
    expect(card().getAttribute("data-state")).toBe("error");
    expect(line()?.getAttribute("role")).toBe("alert");
    expect(said()).toBe("Your Gmail sign-in expired. Reconnect to keep using it.");
    expect(primaries()).toHaveLength(1);
    expect(shown(primaries()[0]!)).toBe("Reconnect");
    await act(async () => { primaries()[0]!.click(); });
    expect(connectors.connect).toHaveBeenCalledWith("gmail", "work", account);
  });

  describe("through Composio Connect, the same card and one button the whole way", () => {
    const via = (signedIn: boolean, flow?: ViaFlow) => connectorsWith({
      configured: false, mode: "unavailable", setup: "needs-setup", viaRoute: () => true,
      via: { added: signedIn, name: signedIn ? "composio-connect" : null, signedIn, enabled: signedIn } as Connectors["via"],
      viaFlow: flow ? { gmail: flow } : {},
    });

    it("the first click signs in to Composio, said as Connect Gmail, with a way to use your own key", async () => {
      const connectors = via(false);
      const page = model(connectors, { kind: "connect" });
      await render(page);
      expect(primaries()).toHaveLength(1);
      expect(shown(primaries()[0]!)).toBe("Connect Gmail");
      expect(card().textContent).toContain("You sign in to Composio once, then to Google.");
      await act(async () => { primaries()[0]!.click(); });
      expect(connectors.authorizeComposio).toHaveBeenCalledWith("gmail");
      const own = [...card().querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use my own Composio API key")!;
      await act(async () => { own.click(); });
      expect(page.onOpenKeys).toHaveBeenCalled();
    });

    it("authorizing waits on Composio's page; then the same button connects Gmail", async () => {
      await render(model(via(false, { step: "authorizing" }), { kind: "connect" }));
      expect(card().getAttribute("data-state")).toBe("connecting");
      expect(shown(primaries()[0]!)).toBe("Waiting for Composio…");

      const connectors = via(true);
      await render(model(connectors, { kind: "connect" }));
      expect(card().getAttribute("data-state")).toBe("idle");
      expect(said()).toBe("Composio is ready. Now pick your Google account.");
      expect(shown(primaries()[0]!)).toBe("Connect Gmail");
      await act(async () => { primaries()[0]!.click(); });
      expect(connectors.connect).toHaveBeenCalledWith("gmail");
    });

    it("a failed sign-in says what happened, and Retry starts it again", async () => {
      const connectors = via(true, { step: "failed", why: "cancelled" });
      await render(model(connectors, { kind: "failed", why: "cancelled" }));
      expect(card().getAttribute("data-state")).toBe("error");
      expect(line()?.getAttribute("role")).toBe("alert");
      expect(said()).toBe("The sign-in page closed before Gmail connected.");
      expect(primaries()).toHaveLength(1);
      expect(shown(primaries()[0]!)).toBe("Retry");
      await act(async () => { primaries()[0]!.click(); });
      expect(connectors.connect).toHaveBeenCalledWith("gmail");
    });

    it("done: connected, with no button left", async () => {
      await render(model(via(true, { step: "done" }), { kind: "connected" }, { connection: "connected" }));
      expect(card().getAttribute("data-state")).toBe("connected");
      expect(primaries()).toHaveLength(0);
      expect(said()).toBe("Connected. Your bots can read your email and draft replies now.");
    });
  });

  it("other apps keep their own page: no Gmail card", async () => {
    const connectors = connectorsWith();
    const page = model(connectors, { kind: "connect" }, {
      entry: { id: "slack", kind: "composio", label: "Slack", description: "Chat", categories: ["communication"], icon: { glyph: "envelope" } },
      composioSlug: "slack", card: { ...GMAIL, slug: "slack", label: "Slack" }, toolkit: undefined,
    });
    await render(page);
    expect(document.querySelector("[data-gmail-card]")).toBeNull();
    expect(document.querySelector("[data-app-page] .ca-detail-header .ca-primary")?.textContent).toContain("Connect Slack");
  });
});

// @vitest-environment happy-dom
// Real store + setup components; every request is synthetic and stays in-process.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StoreProvider, useStore, type InstanceInfo } from "./store";
import { EngineCard, engineReady } from "../components/EngineLibrary";
import { EngineSetup } from "../components/EngineSetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("recovers from a failed install, installs, signs in and becomes ready on focus without remounting", async () => {
  let snapshot: InstanceInfo["snapshot"] = { state: "unavailable", reason: "Fixture CLI missing" };
  let offline = false;
  const listed = () => ({ instances: [{
    instanceId: "kimi", driverKind: "kimiAgent", displayName: "Kimi", models: { default: "fixture", options: [] }, snapshot,
    install: { platform: "linux", command: { linux: "fixture-install" }, signInCommand: "fixture-login", server: { package: "kimi-fixture" } },
  }] });
  const requests = vi.fn(async (path: string) => {
    if (path === "/api/instances/kimi/install") {
      if (offline) return new Response(JSON.stringify({ error: "Fixture offline" }), { status: 503 });
      snapshot = { state: "available", authenticated: false, version: "1.0.0" };
      return new Response(JSON.stringify(listed()));
    }
    if (path.split("?")[0] === "/api/instances" || path === "/api/instances/kimi/refresh-models") return new Response(JSON.stringify(listed()));
    return new Response(JSON.stringify(path.startsWith("/api/bots?") ? { bots: [], groups: [] } : {}));
  });
  vi.stubGlobal("fetch", requests);
  vi.stubGlobal("EventSource", undefined);
  let controls!: ReturnType<typeof useStore>;
  function Preview() {
    controls = useStore();
    const { state } = controls;
    const instance = state.instances.find((value) => value.instanceId === "kimi");
    if (!instance) return null;
    return createElement(EngineCard, { instance, children: engineReady(instance)
      ? createElement("p", null, "Ready to use") : createElement(EngineSetup, { instance }) });
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const press = async (name: string) => act(async () => {
    Array.from(host.querySelectorAll("button")).find((node) => node.textContent === name)!.click();
  });
  try {
    await act(async () => root.render(createElement(StoreProvider, null, createElement(Preview))));
    await act(async () => controls.refreshInstances({ reportErrors: true }));
    const card = host.querySelector("details")!;
    card.open = true;
    expect(host.textContent).toContain("Set up Kimi");
    expect(host.textContent).not.toContain("fixture-install");
    offline = true;
    await press("Install Kimi here");
    expect(host.textContent).toContain("Kimi couldn't be installed on the computer your bots run on. Try again in a moment.");
    expect(host.textContent).not.toContain("Fixture offline");
    offline = false;
    await press("Try again");
    expect(host.textContent).toContain("Sign in to Kimi");
    expect(host.textContent).toContain("Sign-in required");
    expect(host.querySelector("details")).toBe(card);
    expect(card.open).toBe(true);
    snapshot = { state: "available", authenticated: true, version: "1.0.0" };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.textContent).toContain("Ready to use");
    expect(host.querySelector("details")).toBe(card);
    expect(card.open).toBe(true);
  } finally {
    act(() => root.unmount()); host.remove();
  }
});

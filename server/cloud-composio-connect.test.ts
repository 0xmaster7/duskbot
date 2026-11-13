import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudComposioConnect, type CloudComposioConnectDeps } from "./cloud-composio-connect.ts";
import { COMPOSIO_CONNECT_URL, type AppConnection } from "./composio-connect.ts";
import { dashboardApps } from "./dashboard-apps.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function cloud(answers: Record<string, AppConnection> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "dusk-cloud-connect-"));
  dirs.push(dataDir);
  const servers: Record<string, unknown> = {};
  const state = { signedIn: false, signIns: 0, asked: [] as string[] };
  const deps: CloudComposioConnectDeps = {
    dataDir, servers: () => servers,
    add: (name, url) => { servers[name] = { type: "http", url, enabled: true }; },
    enable: () => {},
    signedIn: () => state.signedIn,
    withToken: async (_name, server) => ({ type: "http", url: server.url } as never),
    startSignIn: async () => { state.signIns++; return { authorizationUrl: `https://connect.composio.dev/oauth/authorize?client_id=c&state=st${state.signIns}` }; },
    manage: async (_spec, slug, _signal, action) => { state.asked.push(`${action}:${slug}`); return answers[`${action}:${slug}`] ?? { status: "none" }; },
  };
  return { connect: createCloudComposioConnect(deps), state, servers };
}

describe("connecting an app on a dusk cloud with no Composio key", () => {
  it("first time: Composio's own sign-in, and its callback sends the same tab on to the app's page", async () => {
    const c = cloud({ "add:gmail": { status: "started", url: "https://connect.composio.dev/link/lk_1" } });
    expect(await c.connect.connect("gmail")).toEqual({ url: "https://connect.composio.dev/oauth/authorize?client_id=c&state=st1" });
    expect(Object.values(c.servers)).toEqual([{ type: "http", url: COMPOSIO_CONNECT_URL, enabled: true }]);
    expect(await c.connect.afterSignIn("?code=x&state=nope")).toBeNull();
    c.state.signedIn = true;
    expect(await c.connect.afterSignIn("?code=x&state=st1")).toBe("https://connect.composio.dev/link/lk_1");
    // each state sends a tab on once
    expect(await c.connect.afterSignIn("?code=x&state=st1")).toBeNull();
  });

  it("once signed in: straight to the app's own sign-in page", async () => {
    const c = cloud({ "add:gmail": { status: "started", url: "https://connect.composio.dev/link/lk_2" } });
    c.state.signedIn = true;
    expect(await c.connect.connect("Gmail")).toEqual({ url: "https://connect.composio.dev/link/lk_2" });
    expect(c.state.signIns).toBe(0);
  });

  it("says why when Composio cannot hand back a page dusk bot trusts", async () => {
    const c = cloud({ "add:gmail": { status: "started", url: "https://evil.example/link" }, "add:slack": { status: "connected" }, "add:notion": { status: "failed", message: "Toolkit is not available." } });
    c.state.signedIn = true;
    await expect(c.connect.connect("gmail")).rejects.toMatchObject({ status: 502 });
    await expect(c.connect.connect("slack")).rejects.toMatchObject({ status: 409, message: "slack is connected already." });
    await expect(c.connect.connect("notion")).rejects.toMatchObject({ message: "Toolkit is not available." });
  });

  it("reports the apps connected this way to the dashboard", async () => {
    const c = cloud({ "add:gmail": { status: "started", url: "https://connect.composio.dev/link/lk_3" }, "list:gmail": { status: "connected" } });
    expect(await c.connect.apps()).toBeNull();
    c.state.signedIn = true;
    await c.connect.connect("gmail");
    const source = { connectorAvailability: () => "unconfigured" as const, connectedServicesInventory: async () => { throw new Error("unused"); } };
    expect(await dashboardApps({} as never, source, () => c.connect.apps())).toEqual({ available: true, complete: true, services: [{ slug: "gmail", connected: true, pending: false }] });
    expect(await dashboardApps({} as never, source)).toEqual({ available: false, complete: true, services: [] });
  });
});

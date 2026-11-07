import type { ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { requiredScope } from "../request-auth.ts";
import * as vps from "../vps-computer.ts";
import { createComputerUsageRoutes } from "./computer-usage.ts";
import { PASS, type RouteContext } from "./table.ts";

vi.mock("../vps-computer.ts", () => ({ listManagedVpsComputers: vi.fn() }));
const list = vi.mocked(vps.listManagedVpsComputers);
beforeEach(() => list.mockReset());

async function usage(cfg: AppConfig, changing = false) {
  let sent: unknown;
  const handler = createComputerUsageRoutes({
    cfg, store: { bots: [{ vpsAlias: "bot-vps" }] }, managedVpsOwners: () => [],
    teamComputers: { list: () => [] }, computerProviderConfigTransitions: new Set(changing ? ["vps" as const] : []),
  });
  await handler({
    res: { setHeader: () => {} } as unknown as ServerResponse, path: "/api/computers/usage", method: "GET",
    json: ((_res: ServerResponse, _status: number, body: unknown) => { sent = body; }) as RouteContext["json"],
  } as RouteContext);
  return sent;
}

describe("GET /api/computers/usage", () => {
  it("retains owner-only scope and answers only its own path", async () => {
    expect(requiredScope("GET", "/api/computers/usage")).toBe("admin");
    const handler = createComputerUsageRoutes({ cfg: {}, store: { bots: [] }, managedVpsOwners: () => [], teamComputers: { list: () => [] }, computerProviderConfigTransitions: new Set() });
    expect(await handler({ path: "/api/other", method: "GET" } as RouteContext)).toBe(PASS);
  });
  it("counts across the workspace and bot aliases without exposing identities", async () => {
    list.mockResolvedValue({ configured: true, available: true, vpsAliases: [], problem: null, instances: [
      { name: "private-container", state: "running", vpsAlias: "main-vps", ownerBotId: "private-id", ownerName: "Private", orphaned: false, inUse: false },
    ] });
    expect(await usage({ vps: { sshAlias: "main-vps" } })).toEqual({ cloudComputers: 1, teamComputers: 0 });
    expect(list).toHaveBeenCalledWith({ vps: { sshAlias: "main-vps" } }, [], undefined, ["main-vps", "bot-vps"]);
  });
  it("returns unknown without inspecting during a VPS configuration change", async () => {
    expect(await usage({ vps: { sshAlias: "main-vps" } }, true)).toEqual({ cloudComputers: null, teamComputers: 0 });
    expect(list).not.toHaveBeenCalled();
  });
  it("returns unknown when the inventory is unavailable", async () => {
    list.mockResolvedValue({ configured: true, available: false, vpsAliases: [], problem: "Offline", instances: [] });
    expect(await usage({})).toEqual({ cloudComputers: null, teamComputers: 0 });
  });
});

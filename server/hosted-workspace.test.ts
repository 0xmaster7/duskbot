import { describe, expect, it } from "vitest";
import { hostedWorkspaceConfiguration, hostedWorkspaceConfigured, workspaceMembership } from "./hosted-workspace.ts";

const env = { OMB_ADMIN_URL: "https://admin.example.test", OMB_ADMIN_WORKSPACE: "acme", OMB_PUBLIC_URL: "https://acme.example.test" };

describe("hosted workspace configuration", () => {
  it("marks partial configuration as hosted", () => {
    expect(hostedWorkspaceConfigured({})).toBe(false);
    expect(hostedWorkspaceConfigured({ OMB_PUBLIC_URL: env.OMB_PUBLIC_URL })).toBe(false);
    for (const partial of [{ OMB_ADMIN_URL: "" }, { OMB_ADMIN_WORKSPACE: "acme" }, { OMB_ADMIN_MEMBERSHIP: "portal" }]) {
      expect(hostedWorkspaceConfigured(partial)).toBe(true);
      expect(workspaceMembership(partial).pairingCodes).toBe(false);
    }
  });

  it("requires complete valid HTTPS origins and an explicit membership mode", () => {
    expect(hostedWorkspaceConfiguration(env)?.portalMembership).toBe(false);
    expect(hostedWorkspaceConfiguration({ ...env, OMB_ADMIN_MEMBERSHIP: "portal" })?.portalMembership).toBe(true);
    expect(hostedWorkspaceConfiguration({ ...env, OMB_ADMIN_MEMBERSHIP: "local" })?.portalMembership).toBe(false);
    for (const patch of [{ OMB_ADMIN_URL: "" }, { OMB_ADMIN_URL: "https://admin.example.test/path" }, { OMB_PUBLIC_URL: "http://acme.example.test" }, { OMB_ADMIN_WORKSPACE: "" }, { OMB_ADMIN_MEMBERSHIP: "PORTAL" }]) {
      expect(hostedWorkspaceConfiguration({ ...env, ...patch })).toBeNull();
    }
  });

  it("keeps portal membership links and standalone pairing", () => {
    expect(workspaceMembership({})).toEqual({ authority: "local", pairingCodes: true });
    expect(workspaceMembership(env)).toEqual({ authority: "local", pairingCodes: false });
    expect(workspaceMembership({ ...env, OMB_ADMIN_MEMBERSHIP: "portal" })).toEqual({ authority: "portal", pairingCodes: false, peopleUrl: "https://admin.example.test/people?workspace=acme" });
  });
});

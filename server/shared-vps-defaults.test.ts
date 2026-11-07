import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR, loadConfig, mergeVpsConfig, normalizeVpsConfig, parseConfigPatch, parseStoredConfig, saveConfig } from "./config.ts";
import type { JsonValue } from "./schema.ts";
import { sharedVpsDefaults, vpsIdleTimeoutMinutes } from "./shared-vps-defaults.ts";

const personal = { cloudTeam: false, hostedWorkspace: false, sharedMembership: false };
const path = join(DATA_DIR, "config.json");
afterEach(() => rmSync(path, { force: true }));

describe("personal workspace computer defaults", () => {
  it("defaults to one shared desktop, automatic start, and ten-minute idle stop", () => {
    expect(sharedVpsDefaults({}, personal)).toEqual({ mode: "shared", sharingAllowed: true, workspaceShared: true, autoStart: true, independentScreens: false, idleTimeoutMinutes: 10 });
    expect(vpsIdleTimeoutMinutes({})).toBe(10);
  });
  it.each([
    { cloudTeam: true, hostedWorkspace: false, sharedMembership: false },
    { cloudTeam: false, hostedWorkspace: true, sharedMembership: false },
    { cloudTeam: false, hostedWorkspace: false, sharedMembership: true },
    { cloudTeam: true, hostedWorkspace: true, sharedMembership: true },
  ])("never implicitly shares desktops across hosted or membership boundaries: %o", (privacy) => {
    expect(sharedVpsDefaults({ vps: { mode: "shared" } }, privacy)).toMatchObject({ mode: "shared", workspaceShared: false, sharingAllowed: false });
  });
  it("keeps private mode and explicit manual power preferences", () => {
    expect(sharedVpsDefaults({ vps: { mode: "per-bot", autoStart: false, idleTimeoutMinutes: 0 } }, personal)).toEqual({
      mode: "per-bot", workspaceShared: false, sharingAllowed: true, autoStart: false, independentScreens: false, idleTimeoutMinutes: 0,
    });
  });
});

describe("VPS preferences and existing host configuration", () => {
  it.each([0, 5, 10, 30] as const)("accepts the supported idle duration %i", (idleTimeoutMinutes) => {
    const vps = { sshAlias: "existing-vps", mode: "shared" as const, autoStart: false, idleTimeoutMinutes };
    expect(parseConfigPatch({ vps })).toEqual({ vps });
    expect(parseStoredConfig({ vps }).vps).toEqual(vps);
  });
  it.each([
    { mode: "everyone" }, { mode: true }, { autoStart: "true" }, { autoStart: null }, { independentScreens: "true" },
    { idleTimeoutMinutes: -1 }, { idleTimeoutMinutes: 1 }, { idleTimeoutMinutes: 60 }, { idleTimeoutMinutes: "10" },
  ])("rejects malformed power or sharing preferences: %o", (vps) => {
    expect(() => parseConfigPatch({ vps } as unknown as JsonValue)).toThrow();
  });
  it("does not erase a saved host when only computer preferences change", () => {
    expect(mergeVpsConfig({ sshAlias: "existing-vps", mode: "per-bot", idleTimeoutMinutes: 30 }, { mode: "shared" })).toEqual({ sshAlias: "existing-vps", mode: "shared", idleTimeoutMinutes: 30 });
    expect(mergeVpsConfig({ sshAlias: "existing-vps", mode: "per-bot", autoStart: false }, { sshAlias: "next-vps" })).toEqual({ sshAlias: "next-vps", mode: "per-bot", autoStart: false });
    expect(mergeVpsConfig({ sshAlias: "existing-vps", mode: "per-bot" }, { sshAlias: "" })).toEqual({ mode: "per-bot" });
    expect(normalizeVpsConfig({ sshAlias: "existing-vps" })).toEqual({ sshAlias: "existing-vps" });
  });
  it("preserves alias and preferences through actual saves and reloads", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    saveConfig({ vps: { sshAlias: "existing-vps" } });
    saveConfig({ vps: { mode: "per-bot", autoStart: false, idleTimeoutMinutes: 5 } });
    expect(loadConfig().vps).toEqual({ sshAlias: "existing-vps", mode: "per-bot", autoStart: false, idleTimeoutMinutes: 5 });
    saveConfig({ vps: { sshAlias: "next-vps" } });
    expect(JSON.parse(readFileSync(path, "utf8")).vps).toEqual({ sshAlias: "next-vps", mode: "per-bot", autoStart: false, idleTimeoutMinutes: 5 });
    saveConfig({ vps: { sshAlias: "" } });
    expect(loadConfig().vps).toEqual({ mode: "per-bot", autoStart: false, idleTimeoutMinutes: 5 });
  });
});

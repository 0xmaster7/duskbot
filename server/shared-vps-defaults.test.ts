import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR, loadConfig, mergeVpsConfig, normalizeVpsConfig, parseConfigPatch, parseStoredConfig, saveConfig } from "./config.ts";
import type { JsonValue } from "./schema.ts";
import { initialVpsMode, sharedVpsDefaults, vpsIdleTimeoutMinutes } from "./shared-vps-defaults.ts";

const personal = { cloudTeam: false, hostedWorkspace: false, sharedMembership: false };
const path = join(DATA_DIR, "config.json");
afterEach(() => rmSync(path, { force: true }));

describe("personal workspace computer defaults", () => {
  it("defaults to one shared desktop, automatic start, and staged idle cleanup", () => {
    expect(sharedVpsDefaults({}, personal)).toEqual({ mode: "shared", sharingAllowed: true, workspaceShared: true, autoStart: true, independentScreens: true, maxScreens: 20, idleTimeoutMinutes: 10, lifecycle: { browserIdleMinutes: 180, screenIdleMinutes: 1440, computerIdleMinutes: 2880 } });
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
    expect(sharedVpsDefaults({ vps: { mode: "per-bot", autoStart: false, independentScreens: false, maxScreens: 20, idleTimeoutMinutes: 0 } }, personal)).toEqual({
      mode: "per-bot", workspaceShared: false, sharingAllowed: true, autoStart: false, independentScreens: false, maxScreens: 20, idleTimeoutMinutes: 0,
      lifecycle: { browserIdleMinutes: 0, screenIdleMinutes: 0, computerIdleMinutes: 0 },
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
  it.each([1, 7, 15, 20])("accepts a configured active screen capacity of %i", maxScreens => {
    expect(parseConfigPatch({ vps: { maxScreens } })).toEqual({ vps: { maxScreens } });
    expect(sharedVpsDefaults({ vps: { maxScreens } }, personal).maxScreens).toBe(maxScreens);
  });
  it.each([0, 21, -1, 1.5, "20"])("rejects invalid active screen capacity %j", maxScreens => {
    expect(() => parseConfigPatch({ vps: { maxScreens } } as unknown as JsonValue)).toThrow();
  });
  it("retains an explicit shared-screen choice and capacity through independent preference saves", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    saveConfig({ vps: { independentScreens: false, maxScreens: 15 } });
    saveConfig({ vps: { idleTimeoutMinutes: 5 } });
    const loaded = loadConfig();
    expect(sharedVpsDefaults(loaded, personal)).toMatchObject({ independentScreens: false, maxScreens: 15, idleTimeoutMinutes: 5 });
  });

});

describe("the first mode this version saves", () => {
  const evidence = { vpsConfigured: true, botsOnOwnComputers: true, workspaceComputerInUse: false };
  it("keeps an upgraded VPS with bots on their own computers per-bot", () => {
    expect(initialVpsMode({ vps: { sshAlias: "existing-vps" } }, evidence)).toBe("per-bot");
  });
  it.each([
    { vpsConfigured: false, botsOnOwnComputers: true, workspaceComputerInUse: false },
    { vpsConfigured: true, botsOnOwnComputers: false, workspaceComputerInUse: false },
    { vpsConfigured: false, botsOnOwnComputers: false, workspaceComputerInUse: false },
    { vpsConfigured: true, botsOnOwnComputers: true, workspaceComputerInUse: true },
  ])("gives a fresh install, or one already on the workspace computer, the shared default: %o", (fresh) => {
    expect(initialVpsMode({}, fresh)).toBe("shared");
  });
  it.each(["shared", "per-bot"] as const)("never overrides a saved %s choice", (mode) => {
    expect(initialVpsMode({ vps: { sshAlias: "existing-vps", mode } }, evidence)).toBeUndefined();
    expect(initialVpsMode({ vps: { mode } }, { ...evidence, vpsConfigured: false })).toBeUndefined();
  });
});

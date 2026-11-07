import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR, ensureDirs, loadConfig, saveConfig } from "./config.ts";
import { preserveVpsRouting } from "./vps-config-migration.ts";

const configFile = join(DATA_DIR, "config.json");
const botsFile = join(DATA_DIR, "bots.json");
afterEach(() => { rmSync(configFile, { force: true }); rmSync(botsFile, { force: true }); });

describe("VPS routing on app upgrade", () => {
  it("loads and preserves an existing alias as per-bot without altering private bot identities", () => {
    ensureDirs();
    writeFileSync(configFile, JSON.stringify({ vps: { sshAlias: "existing-vps" } }));
    const bots = JSON.stringify([{ id: "private-bot", computer: "cloud", cloudBackend: "vps" }]);
    writeFileSync(botsFile, bots);
    const config = loadConfig();
    preserveVpsRouting(config, DATA_DIR, false, saveConfig);
    expect(config.vps).toEqual({ sshAlias: "existing-vps", mode: "per-bot" });
    expect(loadConfig().vps).toEqual(config.vps);
    expect(readFileSync(botsFile, "utf8")).toBe(bots);
  });
  it("preserves a linked local VPS with existing VPS bot metadata", () => {
    ensureDirs();
    writeFileSync(configFile, "{}");
    writeFileSync(botsFile, JSON.stringify([{ id: "existing-bot", cloudBackend: "vps" }]));
    const config = loadConfig();
    preserveVpsRouting(config, DATA_DIR, true, saveConfig);
    expect(loadConfig().vps?.mode).toBe("per-bot");
  });
  it.each([false, true])("keeps a new workspace shared after adding its first bot and alias (linked %s)", linked => {
    ensureDirs();
    writeFileSync(configFile, "{}");
    const config = loadConfig();
    preserveVpsRouting(config, DATA_DIR, linked, saveConfig);
    writeFileSync(botsFile, JSON.stringify([{ id: "new-bot", cloudBackend: "vps" }]));
    saveConfig({ vps: { sshAlias: "new-vps" } });
    const reloaded = loadConfig();
    preserveVpsRouting(reloaded, DATA_DIR, linked, saveConfig);
    expect(reloaded.vps).toEqual({ mode: "shared", sshAlias: "new-vps" });
  });
  it.each(["shared", "per-bot"] as const)("does not rewrite an explicit %s preference", mode => {
    ensureDirs();
    const stored = JSON.stringify({ vps: { mode, sshAlias: "configured-vps", independentScreens: false } });
    writeFileSync(configFile, stored);
    const config = loadConfig();
    preserveVpsRouting(config, DATA_DIR, true, () => { throw new Error("must not save an explicit preference"); });
    expect(readFileSync(configFile, "utf8")).toBe(stored);
  });
});

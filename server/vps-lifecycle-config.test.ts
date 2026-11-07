import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR, loadConfig, mergeVpsConfig, normalizeVpsConfig, parseConfigPatch, parseStoredConfig, saveConfig } from "./config.ts";
import { vpsLifecyclePolicy } from "./vps-config.ts";
import type { JsonValue } from "./schema.ts";

const file = join(DATA_DIR, "config.json");
afterEach(() => rmSync(file, { force: true }));
describe("staged lifecycle policy and legacy preferences", () => {
  it("sleeps an idle desktop after ten minutes and its computer after fifteen without explicit choices", () => {
    expect(vpsLifecyclePolicy()).toEqual({ browserIdleMinutes: 10, screenIdleMinutes: 10, computerIdleMinutes: 15 });
  });
  it("reads a legacy 0 as unset, so a migrated config never silently disables sleep", () => {
    expect(vpsLifecyclePolicy({ idleTimeoutMinutes: 0 })).toEqual(vpsLifecyclePolicy());
  });
  it("keeps sleep off only for a stage explicitly set to 0", () => {
    expect(vpsLifecyclePolicy({ lifecycle: { browserIdleMinutes: 0, screenIdleMinutes: 0, computerIdleMinutes: 0 } })).toEqual({ browserIdleMinutes: 0, screenIdleMinutes: 0, computerIdleMinutes: 0 });
  });
  it("never ends an unset stage before an earlier stage set longer", () => {
    expect(vpsLifecyclePolicy({ lifecycle: { browserIdleMinutes: 180 } })).toEqual({ browserIdleMinutes: 180, screenIdleMinutes: 180, computerIdleMinutes: 180 });
  });
  it.each([5, 10, 30] as const)("preserves explicit legacy %i as equal stage deadlines", idleTimeoutMinutes => {
    expect(vpsLifecyclePolicy({ idleTimeoutMinutes })).toEqual({ browserIdleMinutes: idleTimeoutMinutes, screenIdleMinutes: idleTimeoutMinutes, computerIdleMinutes: idleTimeoutMinutes });
  });
  it("uses explicit nested fields over legacy values and keeps disabled stages out of ordering", () => {
    expect(vpsLifecyclePolicy({ idleTimeoutMinutes: 30, lifecycle: { browserIdleMinutes: 20, screenIdleMinutes: 0 } })).toEqual({ browserIdleMinutes: 20, screenIdleMinutes: 0, computerIdleMinutes: 30 });
    expect(normalizeVpsConfig({ lifecycle: { browserIdleMinutes: 180, screenIdleMinutes: 0, computerIdleMinutes: 180 } })).toMatchObject({ lifecycle: { screenIdleMinutes: 0 } });
  });
  it.each([-1, 43_201, 1.5, "180", null])("rejects malformed lifecycle minutes %j", browserIdleMinutes => {
    expect(() => parseConfigPatch({ vps: { lifecycle: { browserIdleMinutes } } } as unknown as JsonValue)).toThrow();
  });
  it("validates stage order independently of JSON property order", () => {
    expect(() => parseConfigPatch({ vps: { lifecycle: { computerIdleMinutes: 30, browserIdleMinutes: 60 } } })).toThrow();
    expect(parseConfigPatch({ vps: { lifecycle: { computerIdleMinutes: 60, browserIdleMinutes: 30 } } })).toMatchObject({ vps: { lifecycle: { browserIdleMinutes: 30 } } });
    expect(() => parseStoredConfig({ vps: { lifecycle: { browserIdleMinutes: 1500, screenIdleMinutes: 20 } } })).toThrow(/ordered/);
    expect(() => mergeVpsConfig({ lifecycle: { browserIdleMinutes: 180, screenIdleMinutes: 1440, computerIdleMinutes: 2880 } }, { lifecycle: { screenIdleMinutes: 10 } })).toThrow();
  });
  it("deeply merges one-field UI patches against the saved full schedule", () => {
    const current = { sshAlias: "kept-vps", lifecycle: { browserIdleMinutes: 1000, screenIdleMinutes: 2000, computerIdleMinutes: 3000 } };
    const patch = parseConfigPatch({ vps: { lifecycle: { browserIdleMinutes: 1500 } } }).vps!;
    expect(mergeVpsConfig(current, patch)).toEqual({ sshAlias: "kept-vps", lifecycle: { browserIdleMinutes: 1500, screenIdleMinutes: 2000, computerIdleMinutes: 3000 } });
  });
  it("round-trips nested preference patches through real config saves without erasing aliases or private mode", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    saveConfig({ vps: { sshAlias: "existing-vps", mode: "per-bot", idleTimeoutMinutes: 0 } });
    saveConfig({ vps: { lifecycle: { browserIdleMinutes: 180 } } });
    saveConfig({ vps: { lifecycle: { screenIdleMinutes: 1440 } } });
    saveConfig({ vps: { lifecycle: { computerIdleMinutes: 2880 } } });
    expect(loadConfig().vps).toEqual({ sshAlias: "existing-vps", mode: "per-bot", idleTimeoutMinutes: 0, lifecycle: { browserIdleMinutes: 180, screenIdleMinutes: 1440, computerIdleMinutes: 2880 } });
    expect(JSON.parse(readFileSync(file, "utf8")).vps).toEqual(loadConfig().vps);
  });
});

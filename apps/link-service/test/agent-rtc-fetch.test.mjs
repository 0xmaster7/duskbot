// a server installed before webrtc fetches node-datachannel for the app's link on its own: best effort, pinned, at most
// once every 6 hours, never when turned off
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRtc, RTC_VERSION } from "../agent.mjs";

const child = (code) => { const one = new EventEmitter(); setTimeout(() => one.emit("exit", code), 1); return one; };

describe("ensureRtc", () => {
  it("installs the pinned version into the agent's own folder, then waits 6 hours before trying again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omb-rtc-"));
    try {
      const runs = [];
      let now = 1_000, installed = false;
      const run = (command, args) => { runs.push({ command, args }); return child(0); };
      const lines = [];
      expect(await ensureRtc({ dir, run, now: () => now, log: (line) => lines.push(line), has: () => installed })).toBe(false);
      expect(runs).toHaveLength(1);
      expect(runs[0].args).toEqual(expect.arrayContaining(["install", "--prefix", dir, `node-datachannel@${RTC_VERSION}`, "--ignore-scripts", "--no-save"]));
      expect(lines.at(-1)).toMatch(/could not be fetched/);
      now += 60_000;
      expect(ensureRtc({ dir, run, now: () => now, log: () => {}, has: () => installed })).toBeNull();
      now += 6 * 60 * 60_000;
      installed = true;
      expect(ensureRtc({ dir, run, now: () => now, log: () => {}, has: () => installed })).toBeNull();
      expect(runs).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("pins the same version as the app and the installer", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
    const install = await readFile(new URL("../install.sh", import.meta.url), "utf8");
    expect(RTC_VERSION).toBe(pkg.dependencies["node-datachannel"]);
    expect(/^AGENT_RTC_VERSION=(\S+)$/m.exec(install)?.[1]).toBe(RTC_VERSION);
  });
});

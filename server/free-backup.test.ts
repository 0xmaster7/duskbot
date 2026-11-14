import { afterEach, describe, expect, it, vi } from "vitest";

import type { StandaloneRelease } from "./contracts.ts";
import { OPENCODE_STANDALONE } from "./drivers/acp/opencode-release.ts";
import type { StandaloneInstalled } from "./engine-standalone.ts";
import { PREINSTALL_FREE_BACKUP_ENV, preinstallFreeBackup, startFreeBackupPreinstall } from "./free-backup.ts";

const installed: StandaloneInstalled = { version: OPENCODE_STANDALONE.version, executablePath: "/data/tools/standalone/opencode/bin/opencode", binDir: "/data/tools/standalone/opencode/bin" };

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

describe("preinstalling OpenCode's free backup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downloads nothing when an OpenCode is already found", async () => {
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => true, install })).resolves.toEqual({ outcome: "present" });
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the pinned build into the data folder through the standalone installer", async () => {
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => false, install, baseDir: "/data" })).resolves.toEqual({ outcome: "installed" });
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(OPENCODE_STANDALONE, { baseDir: "/data" });
  });

  it("shares one download between overlapping starts, and the next start finds the copy and downloads nothing", async () => {
    let copy = false;
    const download = gate();
    const install = vi.fn(async () => { await download.opened; copy = true; return installed; });
    const deps = { present: () => copy, install };
    const first = preinstallFreeBackup(deps);
    const second = preinstallFreeBackup(deps);
    download.open();
    await expect(Promise.all([first, second])).resolves.toEqual([{ outcome: "installed" }, { outcome: "installed" }]);
    await expect(preinstallFreeBackup(deps)).resolves.toEqual({ outcome: "present" });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("reports a failed download instead of throwing, and tries again next time", async () => {
    const install = vi.fn(async (): Promise<StandaloneInstalled> => { throw new Error("OpenCode couldn't be installed. Try again."); });
    await expect(preinstallFreeBackup({ present: () => false, install })).resolves.toEqual({ outcome: "failed", error: "OpenCode couldn't be installed. Try again." });
    await preinstallFreeBackup({ present: () => false, install });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("skips a computer the release has no build for", async () => {
    const release: StandaloneRelease = { ...OPENCODE_STANDALONE, assets: {} };
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => false, install, release })).resolves.toEqual({ outcome: "unsupported" });
    expect(install).not.toHaveBeenCalled();
  });
});

describe("the preinstall at server start", () => {
  it("starts only when the server's starter asks for it", () => {
    const install = vi.fn(async () => installed);
    expect(startFreeBackupPreinstall({}, () => {}, { present: () => false, install })).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it("runs in the background: start returns before the download ends, and the engines are read again once it lands", async () => {
    const download = gate();
    const install = vi.fn(async () => { await download.opened; return installed; });
    const refreshed = vi.fn();
    const run = startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, refreshed, { present: () => false, install });
    expect(run).not.toBeNull();
    expect(refreshed).not.toHaveBeenCalled();
    download.open();
    await run;
    await Promise.resolve();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("reads the engines again only when a copy was added", async () => {
    const refreshed = vi.fn();
    await startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, refreshed, { present: () => true });
    await Promise.resolve();
    expect(refreshed).not.toHaveBeenCalled();
  });
});

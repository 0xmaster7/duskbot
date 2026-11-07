import { describe, expect, it, vi } from "vitest";
import { independentScreenTarget } from "./shared-desktop-screens.ts";
import {
  closeVpsScreenConnections,
  vpsBoxChrome,
  vpsComputerJoin,
  vpsComputerScreenshot,
  type VpsCommandRunner,
  type VpsScreenConnection,
} from "./vps-computer.ts";

const cfg = { vps: { sshAlias: "fixture-vps" } };
const ownerId = "computer_workspace";
const containerId = "a".repeat(64);

describe("reassigned independent screen connections", () => {
  it.each(["retired", "expired lease"])("refuses a %s screen before any transport operation", async reason => {
    const screen: VpsScreenConnection = { containerId, target: independentScreenTarget("old-bot", 2) };
    if (reason === "retired") closeVpsScreenConnections(ownerId, screen);
    else screen.live = () => false;
    const runner = vi.fn<VpsCommandRunner>().mockRejectedValue(new Error("transport must stay unused"));

    await expect(vpsComputerJoin(cfg, ownerId, runner, true, screen)).rejects.toMatchObject({ status: 409 });
    await expect(vpsComputerScreenshot(cfg, ownerId, runner, screen)).rejects.toMatchObject({ status: 409 });
    await expect(vpsBoxChrome(cfg, ownerId, containerId, runner, screen)).rejects.toMatchObject({ status: 409 });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not retire the next generation assigned to the same bot and display", async () => {
    const previous: VpsScreenConnection = { containerId, target: independentScreenTarget("same-bot", 2) };
    const current: VpsScreenConnection = { containerId, target: independentScreenTarget("same-bot", 2) };
    closeVpsScreenConnections(ownerId, previous);
    const offline = new Error("fixture transport offline");
    const runner = vi.fn<VpsCommandRunner>().mockRejectedValue(offline);

    await expect(vpsBoxChrome(cfg, ownerId, containerId, runner, previous)).rejects.toMatchObject({ status: 409 });
    expect(runner).not.toHaveBeenCalled();
    await expect(vpsBoxChrome(cfg, ownerId, containerId, runner, current)).resolves.toBeNull();
    expect(runner).toHaveBeenCalled();
  });

  it.each(["viewer", "browser"])("rejects a %s resolution retired during transport inspection", async kind => {
    const screen: VpsScreenConnection = { containerId, target: independentScreenTarget("waiting-bot", 3) };
    let entered!: () => void;
    let release!: () => void;
    const inspecting = new Promise<void>(resolve => { entered = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    const runner: VpsCommandRunner = async () => {
      entered();
      await finish;
      throw new Error("fixture transport offline");
    };
    const pending = kind === "viewer"
      ? vpsComputerJoin(cfg, ownerId, runner, true, screen)
      : vpsBoxChrome(cfg, ownerId, containerId, runner, screen);
    const rejected = expect(pending).rejects.toThrow(/reassigned/);
    try {
      await inspecting;
      closeVpsScreenConnections(ownerId, screen);
    } finally { release(); }
    await rejected;
  });
});

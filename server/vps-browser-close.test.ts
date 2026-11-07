import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { closeVpsBrowser } from "./vps-browser-close.ts";
import { independentScreenTarget } from "./shared-desktop-screens.ts";
import type { VpsCommandRunner } from "./vps-computer.ts";

const target = { ownerId: "owned-bot", sshAlias: "fixture-vps", containerId: "a".repeat(64) };

describe("idle browser close transport", () => {
  it("sends parseable Python only to the immutable container, with no browser launch or process signal", async () => {
    const run = vi.fn<VpsCommandRunner>().mockResolvedValue({ stdout: '{"closed":true}', stderr: "" });
    await closeVpsBrowser(target, () => true, undefined, run);
    const args = run.mock.calls[0]![0];
    expect(args.slice(0, 9)).toEqual(["-H", "ssh://fixture-vps", "exec", "-u", "1000:1000", target.containerId, "python3", "-I", "-c"]);
    const python = args.at(-1)!;
    expect(python).toContain('"method":"Browser.close"');
    expect(python).not.toMatch(/killpg|Popen|subprocess/);
    if (process.platform !== "win32") execFileSync("python3", ["-I", "-c", "import ast,sys;ast.parse(sys.stdin.read())"], { input: python });
  });
  it("uses only the pinned generation for an independent browser", async () => {
    const screen = independentScreenTarget("screen-bot", 5);
    const run = vi.fn<VpsCommandRunner>().mockResolvedValue({ stdout: "{}", stderr: "" });
    await closeVpsBrowser({ ...target, botId: screen.botId, screen }, () => true, undefined, run);
    expect(run.mock.calls[0]![0]).toEqual(["-H", "ssh://fixture-vps", "exec", "-u", "cua", target.containerId, "/usr/local/bin/omb-screen", "browser-close", "5", screen.botHash, screen.generation]);
  });
  it("refuses cancelled and malformed identities before any command", async () => {
    const run = vi.fn<VpsCommandRunner>();
    await expect(closeVpsBrowser(target, () => false, undefined, run)).rejects.toMatchObject({ code: "vps_action_cancelled" });
    const abort = new AbortController(); abort.abort();
    await expect(closeVpsBrowser(target, () => true, abort.signal, run)).rejects.toMatchObject({ code: "vps_action_cancelled" });
    await expect(closeVpsBrowser({ ...target, containerId: "mutable-name" }, () => true, undefined, run)).rejects.toThrow(/Invalid VPS lifecycle target/);
    expect(run).not.toHaveBeenCalled();
  });
});

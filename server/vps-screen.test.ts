import { describe, expect, it, vi } from "vitest";
import { INDEPENDENT_DISPLAYS, independentScreenTarget, type ScreenContainer } from "./shared-desktop-screens.ts";
import type { VpsCommandRunner } from "./vps-computer.ts";
import { createVpsScreenRuntime } from "./vps-screen.ts";

const container: ScreenContainer = { sshAlias: "workspace-vps", ownerId: "computer_workspace", containerId: "a".repeat(64) };
const screen = independentScreenTarget("bot-a", 2);
const output = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "" });
const version = { version: 2, displays: [...INDEPENDENT_DISPLAYS] };
const ready = { version: 2, ready: true, display: screen.display, botHash: screen.botHash, generation: screen.generation };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

describe("VPS independent screen runtime", () => {
  it("checks the guest protocol before resetting only managed additional screens", async () => {
    const runner = vi.fn<VpsCommandRunner>().mockResolvedValueOnce(output(version)).mockResolvedValueOnce(output({}));
    const abort = new AbortController();
    await createVpsScreenRuntime({ runner }).reset(container, abort.signal);
    expect(runner.mock.calls.map(([args]) => args)).toEqual([
      ["-H", "ssh://workspace-vps", "exec", "-u", "cua", container.containerId, "/usr/local/bin/omb-screen", "version"],
      ["-H", "ssh://workspace-vps", "exec", "-u", "cua", container.containerId, "/usr/local/bin/omb-screen", "reset"],
    ]);
    expect(runner.mock.calls.map(([, options]) => options?.timeoutMs)).toEqual([5000, 20000]);
    expect(runner.mock.calls.every(([, options]) => options?.signal === abort.signal)).toBe(true);
  });
  it.each([{ version: 1, displays: [2, 3, 4, 5] }, { version: 2, displays: [1, 2, 3, 4] }, { version: 2, displays: [...INDEPENDENT_DISPLAYS.slice(1), 3] }])("fails closed for an unsupported image protocol: %o", async descriptor => {
    const runner = vi.fn<VpsCommandRunner>().mockResolvedValue(output(descriptor));
    await expect(createVpsScreenRuntime({ runner }).reset(container, new AbortController().signal)).rejects.toThrow(/Update the bot desktop image/);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![0]).not.toContain("pull");
    expect(runner.mock.calls[0]![0]).not.toContain("rm");
  });
  it("distinguishes a missing guest controller from a failed VPS transport", async () => {
    const missing = vi.fn<VpsCommandRunner>().mockRejectedValue(new Error("exec /usr/local/bin/omb-screen: no such file"));
    await expect(createVpsScreenRuntime({ runner: missing }).reset(container, new AbortController().signal)).rejects.toThrow(/Update/);
    const offline = new Error("SSH transport timed out");
    const runner = vi.fn<VpsCommandRunner>().mockRejectedValue(offline);
    await expect(createVpsScreenRuntime({ runner }).reset(container, new AbortController().signal)).rejects.toBe(offline);
  });
  it("pins the host and container across a held protocol inspection", async () => {
    const held = deferred();
    const local = { ...container };
    const runner = vi.fn<VpsCommandRunner>().mockImplementationOnce(async () => { await held.promise; return output(version); }).mockResolvedValueOnce(output({}));
    const pending = createVpsScreenRuntime({ runner }).reset(local, new AbortController().signal);
    local.sshAlias = "different-vps";
    local.containerId = "b".repeat(64);
    held.resolve();
    await pending;
    expect(runner.mock.calls.every(([args]) => args[1] === "ssh://workspace-vps" && args.includes(container.containerId))).toBe(true);
  });
  it("accepts only a ready acknowledgement for the exact bot screen and generation", async () => {
    const runner = vi.fn<VpsCommandRunner>().mockResolvedValue(output(ready));
    await createVpsScreenRuntime({ runner }).start(container, screen, new AbortController().signal);
    expect(runner.mock.calls[0]![0].slice(-4)).toEqual(["ensure", "2", screen.botHash, screen.generation]);
    expect(runner.mock.calls[0]![1]?.timeoutMs).toBe(45000);
    runner.mockReset().mockResolvedValueOnce(output({ ...ready, botHash: "b".repeat(64) })).mockResolvedValueOnce(output({}));
    await expect(createVpsScreenRuntime({ runner }).start(container, screen, new AbortController().signal)).rejects.toThrow(/confirm its bot and generation/);
    expect(runner.mock.calls[1]![0].slice(-4)).toEqual(["stop", "2", screen.botHash, screen.generation]);
  });
  it("does not issue commands for an already cancelled screen request", async () => {
    const runner = vi.fn<VpsCommandRunner>();
    const abort = new AbortController();
    abort.abort();
    await expect(createVpsScreenRuntime({ runner }).start(container, screen, abort.signal)).rejects.toMatchObject({ status: 499 });
    expect(runner).not.toHaveBeenCalled();
  });
  it("waits for late ensure completion, then stops its pinned generation before rejecting cancellation", async () => {
    const ensured = deferred(), stopped = deferred();
    const abort = new AbortController();
    const calls: string[][] = [];
    const runner: VpsCommandRunner = async args => {
      calls.push(args);
      if (args.includes("ensure")) { await ensured.promise; return output(ready); }
      await stopped.promise;
      return output({});
    };
    let settled = false;
    const pending = createVpsScreenRuntime({ runner }).start(container, screen, abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ status: 499 });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    abort.abort();
    await tick();
    expect(calls).toHaveLength(1);
    ensured.resolve();
    await tick();
    expect(calls[1]!.slice(-4)).toEqual(["stop", "2", screen.botHash, screen.generation]);
    expect(settled).toBe(false);
    stopped.resolve();
    await rejection;
  });
  it("rejects forged display routing before invoking Docker", async () => {
    const runner = vi.fn<VpsCommandRunner>();
    await expect(createVpsScreenRuntime({ runner }).start(container, { ...screen, socket: "/foreign/socket" }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(runner).not.toHaveBeenCalled();
  });
});

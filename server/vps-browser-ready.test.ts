import { afterEach, describe, expect, it, vi } from "vitest";
import { independentScreenTarget } from "./shared-desktop-screens.ts";
import { ensureVpsScreenBrowser, SCREEN_BROWSER_LOW_MEMORY } from "./vps-browser-ready.ts";
import { boxChromes, evictVpsBoxChrome } from "./vps-connections.ts";
import type { VpsCommandRunner } from "./vps-computer.ts";

const id = "a".repeat(64);
const target = independentScreenTarget("bot", 21);
const ready = { version: 2, browserReady: true, display: 21, botHash: target.botHash, generation: target.generation };
const output = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "" });
afterEach(() => boxChromes.clear());

describe("independent browser admission", () => {
  it("pins canonical guest argv and a bounded cancellable readiness command", async () => {
    const runner = vi.fn<VpsCommandRunner>().mockResolvedValue(output(ready));
    const abort = new AbortController();
    const requireLive = vi.fn();
    await ensureVpsScreenBrowser(runner, "workspace-vps", id, target, { signal: abort.signal, requireLive });
    expect(runner).toHaveBeenCalledExactlyOnceWith(["-H", "ssh://workspace-vps", "exec", "-u", "cua", id, "/usr/local/bin/omb-screen", "browser-ensure", "21", target.botHash, target.generation], { timeoutMs: 15000, signal: abort.signal });
    expect(requireLive).toHaveBeenCalledTimes(2);
  });
  it.each([SCREEN_BROWSER_LOW_MEMORY, `omb-screen: ${SCREEN_BROWSER_LOW_MEMORY}`])("returns actionable admission failure for only the exact static low-memory message", async message => {
    const runner = vi.fn<VpsCommandRunner>().mockRejectedValue(new Error(message));
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target)).rejects.toMatchObject({ status: 429, message: SCREEN_BROWSER_LOW_MEMORY });
  });
  it.each([`secret ${SCREEN_BROWSER_LOW_MEMORY}`, `omb-screen: ${SCREEN_BROWSER_LOW_MEMORY}\nsecret`, "SSH key secret", JSON.stringify({ version: 2, error: "secret" })])("redacts unvalidated guest or transport errors", async message => {
    const runner = vi.fn<VpsCommandRunner>().mockRejectedValue(new Error(message));
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target)).rejects.toMatchObject({ status: 502, message: "The bot browser did not become ready. Retry, or update the bot desktop image if this continues." });
  });
  it.each([{ ...ready, version: 1 }, { ...ready, browserReady: false }, { ...ready, display: 2 }, { ...ready, generation: "other" }, { ...ready, botHash: "b".repeat(64) }, { version: 2, error: SCREEN_BROWSER_LOW_MEMORY }])("refuses an unconfirmed generation: %o", async receipt => {
    await expect(ensureVpsScreenBrowser(vi.fn<VpsCommandRunner>().mockResolvedValue(output(receipt)), "workspace-vps", id, target)).rejects.toMatchObject({ status: 502 });
  });
  it("refuses forged target fields before issuing a command", async () => {
    const runner = vi.fn<VpsCommandRunner>();
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, { ...target, cdpPort: 9222 })).rejects.toMatchObject({ status: 400 });
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects a cancelled command without publishing readiness", async () => {
    const abort = new AbortController();
    const runner = vi.fn<VpsCommandRunner>().mockImplementation(async () => { abort.abort(); return output(ready); });
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target, { signal: abort.signal })).rejects.toMatchObject({ status: 499 });
    runner.mockClear();
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target, { signal: abort.signal })).rejects.toMatchObject({ status: 499 });
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects revocation both before and after the awaited guest command", async () => {
    let live = true;
    const revoked = Object.assign(new Error("reassigned"), { status: 409 });
    const runner = vi.fn<VpsCommandRunner>().mockImplementation(async () => { live = false; return output(ready); });
    const options = { requireLive: () => { if (!live) throw revoked; } };
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target, options)).rejects.toBe(revoked);
    runner.mockClear();
    await expect(ensureVpsScreenBrowser(runner, "workspace-vps", id, target, options)).rejects.toBe(revoked);
    expect(runner).not.toHaveBeenCalled();
  });
  it("evicts only the failed cached relay and leaves a replacement generation untouched", () => {
    const close = vi.fn();
    boxChromes.set("bot", { alias: "workspace-vps", containerId: id, url: "http://127.0.0.1:12345", close });
    evictVpsBoxChrome("bot", "http://127.0.0.1:12344");
    expect(close).not.toHaveBeenCalled();
    expect(boxChromes.has("bot")).toBe(true);
    evictVpsBoxChrome("bot", "http://127.0.0.1:12345");
    expect(close).toHaveBeenCalledOnce();
    expect(boxChromes.has("bot")).toBe(false);
  });
});

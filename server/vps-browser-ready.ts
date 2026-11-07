import { independentScreenExecArgs, type IndependentScreenTarget } from "./shared-desktop-screens.ts";
import { vpsDockerArgs, type VpsCommandRunner } from "./vps-computer.ts";

export const SCREEN_BROWSER_LOW_MEMORY = "This computer is low on memory. Close an unused browser or use a larger computer, then retry.";
const unavailable = () => Object.assign(new Error("The bot browser did not become ready. Retry, or update the bot desktop image if this continues."), { status: 502 });
const cancelled = () => Object.assign(new Error("Bot browser setup cancelled"), { status: 499, name: "AbortError" });

export async function ensureVpsScreenBrowser(runner: VpsCommandRunner, alias: string, containerId: string, target: IndependentScreenTarget, options: { signal?: AbortSignal; requireLive?: () => void } = {}): Promise<void> {
  const screen = { ...target };
  const args = vpsDockerArgs(alias, independentScreenExecArgs(containerId, "browser-ensure", screen));
  const check = () => { if (options.signal?.aborted) throw cancelled(); options.requireLive?.(); };
  check();
  let stdout: string;
  try {
    ({ stdout } = await runner(args, { timeoutMs: 15_000, ...(options.signal ? { signal: options.signal } : {}) }));
  } catch (error) {
    check();
    const message = error instanceof Error ? error.message.trim() : "";
    if (message === SCREEN_BROWSER_LOW_MEMORY || message === `omb-screen: ${SCREEN_BROWSER_LOW_MEMORY}`) {
      throw Object.assign(new Error(SCREEN_BROWSER_LOW_MEMORY), { status: 429 });
    }
    throw unavailable();
  }
  check();
  try {
    if (stdout.length > 4096) throw unavailable();
    const ready: unknown = JSON.parse(stdout);
    if (ready && typeof ready === "object" && "version" in ready && ready.version === 2 && "browserReady" in ready && ready.browserReady === true
      && "display" in ready && ready.display === screen.display && "botHash" in ready && ready.botHash === screen.botHash && "generation" in ready && ready.generation === screen.generation) return;
  } catch {}
  throw unavailable();
}

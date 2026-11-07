import { INDEPENDENT_DISPLAYS, independentScreenExecArgs, type IndependentScreenTarget, type ScreenContainer } from "./shared-desktop-screens.ts";
import { defaultRunner, vpsDockerArgs, type VpsCommandRunner } from "./vps-computer.ts";

const VERSION_TIMEOUT_MS = 5_000;
const RESET_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 15_000;
const unavailable = () => Object.assign(new Error("Update the bot desktop image to use independent screens. Existing desktop files are kept; this setting does not replace the computer automatically."), { status: 409 });
const cancelled = () => Object.assign(new Error("Independent screen setup cancelled"), { name: "AbortError", status: 499 });
const missingController = (error: unknown) => /not found|no such file|unknown command|unsupported|not executable/i.test(error instanceof Error ? error.message : "");

function parsed(stdout: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(stdout);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {}
  throw unavailable();
}

export function createVpsScreenRuntime({ runner = defaultRunner }: { runner?: VpsCommandRunner } = {}) {
  const run = (container: ScreenContainer, action: "version" | "reset" | "ensure" | "stop", target: IndependentScreenTarget | undefined, timeoutMs: number, signal?: AbortSignal) => {
    const args = vpsDockerArgs(container.sshAlias, independentScreenExecArgs(container.containerId, action, target));
    return runner(args, { timeoutMs, ...(signal ? { signal } : {}) });
  };
  async function stop(container: ScreenContainer, target: IndependentScreenTarget) {
    try { await run({ ...container }, "stop", target, STOP_TIMEOUT_MS); }
    catch (error) { throw missingController(error) ? unavailable() : error; }
  }
  return {
    async reset(container: ScreenContainer, signal: AbortSignal) {
      const pinned = { ...container };
      if (signal.aborted) throw cancelled();
      try {
        const version = parsed((await run(pinned, "version", undefined, VERSION_TIMEOUT_MS, signal)).stdout);
        const displays = version.displays;
        if (version.version !== 2 || !Array.isArray(displays) || displays.length !== INDEPENDENT_DISPLAYS.length || INDEPENDENT_DISPLAYS.some(display => !displays.includes(display))) throw unavailable();
        if (signal.aborted) throw cancelled();
        await run(pinned, "reset", undefined, RESET_TIMEOUT_MS, signal);
        if (signal.aborted) throw cancelled();
      } catch (error) {
        if (signal.aborted) throw cancelled();
        throw missingController(error) ? unavailable() : error;
      }
    },
    async start(container: ScreenContainer, target: IndependentScreenTarget, signal: AbortSignal) {
      const pinned = { ...container };
      const screen = { ...target };
      if (signal.aborted) throw cancelled();
      try {
        const ready = parsed((await run(pinned, "ensure", screen, START_TIMEOUT_MS, signal)).stdout);
        if (signal.aborted) throw cancelled();
        if (ready.version !== 2 || ready.ready !== true || ready.display !== screen.display || ready.botHash !== screen.botHash || ready.generation !== screen.generation) {
          throw Object.assign(new Error("The independent screen did not confirm its bot and generation. Retry screen setup."), { status: 409 });
        }
      } catch (error) {
        await stop(pinned, screen);
        if (signal.aborted) throw cancelled();
        throw missingController(error) ? unavailable() : error;
      }
    },
    stop,
  };
}

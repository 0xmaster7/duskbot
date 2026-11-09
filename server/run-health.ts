// Crash and stall evidence in the local log: a run marker that outlives a run which did not exit cleanly, and an
// event-loop stall monitor. Each writes one line when it has something to say.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export const RUN_HEARTBEAT_MS = 60_000;
/** A main loop held this long is a stall a person notices: a message that does not move. */
export const STALL_MS = 1_000;
const STALL_CHECK_MS = 10_000;
/** The wall clock ran this far ahead of the monotonic one: the computer slept in between. */
const SLEPT_MS = 30_000;
const STARTUP_MS = 2 * 60_000;
const RESUME_MS = 2 * 60_000;
const FIRST_HOUR_MS = 60 * 60_000;
export const RUN_MARKER = "run-marker.json";

interface Marker {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  turns: number;
  sleptAt?: number;
}

export interface RunHealthOptions {
  dataDir: string;
  /** Turns running now, recorded with each heartbeat. */
  turns(): number;
  log(line: string): void;
  now?: () => number;
  /** When this computer last started, epoch ms. */
  bootedAt?: () => number;
  heartbeatMs?: number;
  stallCheckMs?: number;
}

export interface RunHealth {
  /** At a clean exit: the next start finds no marker. */
  cleanExit(): void;
  stop(): void;
}

const iso = (at: number) => new Date(at).toISOString();
const minutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))} min`;

function readMarker(file: string): Marker | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Marker>;
    return typeof parsed.pid === "number" && typeof parsed.startedAt === "number" && typeof parsed.heartbeatAt === "number"
      ? { pid: parsed.pid, startedAt: parsed.startedAt, heartbeatAt: parsed.heartbeatAt, turns: typeof parsed.turns === "number" ? parsed.turns : 0, ...(typeof parsed.sleptAt === "number" ? { sleptAt: parsed.sleptAt } : {}) }
      : null;
  } catch {
    return null;
  }
}

/** The line a marker left by a run that did not exit cleanly earns at the next start. */
export function uncleanExitLine(previous: Marker, now: number, bootedAt: number): string {
  const facts = [`pid ${previous.pid}, started ${iso(previous.startedAt)}, last heard ${iso(previous.heartbeatAt)}, ${minutes(now - previous.heartbeatAt)} before this start`];
  if (previous.turns > 0) facts.push(`${previous.turns} turn${previous.turns === 1 ? " was" : "s were"} running`);
  if (bootedAt > previous.heartbeatAt) facts.push("the computer restarted since");
  else if (previous.sleptAt !== undefined && previous.sleptAt >= previous.startedAt) facts.push(`the computer had slept (woke ${iso(previous.sleptAt)})`);
  return `run health: the last run did not exit cleanly (${facts.join("; ")})`;
}

export function stallPhase(sinceStartMs: number, sinceWakeMs: number | null): "startup" | "resume" | "first_hour" | "later" {
  if (sinceStartMs < STARTUP_MS) return "startup";
  if (sinceWakeMs !== null && sinceWakeMs < RESUME_MS) return "resume";
  return sinceStartMs < FIRST_HOUR_MS ? "first_hour" : "later";
}

export function startRunHealth(options: RunHealthOptions): RunHealth {
  const now = options.now ?? Date.now;
  const file = join(options.dataDir, RUN_MARKER);
  const startedAt = now();
  const startedMono = performance.now();
  let wokeMono: number | null = null;
  let sleptAt: number | undefined;
  let lastWall = startedAt;
  let lastMono = startedMono;

  const previous = readMarker(file);
  if (previous) options.log(uncleanExitLine(previous, startedAt, options.bootedAt?.() ?? startedAt - uptime() * 1_000));

  /** A wall clock that ran ahead of the monotonic one since the last look means the computer slept. */
  const noticeSleep = () => {
    const wall = now();
    const mono = performance.now();
    if ((wall - lastWall) - (mono - lastMono) > SLEPT_MS) { wokeMono = mono; sleptAt = wall; }
    lastWall = wall;
    lastMono = mono;
  };

  const write = () => {
    noticeSleep();
    const marker: Marker = { pid: process.pid, startedAt, heartbeatAt: now(), turns: options.turns(), ...(sleptAt !== undefined ? { sleptAt } : {}) };
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(marker), { mode: 0o600 });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      options.log(`run health: could not write the run marker (${error instanceof Error ? error.message : String(error)})`);
    }
  };
  write();
  const heartbeat = setInterval(write, options.heartbeatMs ?? RUN_HEARTBEAT_MS);
  heartbeat.unref();

  const delay: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const stalls = setInterval(() => {
    noticeSleep();
    const worst = delay.max / 1e6;
    delay.reset();
    if (worst < STALL_MS) return;
    const mono = performance.now();
    const phase = stallPhase(mono - startedMono, wokeMono === null ? null : mono - wokeMono);
    options.log(`run health: the main loop stalled for ${Math.round(worst)} ms (${phase}, ${options.turns()} turns running)`);
  }, options.stallCheckMs ?? STALL_CHECK_MS);
  stalls.unref();

  const stop = () => {
    clearInterval(heartbeat);
    clearInterval(stalls);
    delay.disable();
  };
  return {
    cleanExit() {
      stop();
      rmSync(file, { force: true });
    },
    stop,
  };
}

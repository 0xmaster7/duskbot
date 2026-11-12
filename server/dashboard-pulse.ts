import { readFileSync } from "node:fs";
import * as os from "node:os";
import { PULSE_INTERVAL_MS, PULSE_SIZE, PulseRing, type PulseSample } from "../shared/machine-pulse.ts";
import { cpuPercent, cpuTimes, linuxMemoryUsed, type CpuTimes } from "./dashboard-machine.ts";

export interface PulseReading { cpu: CpuTimes; memoryUsed: number; memoryTotal: number }

function linuxReading(): PulseReading {
  let meminfo = "";
  try { meminfo = readFileSync("/proc/meminfo", "utf8"); } catch {}
  const total = os.totalmem();
  return { cpu: cpuTimes(), memoryUsed: linuxMemoryUsed(meminfo, total, os.freemem()), memoryTotal: total };
}

/** cpu and memory every PULSE_INTERVAL_MS into a fixed ring of PULSE_SIZE; its own cpu baseline, so the reports' cpu
 * reading is untouched */
export function createPulseSampler(options: { read?: () => PulseReading; now?: () => number; intervalMs?: number; size?: number } = {}) {
  const read = options.read ?? linuxReading, now = options.now ?? Date.now;
  const ring = new PulseRing(options.size ?? PULSE_SIZE);
  let previous: CpuTimes | null = null, timer: ReturnType<typeof setInterval> | null = null;
  function tick() {
    try {
      const reading = read();
      if (previous) ring.push({ t: now(), cpu: Math.round(cpuPercent(previous, reading.cpu) * 10) / 10,
        mem: reading.memoryTotal > 0 ? Math.round(Math.min(100, (reading.memoryUsed / reading.memoryTotal) * 100) * 10) / 10 : 0 });
      previous = reading.cpu;
    } catch {}
  }
  return {
    tick,
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, options.intervalMs ?? PULSE_INTERVAL_MS);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; previous = null; },
    since: (after: number): PulseSample[] => ring.since(after),
  };
}
export type PulseSampler = ReturnType<typeof createPulseSampler>;

import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import * as os from "node:os";
import { promisify } from "node:util";
import { serverVersion } from "./environment.ts";

const exec = promisify(execFile);

export async function bounded<T>(work: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work).catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function cachedSample<T>(work: () => Promise<T>, ttlMs: number, timeoutMs: number, fallback: T): () => Promise<T> {
  let cached: { at: number; value: T } | undefined;
  let pending: Promise<T> | undefined;
  return () => {
    if (cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (!pending) pending = bounded(work, timeoutMs, fallback).then((value) => {
      cached = { at: Date.now(), value };
      pending = undefined;
      return value;
    });
    return pending;
  };
}

export interface NetworkSample { at: number; rxBytes: number; txBytes: number }
export interface NetworkRate { rxBytesPerSec: number; txBytesPerSec: number }

export function parseProcNetDev(text: string, at: number): NetworkSample | null {
  let rxBytes = 0, txBytes = 0, interfaces = 0;
  for (const line of text.split("\n")) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match || match[1].trim() === "lo") continue;
    const fields = match[2].trim().split(/\s+/).map(Number);
    if (fields.length < 16 || !fields.every((n) => Number.isFinite(n) && n >= 0)) continue;
    rxBytes += fields[0]; txBytes += fields[8]; interfaces++;
  }
  return interfaces ? { at, rxBytes, txBytes } : null;
}

export function parseNetstat(text: string, at: number): NetworkSample | null {
  const lines = text.trim().split("\n");
  const header = lines.shift()?.trim().split(/\s+/) ?? [];
  const rx = header.indexOf("Ibytes"), tx = header.indexOf("Obytes"), network = header.indexOf("Network");
  if (rx < 0 || tx < 0 || network < 0) return null;
  const seen = new Set<string>();
  let rxBytes = 0, txBytes = 0;
  for (const line of lines) {
    const fields = line.trim().split(/\s+/), name = fields[0]?.replace(/\*$/, "");
    if (!name || /^lo\d*$/.test(name) || seen.has(name) || !fields[network]?.startsWith("<Link")) continue;
    const offset = fields.length === header.length - 1 ? -1 : 0;
    const input = Number(fields[rx + offset]), output = Number(fields[tx + offset]);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    seen.add(name); rxBytes += input; txBytes += output;
  }
  return seen.size ? { at, rxBytes, txBytes } : null;
}

export function networkRate(previous: NetworkSample | null, current: NetworkSample): NetworkRate {
  const seconds = previous ? (current.at - previous.at) / 1000 : 0;
  return seconds > 0 && previous ? {
    rxBytesPerSec: Math.max(0, current.rxBytes - previous.rxBytes) / seconds,
    txBytesPerSec: Math.max(0, current.txBytes - previous.txBytes) / seconds,
  } : { rxBytesPerSec: 0, txBytesPerSec: 0 };
}

export function linuxMemoryUsed(text: string, total: number, free: number): number {
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text);
  return Math.max(0, total - Math.min(total, available ? Number(available[1]) * 1024 : free));
}

type CpuTimes = { total: number; idle: number };
const cpuTimes = (): CpuTimes => os.cpus().reduce((sum, cpu) => ({
  total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0), idle: sum.idle + cpu.times.idle,
}), { total: 0, idle: 0 });

export function cpuPercent(previous: CpuTimes, current: CpuTimes): number {
  const total = current.total - previous.total;
  return total > 0 ? Math.max(0, Math.min(100, (1 - (current.idle - previous.idle) / total) * 100)) : 0;
}

let previousCpu: CpuTimes | null = null;
let cpuPending: Promise<number> | null = null;
function sampleCpu(): Promise<number> {
  if (!cpuPending) cpuPending = (async () => {
    if (!previousCpu) {
      previousCpu = cpuTimes();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const current = cpuTimes(), percent = cpuPercent(previousCpu, current);
    previousCpu = current;
    return percent;
  })().finally(() => { cpuPending = null; });
  return cpuPending;
}

const macNetwork = cachedSample(async () => {
  const { stdout } = await exec("/usr/sbin/netstat", ["-ib", "-n"], { timeout: 2000, maxBuffer: 1024 * 1024 });
  return parseNetstat(stdout, Date.now());
}, 2000, 2100, null);
// macOS counts file cache as used in freemem: count active, wired and compressed pages like Activity Monitor does
export function macMemoryUsed(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (label: string) => Number(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text)?.[1] ?? NaN);
  const used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page;
  return Number.isFinite(used) && used > 0 ? used : null;
}
const macMemory = cachedSample(async () => macMemoryUsed((await exec("/usr/bin/vm_stat", [], { timeout: 2000, maxBuffer: 64 * 1024 })).stdout), 2000, 2100, null);
let previousNetwork: NetworkSample | null = null;
let lastNetworkRate: NetworkRate | null = null;
async function sampleNetwork(): Promise<NetworkRate | null> {
  try {
    const sample = process.platform === "linux" ? parseProcNetDev(await readFile("/proc/net/dev", "utf8"), Date.now())
      : process.platform === "darwin" ? await macNetwork() : null;
    if (!sample) return null;
    if (sample.at === previousNetwork?.at) return lastNetworkRate;
    lastNetworkRate = networkRate(previousNetwork, sample);
    previousNetwork = sample;
    return lastNetworkRate;
  } catch { return null; }
}

export async function sampleMachine(dataDir: string) {
  const totalBytes = os.totalmem(), free = os.freemem();
  const [percent, network, disk, meminfo] = await Promise.all([
    sampleCpu(), sampleNetwork(),
    statfs(dataDir).then((fs) => ({ usedBytes: (fs.blocks - fs.bfree) * fs.bsize, totalBytes: fs.blocks * fs.bsize, path: dataDir })).catch(() => null),
    process.platform === "linux" ? readFile("/proc/meminfo", "utf8").catch(() => "") : Promise.resolve(""),
  ]);
  const mac = process.platform === "darwin" ? await macMemory().catch(() => null) : null;
  const cpus = os.cpus();
  let uptimeSec = 0;
  try { uptimeSec = os.uptime(); } catch {}
  return {
    at: Date.now(),
    host: { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), cpus: cpus.length, cpuModel: cpus[0]?.model ?? null },
    cpu: { percent, load: os.loadavg() as [number, number, number] },
    memory: { usedBytes: mac !== null ? Math.min(totalBytes, mac) : linuxMemoryUsed(meminfo, totalBytes, free), totalBytes },
    disk, network, uptimeSec, processUptimeSec: process.uptime(),
    app: { version: serverVersion(), node: process.versions.node },
  };
}

const byteUnits: Record<string, number> = { b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
export function dockerBytes(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([a-z]+)\s*$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]) * (byteUnits[match[2].toLowerCase()] ?? NaN);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export interface DockerStats { memoryBytes: number | null; memoryLimitBytes: number | null; cpuPercent: number | null }
export function parseDockerStats(text: string): Map<string, DockerStats> {
  const stats = new Map<string, DockerStats>();
  for (const line of text.split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line) as { Name?: unknown; MemUsage?: unknown; CPUPerc?: unknown };
      if (typeof row.Name !== "string") continue;
      const [used, limit] = typeof row.MemUsage === "string" ? row.MemUsage.split("/") : [];
      const cpu = typeof row.CPUPerc === "string" ? Number(row.CPUPerc.replace(/%$/, "")) : NaN;
      stats.set(row.Name, { memoryBytes: dockerBytes(used ?? ""), memoryLimitBytes: dockerBytes(limit ?? ""), cpuPercent: Number.isFinite(cpu) && cpu >= 0 ? cpu : null });
    } catch { continue; }
  }
  return stats;
}

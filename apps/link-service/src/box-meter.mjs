// the whole box a node runs on: cpu, memory and the main network interface's traffic. the monthly allowance (oracle's
// 10 tb free egress, contabo's fair use) counts everything the box sends, turn and the owner's other services included,
// so placement and alerts read these, not only the relay's own frames. linux only; elsewhere every reading is null.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem, uptime } from "node:os";
import { join } from "node:path";

const read = (file) => { try { return readFileSync(file, "utf8"); } catch { return null; } };

/** the interface the default route leaves by, from /proc/net/route */
export function defaultInterface(routeText = read("/proc/net/route")) {
  for (const line of (routeText ?? "").split("\n").slice(1)) {
    const [iface, destination, , flags] = line.trim().split(/\s+/);
    if (destination === "00000000" && (Number.parseInt(flags, 16) & 1)) return iface;
  }
  return null;
}

/** bytes received and sent on `iface` since boot, from /proc/net/dev */
export function interfaceBytes(iface, devText = read("/proc/net/dev")) {
  for (const line of (devText ?? "").split("\n")) {
    const [name, rest] = line.split(":");
    if (name?.trim() !== iface || !rest) continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    return { rx: fields[0], tx: fields[8] };
  }
  return null;
}

function memPercent(meminfo = read("/proc/meminfo")) {
  const available = Number(/MemAvailable:\s+(\d+)/.exec(meminfo ?? "")?.[1]) * 1024;
  const total = totalmem();
  return Math.round(((total - (available || freemem())) / total) * 1000) / 10;
}

const cpuTimes = () => cpus().reduce((sum, cpu) => { const t = cpu.times; return { idle: sum.idle + t.idle, total: sum.total + t.user + t.nice + t.sys + t.idle + t.irq }; }, { idle: 0, total: 0 });

/**
 * samples every `everyMs`; cpu and the send rate are averaged over the last `windowMs`. month totals are kept in
 * box-usage.json so a restart or a reboot (counters back at zero) loses nothing but the moments the service was down
 */
export function createBoxMeter({ dir = null, iface = defaultInterface(), everyMs = 10_000, windowMs = 60_000, now = Date.now, readDev = () => read("/proc/net/dev"), times = cpuTimes, mem = memPercent } = {}) {
  const file = dir ? join(dir, "box-usage.json") : null;
  let saved = null;
  try { saved = file ? JSON.parse(readFileSync(file, "utf8")) : null; } catch {}
  const months = saved?.months && typeof saved.months === "object" ? saved.months : {};
  let last = saved?.last && saved.iface === iface ? saved.last : null;
  let since = typeof saved?.since === "number" ? saved.since : null;
  const samples = [];
  let timer = null, dirty = false;

  function monthKey(t) { return new Date(t).toISOString().slice(0, 7); }
  function sample() {
    const t = now();
    const bytes = iface ? interfaceBytes(iface, readDev()) : null;
    const cpu = times();
    if (bytes) {
      const key = monthKey(t), month = months[key] ??= { tx: 0, rx: 0 };
      if (!last) {
        // first run: what the interface sent since boot counts when the box booted this month
        const bootAt = t - uptime() * 1000;
        if (monthKey(bootAt) === key) { month.tx += bytes.tx; month.rx += bytes.rx; since = bootAt; } else since = t;
      } else {
        // a smaller counter means a reboot: everything since counts
        month.tx += bytes.tx >= last.tx ? bytes.tx - last.tx : bytes.tx;
        month.rx += bytes.rx >= last.rx ? bytes.rx - last.rx : bytes.rx;
      }
      last = { tx: bytes.tx, rx: bytes.rx };
      dirty = true;
      const keys = Object.keys(months).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - 3))) delete months[old];
    }
    samples.push({ t, tx: bytes?.tx ?? null, rx: bytes?.rx ?? null, cpu, mem: mem() });
    while (samples.length > 2 && t - samples[1].t >= windowMs) samples.shift();
  }
  function save() {
    if (!file || !dirty) return;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, iface, last, since, months }), { mode: 0o600 });
      renameSync(tmp, file);
      dirty = false;
    } catch (error) { console.error(`link: could not save box usage (${error?.message ?? error})`); }
  }
  /** the share of the utc month gone, at least a day of it so the first hours do not project wildly */
  function monthElapsed(t) {
    const d = new Date(t), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return Math.max(t - Math.max(start, since ?? start), 86_400_000) / (end - Math.max(start, since ?? start));
  }
  function reading() {
    const t = now(), first = samples[0], newest = samples.at(-1);
    const span = first && newest && newest.t > first.t ? (newest.t - first.t) / 1000 : 0;
    const rate = (key) => (span && first[key] !== null && newest[key] !== null && newest[key] >= first[key] ? Math.round((newest[key] - first[key]) / span) : null);
    const cpu = first && newest && newest.cpu.total > first.cpu.total ? Math.round((1 - (newest.cpu.idle - first.cpu.idle) / (newest.cpu.total - first.cpu.total)) * 1000) / 10 : null;
    const month = months[monthKey(t)] ?? null;
    return {
      iface, cpu, mem: newest?.mem ?? null, cores: cpus().length,
      bytesPerSecOut: rate("tx"), bytesPerSecIn: rate("rx"),
      monthBytesOut: month ? month.tx : null, monthBytesIn: month ? month.rx : null,
      projectedBytesOut: month ? Math.round(month.tx / monthElapsed(t)) : null,
      countingSince: since,
    };
  }
  return {
    sample, reading, save,
    start() {
      if (timer || process.platform !== "linux") return;
      sample();
      let ticks = 0;
      timer = setInterval(() => { sample(); if (++ticks % 6 === 0) save(); }, everyMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; save(); },
  };
}

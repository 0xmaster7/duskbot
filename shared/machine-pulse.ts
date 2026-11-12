// the dashboard's live cpu and memory chart: a workspace samples into a fixed ring and sends what is new with each report
// while someone watches; the service keeps one ring per workspace and answers GET /v1/workspaces/:id/pulse?after=<t>.

/** 3 s: cpu is a delta between two reads, so this is also the window it averages over. 1 s is spiky and triples the
 * payload; 5 s (the report cadence) leaves 24 steppy points over the chart's two minutes. */
export const PULSE_INTERVAL_MS = 3_000;
/** 40 samples of 3 s: the chart's two minutes */
export const PULSE_SIZE = 40;
export const PULSE_WINDOW_MS = PULSE_INTERVAL_MS * PULSE_SIZE;

/** one moment: when (ms), cpu and memory as percent of the machine */
export interface PulseSample { t: number; cpu: number; mem: number }
/** GET /v1/workspaces/:id/pulse */
export interface PulseAnswer { v: 1; intervalMs: number; samples: PulseSample[] }

/** a fixed ring that only moves forward in time: an older or equal sample is dropped, the oldest falls off the end */
export class PulseRing {
  private readonly slots: Array<PulseSample | undefined>;
  private head = 0;
  private count = 0;
  constructor(size = PULSE_SIZE) { this.slots = Array.from({ length: Math.max(1, size) }); }
  get length() { return this.count; }
  last(): PulseSample | null { return this.count ? this.slots[(this.head - 1 + this.slots.length) % this.slots.length]! : null; }
  push(sample: PulseSample): boolean {
    const last = this.last();
    if (last && sample.t <= last.t) return false;
    this.slots[this.head] = sample;
    this.head = (this.head + 1) % this.slots.length;
    this.count = Math.min(this.slots.length, this.count + 1);
    return true;
  }
  /** oldest first, only those after `after` */
  since(after = -Infinity): PulseSample[] {
    const out: PulseSample[] = [];
    for (let i = 0; i < this.count; i++) {
      const sample = this.slots[(this.head - this.count + i + this.slots.length) % this.slots.length]!;
      if (sample.t > after) out.push(sample);
    }
    return out;
  }
  clear() { this.slots.fill(undefined); this.head = 0; this.count = 0; }
}

const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

/** a report's pulse: at most a ring's worth, each sample checked, oldest first; null when it is not a list */
export function parsePulse(input: unknown): PulseSample[] | null {
  if (!Array.isArray(input)) return null;
  const out: PulseSample[] = [];
  for (const item of input.slice(-PULSE_SIZE * 2)) {
    if (!item || typeof item !== "object") continue;
    const { t, cpu, mem } = item as Record<string, unknown>;
    const c = percent(cpu), m = percent(mem);
    if (!Number.isSafeInteger(t) || (t as number) <= 0 || c === null || m === null) continue;
    out.push({ t: t as number, cpu: Math.round(c * 10) / 10, mem: Math.round(m * 10) / 10 });
  }
  return out.sort((a, b) => a.t - b.t).slice(-PULSE_SIZE);
}

// renders the notification sounds in src/assets/sounds from scratch: soft sine and triangle partials with
// exponential decays, 48 kHz 16-bit stereo, each levelled to a quiet rms under a -5.2 dBFS ceiling.
// run: node scripts/gen-ui-sounds.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48_000;
const PEAK = 0.55;
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/assets/sounds");

const sine = (phase) => Math.sin(2 * Math.PI * phase);
const triangle = (phase) => 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5);

/** one struck note: a quick attack, an exponential decay, and a few soft partials above the fundamental */
function note({ at, freq, decay, attack = 0.004, glide = 0, partials = [[1, 1]], wave = sine, gain = 1 }) {
  return (t) => {
    const local = t - at;
    if (local < 0) return 0;
    const env = Math.min(1, local / attack) * Math.exp(-local / decay);
    if (env < 1e-5) return 0;
    // glide raises the pitch by `glide` Hz in a straight line over the first 60 ms, then holds; this is its phase
    const ramp = 0.06;
    const bend = local < ramp ? (glide * local * local) / (2 * ramp) : glide * (local - ramp / 2);
    let sum = 0;
    for (const [ratio, amp] of partials) sum += amp * wave(ratio * (freq * local + bend));
    return gain * env * sum;
  };
}

function render(seconds, rmsDb, voices) {
  const frames = Math.round(seconds * RATE);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    for (const voice of voices) mono[i] += voice(t);
  }
  // a 20 ms fade at the end so the file never stops on a click
  const fade = Math.round(0.02 * RATE);
  for (let i = 0; i < fade; i++) mono[frames - 1 - i] *= i / fade;
  let peak = 0;
  let power = 0;
  for (const v of mono) {
    peak = Math.max(peak, Math.abs(v));
    power += v * v;
  }
  const rms = Math.sqrt(power / frames);
  const scale = rms ? Math.min(10 ** (rmsDb / 20) / rms, PEAK / peak) : 0;
  return { frames, sample: (i) => Math.round(Math.max(-1, Math.min(1, mono[i] * scale)) * 32767) };
}

function wav({ frames, sample }) {
  const bytes = frames * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < frames; i++) {
    const s = sample(i);
    buf.writeInt16LE(s, 44 + i * 4);
    buf.writeInt16LE(s, 46 + i * 4);
  }
  return buf;
}

const bell = [[1, 1], [2, 0.18], [3, 0.05]];
const wood = [[1, 1], [2.76, 0.12]];

const SOUNDS = {
  // a round bubble that lifts a fifth as it pops
  "open-blip": render(0.26, -24, [note({ at: 0, freq: 587.33, decay: 0.07, glide: 300, partials: [[1, 1], [2, 0.12]] })]),
  // one soft wooden tap
  tick: render(0.22, -33, [note({ at: 0, freq: 1318.5, decay: 0.022, attack: 0.002, partials: wood, wave: triangle })]),
  // two taps, the second a step higher
  "double-tick": render(0.33, -26, [
    note({ at: 0, freq: 1174.7, decay: 0.022, attack: 0.002, partials: wood, wave: triangle }),
    note({ at: 0.105, freq: 1318.5, decay: 0.026, attack: 0.002, partials: wood, wave: triangle, gain: 0.9 }),
  ]),
  // a gentle rising third
  "chime-a": render(0.34, -23, [
    note({ at: 0, freq: 783.99, decay: 0.09, partials: bell, gain: 0.8 }),
    note({ at: 0.085, freq: 987.77, decay: 0.12, partials: bell }),
  ]),
  // three quick notes up a major triad
  "chime-b": render(0.35, -23.5, [
    note({ at: 0, freq: 659.25, decay: 0.07, partials: bell, gain: 0.7 }),
    note({ at: 0.065, freq: 830.61, decay: 0.08, partials: bell, gain: 0.8 }),
    note({ at: 0.13, freq: 987.77, decay: 0.11, partials: bell }),
  ]),
};

for (const [name, pcm] of Object.entries(SOUNDS)) writeFileSync(join(out, `${name}.wav`), wav(pcm));

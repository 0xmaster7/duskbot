// Our own mark clips, authored in Grok's clip format (tracks of keyframes: position and squash in body units with +y up,
// rotation as [pitch, yaw, roll] degrees, lids 0 open to 1 shut, expression keys) so its animator plays them like its own.
import { MARK_REST_ROTATION, type MarkClip } from "./mascot-motion-engine";

type Key = { t: number; v: number[] | string; ease?: number[]; cut?: boolean };
interface ClipSource {
  name: string;
  duration: number;
  squashAnchor?: number;
  tracks: Partial<Record<"position" | "rotation" | "squash" | "lids" | "expression", Key[]>>;
}

const IN_OUT = [0.42, 0, 0.58, 1];
const OUT = [0.2, 0.7, 0.35, 1];
const IN = [0.55, 0, 0.85, 0.45];

function clip(source: ClipSource): MarkClip {
  const tracks = Object.fromEntries(Object.entries(source.tracks).map(([name, keys]) => [name, keys.map((key) => ({ ease: IN_OUT, ...key }))]));
  return { body: "sphere", workArea: null, inspect: { bias: -1, follow: true }, squashAnchor: 0, ...source, tracks } as unknown as MarkClip;
}

/** An idle clip turns from the rest pose (Grok rests a mark three-quarters up and to the right) and comes back to it,
 * so it flows out of a resting mark and back without swinging to face front first. */
function fromRest(source: ClipSource): ClipSource {
  const rotation = source.tracks.rotation ?? [{ t: 0, v: [0, 0, 0] }, { t: source.duration, v: [0, 0, 0] }];
  const turned = rotation.map((key) => ({ ...key, v: (key.v as number[]).map((value, axis) => value + MARK_REST_ROTATION[axis]!) }));
  return { ...source, tracks: { ...source.tracks, rotation: turned } };
}

const still = (duration: number) => [{ t: 0, v: [0, 0] }, { t: duration, v: [0, 0] }];

export const OMB_CLIPS = {
  Hop: clip({
    name: "Hop",
    duration: 1,
    squashAnchor: -1,
    tracks: {
      squash: [
        { t: 0, v: [1, 1] }, { t: 0.12, v: [1.14, 0.86] }, { t: 0.24, v: [0.9, 1.12] }, { t: 0.48, v: [1, 1] },
        { t: 0.64, v: [1.12, 0.88] }, { t: 0.8, v: [0.97, 1.03] }, { t: 1, v: [1, 1] },
      ],
      position: [{ t: 0, v: [0, 0] }, { t: 0.14, v: [0, -0.02], ease: OUT }, { t: 0.4, v: [0, 0.26], ease: IN }, { t: 0.63, v: [0, 0] }, { t: 1, v: [0, 0] }],
      expression: [{ t: 0.05, v: "happy" }, { t: 0.92, v: "neutral", cut: false }],
    },
  }),
  Greet: clip({
    name: "Greet",
    duration: 1.5,
    squashAnchor: -1,
    tracks: {
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.18, v: [0, 0, -12] }, { t: 0.42, v: [0, 0, 12] }, { t: 0.66, v: [0, 0, -9] },
        { t: 0.9, v: [0, 0, 6] }, { t: 1.15, v: [0, 0, 0] }, { t: 1.5, v: [0, 0, 0] },
      ],
      position: [{ t: 0, v: [0, 0] }, { t: 0.28, v: [0, 0.1], ease: OUT }, { t: 0.52, v: [0, 0], ease: IN }, { t: 1.5, v: [0, 0] }],
      expression: [{ t: 0.04, v: "happy" }, { t: 1.35, v: "neutral", cut: false }],
    },
  }),
  Yawn: clip(fromRest({
    name: "Yawn",
    duration: 2.4,
    squashAnchor: -1,
    tracks: {
      squash: [{ t: 0, v: [1, 1] }, { t: 0.5, v: [0.94, 1.1] }, { t: 1.3, v: [0.94, 1.12] }, { t: 1.7, v: [1.04, 0.97] }, { t: 2.1, v: [1, 1] }],
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.6, v: [-9, 0, 0] }, { t: 1.3, v: [-9, 0, 0] }, { t: 1.9, v: [0, 0, 0] }, { t: 2.4, v: [0, 0, 0] }],
      lids: [{ t: 0, v: [0] }, { t: 0.5, v: [0.55] }, { t: 1.3, v: [0.72] }, { t: 1.75, v: [0] }],
      expression: [{ t: 0.35, v: "calm", cut: false }, { t: 1.8, v: "neutral", cut: false }],
    },
  })),
  Stretch: clip(fromRest({
    name: "Stretch",
    duration: 1.8,
    squashAnchor: -1,
    tracks: {
      squash: [{ t: 0, v: [1, 1] }, { t: 0.45, v: [0.88, 1.16] }, { t: 1, v: [0.9, 1.14] }, { t: 1.25, v: [1.06, 0.95] }, { t: 1.5, v: [1, 1] }],
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.45, v: [0, 0, 6] }, { t: 1, v: [0, 0, -6] }, { t: 1.4, v: [0, 0, 0] }, { t: 1.8, v: [0, 0, 0] }],
      expression: [{ t: 0.3, v: "calm", cut: false }, { t: 1.35, v: "neutral", cut: false }],
    },
  })),
  GlanceLeft: clip(fromRest({
    name: "GlanceLeft",
    duration: 2.2,
    tracks: {
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.35, v: [0, -24, 0], ease: OUT }, { t: 1.5, v: [0, -22, 0] }, { t: 1.9, v: [0, 0, 0] }, { t: 2.2, v: [0, 0, 0] }],
      position: [{ t: 0, v: [0, 0] }, { t: 0.35, v: [-0.06, 0], ease: OUT }, { t: 1.5, v: [-0.06, 0] }, { t: 1.9, v: [0, 0] }],
      expression: [{ t: 0.22, v: "blink" }, { t: 0.6, v: "inspecting", cut: false }, { t: 1.6, v: "neutral", cut: false }],
    },
  })),
  GlanceRight: clip(fromRest({
    name: "GlanceRight",
    duration: 2.2,
    tracks: {
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.35, v: [2, 14, 0], ease: OUT }, { t: 1.5, v: [2, 12, 0] }, { t: 1.9, v: [0, 0, 0] }, { t: 2.2, v: [0, 0, 0] }],
      position: [{ t: 0, v: [0, 0] }, { t: 0.35, v: [0.06, 0], ease: OUT }, { t: 1.5, v: [0.06, 0] }, { t: 1.9, v: [0, 0] }],
      expression: [{ t: 0.22, v: "blink" }, { t: 0.6, v: "inspecting", cut: false }, { t: 1.6, v: "neutral", cut: false }],
    },
  })),
  LookAround: clip(fromRest({
    name: "LookAround",
    duration: 3,
    tracks: {
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.4, v: [-4, -22, 0], ease: OUT }, { t: 0.95, v: [-4, -20, 0] }, { t: 1.5, v: [-4, 13, 0] },
        { t: 2.1, v: [-4, 11, 0] }, { t: 2.6, v: [0, 0, 0] }, { t: 3, v: [0, 0, 0] },
      ],
      expression: [{ t: 0.3, v: "blink" }, { t: 1.3, v: "blink" }, { t: 1.6, v: "inspecting", cut: false }, { t: 2.5, v: "neutral", cut: false }],
    },
  })),
  DoubleBlink: clip(fromRest({
    name: "DoubleBlink",
    duration: 0.9,
    tracks: { expression: [{ t: 0.05, v: "blink" }, { t: 0.36, v: "blink" }], position: still(0.9) },
  })),
  Startle: clip({
    name: "Startle",
    duration: 0.95,
    squashAnchor: -1,
    tracks: {
      position: [{ t: 0, v: [0, 0] }, { t: 0.12, v: [0, 0.18], ease: IN }, { t: 0.36, v: [0, 0] }, { t: 0.95, v: [0, 0] }],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.06, v: [0.86, 1.16] }, { t: 0.37, v: [1.1, 0.9] }, { t: 0.55, v: [1, 1] }],
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.42, v: [0, 0, 6] }, { t: 0.52, v: [0, 0, -6] }, { t: 0.62, v: [0, 0, 4] }, { t: 0.74, v: [0, 0, 0] }],
      expression: [{ t: 0, v: "surprised", cut: true }, { t: 0.86, v: "neutral", cut: false }],
    },
  }),
  // a failed turn, the quieter way: it shrinks back, squints, then shakes it off
  Wince: clip({
    name: "Wince",
    duration: 1.2,
    squashAnchor: -1,
    tracks: {
      squash: [{ t: 0, v: [1, 1] }, { t: 0.14, v: [1.09, 0.9], ease: OUT }, { t: 0.55, v: [1.06, 0.94] }, { t: 0.8, v: [0.98, 1.02] }, { t: 1, v: [1, 1] }],
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.16, v: [-8, 0, 0], ease: OUT }, { t: 0.55, v: [-6, 0, 0] }, { t: 0.68, v: [-3, 0, 5] },
        { t: 0.8, v: [-2, 0, -5] }, { t: 0.92, v: [0, 0, 3] }, { t: 1.05, v: [0, 0, 0] }, { t: 1.2, v: [0, 0, 0] },
      ],
      position: [{ t: 0, v: [0, 0] }, { t: 0.16, v: [0, -0.04], ease: OUT }, { t: 0.6, v: [0, -0.03] }, { t: 0.95, v: [0, 0] }],
      expression: [{ t: 0, v: "squinted", cut: true }, { t: 0.62, v: "confused", cut: false }, { t: 1.1, v: "neutral", cut: false }],
    },
  }),
  Wiggle: clip(fromRest({
    name: "Wiggle",
    duration: 1.1,
    squashAnchor: -1,
    tracks: {
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.12, v: [0, 0, 9] }, { t: 0.28, v: [0, 0, -9] }, { t: 0.44, v: [0, 0, 8] },
        { t: 0.6, v: [0, 0, -6] }, { t: 0.76, v: [0, 0, 3] }, { t: 0.92, v: [0, 0, 0] },
      ],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.2, v: [1.05, 0.96] }, { t: 0.5, v: [0.97, 1.03] }, { t: 0.9, v: [1, 1] }],
      expression: [{ t: 0.04, v: "happy" }, { t: 1, v: "neutral", cut: false }],
    },
  })),
  DozeIn: clip(fromRest({
    name: "DozeIn",
    duration: 1.8,
    tracks: {
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 1.4, v: [10, 0, 3] }, { t: 1.8, v: [10, 0, 3] }],
      position: [{ t: 0, v: [0, 0] }, { t: 1.4, v: [0, -0.03] }, { t: 1.8, v: [0, -0.03] }],
      lids: [{ t: 0, v: [0] }, { t: 0.5, v: [0.4] }, { t: 0.8, v: [0.2] }, { t: 1.3, v: [0.9] }],
      expression: [{ t: 1.1, v: "sleepy", cut: false }],
    },
  })),
  Breath: clip(fromRest({
    name: "Breath",
    duration: 3.2,
    squashAnchor: -1,
    tracks: {
      squash: [{ t: 0, v: [1, 1] }, { t: 1.4, v: [1.035, 0.97] }, { t: 3, v: [1, 1] }],
      position: still(3.2),
    },
  })),
  // the click and open answers (mascot-click.ts): small, from the rest pose, each with its own face
  BlinkSmile: clip(fromRest({
    name: "BlinkSmile",
    duration: 1.1,
    squashAnchor: -1,
    tracks: {
      squash: [{ t: 0, v: [1, 1] }, { t: 0.42, v: [1.03, 0.97] }, { t: 0.62, v: [0.99, 1.01] }, { t: 0.9, v: [1, 1] }],
      expression: [{ t: 0.04, v: "blink" }, { t: 0.32, v: "blink" }, { t: 0.44, v: "happy", cut: false }, { t: 0.98, v: "neutral", cut: false }],
    },
  })),
  Curious: clip(fromRest({
    name: "Curious",
    duration: 1.4,
    tracks: {
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.3, v: [-5, 8, 10], ease: OUT }, { t: 1, v: [-5, 8, 9] }, { t: 1.35, v: [0, 0, 0] }, { t: 1.4, v: [0, 0, 0] }],
      position: [{ t: 0, v: [0, 0] }, { t: 0.3, v: [0.03, 0.01], ease: OUT }, { t: 1, v: [0.03, 0.01] }, { t: 1.35, v: [0, 0] }],
      expression: [{ t: 0.08, v: "inspecting", cut: false }, { t: 0.72, v: "blink" }, { t: 1.15, v: "neutral", cut: false }],
    },
  })),
  Tilt: clip(fromRest({
    name: "Tilt",
    duration: 1.2,
    tracks: {
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.25, v: [0, 0, -13], ease: OUT }, { t: 0.55, v: [0, 0, -11] }, { t: 0.76, v: [0, 0, 4] },
        { t: 0.95, v: [0, 0, -1] }, { t: 1.2, v: [0, 0, 0] },
      ],
      position: [{ t: 0, v: [0, 0] }, { t: 0.25, v: [-0.03, 0.02], ease: OUT }, { t: 0.6, v: [-0.02, 0.01] }, { t: 0.95, v: [0, 0] }],
      expression: [{ t: 0.1, v: "confused", cut: false }, { t: 0.62, v: "blink" }, { t: 1.05, v: "neutral", cut: false }],
    },
  })),
  Squish: clip(fromRest({
    name: "Squish",
    duration: 0.9,
    squashAnchor: -1,
    tracks: {
      squash: [
        { t: 0, v: [1, 1] }, { t: 0.1, v: [1.16, 0.84], ease: OUT }, { t: 0.26, v: [0.92, 1.1] }, { t: 0.42, v: [1.05, 0.96] },
        { t: 0.58, v: [0.99, 1.01] }, { t: 0.75, v: [1, 1] },
      ],
      expression: [{ t: 0, v: "squinted", cut: true }, { t: 0.5, v: "blink" }, { t: 0.72, v: "neutral", cut: false }],
    },
  })),
  // a softer startle: it perks up, wide-eyed, and blinks it off
  Perk: clip(fromRest({
    name: "Perk",
    duration: 0.95,
    squashAnchor: -1,
    tracks: {
      position: [{ t: 0, v: [0, 0] }, { t: 0.1, v: [0, 0.08], ease: OUT }, { t: 0.3, v: [0, 0] }, { t: 0.95, v: [0, 0] }],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.04, v: [0.94, 1.07] }, { t: 0.32, v: [1.04, 0.97] }, { t: 0.5, v: [1, 1] }],
      rotation: [{ t: 0, v: [0, 0, 0] }, { t: 0.12, v: [6, 0, 0], ease: OUT }, { t: 0.6, v: [3, 0, 0] }, { t: 0.9, v: [0, 0, 0] }],
      expression: [{ t: 0, v: "surprised", cut: true }, { t: 0.55, v: "blink" }, { t: 0.85, v: "neutral", cut: false }],
    },
  })),
  // clicked again and again: it wobbles, a little dizzy
  Dizzy: clip(fromRest({
    name: "Dizzy",
    duration: 1.6,
    squashAnchor: -1,
    tracks: {
      rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 0.15, v: [0, -10, 10] }, { t: 0.4, v: [0, 10, -10] }, { t: 0.65, v: [0, -8, 8] },
        { t: 0.9, v: [0, 6, -6] }, { t: 1.15, v: [0, -3, 3] }, { t: 1.4, v: [0, 0, 0] }, { t: 1.6, v: [0, 0, 0] },
      ],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.3, v: [1.04, 0.97] }, { t: 0.7, v: [0.98, 1.02] }, { t: 1.1, v: [1, 1] }],
      expression: [{ t: 0.05, v: "squinted", cut: false }, { t: 0.5, v: "confused", cut: false }, { t: 1, v: "blink" }, { t: 1.3, v: "neutral", cut: false }],
    },
  })),
  // a dozing mark that gets clicked: heavy lids, a long stretch, then it is with you
  SleepyStretch: clip(fromRest({
    name: "SleepyStretch",
    duration: 2,
    squashAnchor: -1,
    tracks: {
      lids: [{ t: 0, v: [0.75] }, { t: 0.5, v: [0.5] }, { t: 1.1, v: [0.15] }, { t: 1.5, v: [0] }],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.55, v: [0.9, 1.14] }, { t: 1.05, v: [0.9, 1.15] }, { t: 1.35, v: [1.05, 0.96] }, { t: 1.6, v: [1, 1] }],
      rotation: [{ t: 0, v: [10, 0, 3] }, { t: 0.6, v: [-4, 0, 0] }, { t: 1.1, v: [-4, 0, 0] }, { t: 1.5, v: [0, 0, 0] }, { t: 2, v: [0, 0, 0] }],
      position: [{ t: 0, v: [0, -0.03] }, { t: 0.6, v: [0, 0.02] }, { t: 1.5, v: [0, 0] }],
      expression: [{ t: 0.05, v: "sleepy", cut: false }, { t: 0.9, v: "calm", cut: false }, { t: 1.45, v: "blink" }, { t: 1.7, v: "neutral", cut: false }],
    },
  })),
  Wake: clip({
    name: "Wake",
    duration: 1.2,
    squashAnchor: -1,
    tracks: {
      position: [{ t: 0, v: [0, 0] }, { t: 0.2, v: [0, 0.1], ease: OUT }, { t: 0.45, v: [0, 0], ease: IN }, { t: 1.2, v: [0, 0] }],
      squash: [{ t: 0, v: [1, 1] }, { t: 0.08, v: [0.92, 1.08] }, { t: 0.46, v: [1.08, 0.93] }, { t: 0.65, v: [1, 1] }],
      expression: [{ t: 0.04, v: "surprised", cut: true }, { t: 0.6, v: "blink" }, { t: 1, v: "neutral", cut: false }],
    },
  }),
} satisfies Record<string, MarkClip>;

export type OmbClipName = keyof typeof OMB_CLIPS;

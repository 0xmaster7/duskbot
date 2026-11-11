// types for the dusk bot engine (index.js) and its geometry (geometry.js)

export type BodyName = 'circle' | 'squircle' | 'pill' | 'hex' | 'star' | 'heart' | 'drop' | 'moon' | 'cloud' | 'pixel';
export type BodyAlias = 'clover' | 'capsule' | 'gem' | 'blob' | 'teardrop' | 'square' | 'crescent';

export type BotState =
  | 'idle' | 'sleeping' | 'waking' | 'drowsy' | 'listening' | 'thinking' | 'searching' | 'working' | 'excited'
  | 'surprised' | 'suspicious' | 'angry' | 'happy' | 'curious' | 'confused' | 'bored' | 'proud' | 'shy' | 'sad'
  | 'laughing' | 'scared' | 'playful' | 'celebrate' | 'finished'
  | 'asleep' | 'sleep' | 'done' | 'listen' | 'think' | 'search' | 'busy' | 'startled' | 'excite' | 'laugh' | 'joy';

export type BotReaction =
  | 'hop' | 'bounce' | 'nod' | 'nudge' | 'greet' | 'wiggle' | 'startle' | 'surprise' | 'squish' | 'twirl' | 'dizzy'
  | 'open' | 'perk' | 'stretch' | 'huff' | 'shake' | 'sigh' | 'peek' | 'laugh' | 'celebrate' | 'tap' | 'blink';

export type FaceName = keyof typeof FACES;

export interface Body {
  /** the outline, in a 100 by 100 box */
  d: string;
  /** the y the body stands on: squash, stretch and lean pivot there */
  foot: number;
  /** face centre x, y, half the eye gap, eye radius, optional turn in degrees */
  face: [number, number, number, number, number?];
}

export const BODIES: Record<BodyName, Body>;
export const ALIAS: Record<BodyAlias, BodyName>;
export const FACES: Record<string, { l: number[]; r?: number[]; m: number[]; k: number }>;
export const INK: string;
export const STATES: BotState[];
export const REACTIONS: BotReaction[];

export function bodyName(name: string): BodyName;
export function eyeD(top: number, bottom: number): string;
export function mouthD(halfWidth: number, smile: number, open: number): string;
/** the inside of a bot's svg (viewBox 0 0 100 100) */
export function botSvg(body: BodyName | BodyAlias | string, face?: string, ink?: string): string;
/** a whole bot as an svg string, for server or build-time rendering */
export function restSvg(body: BodyName | BodyAlias | string, opts?: { colour?: string; eyes?: string; face?: string; className?: string; attrs?: string }): string;
/** a look direction for a pointer at (x, y) client px, seen from a bot drawn in rect; null past reach px */
export function pointerGaze(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, reach?: number): { x: number; y: number } | null;

export interface CreateOptions {
  body?: BodyName | BodyAlias | string;
  /** css colour for the body; otherwise it takes currentColor */
  colour?: string;
  /** eye and mouth colour, INK by default */
  eyes?: string;
  state?: BotState;
  /** drawn size in px; measured when left out. under 28 px the bot skips breathing */
  size?: number;
  /** animate only while on screen (default true) */
  observe?: boolean;
  /** force reduced motion on or off; follows prefers-reduced-motion when left out */
  reducedMotion?: boolean;
}

export interface Bot {
  readonly el: Element;
  readonly body: BodyName;
  readonly state: BotState;
  setState(state: BotState): void;
  react(kind: BotReaction): void;
  /** a direction in -1..1 (x right, y down), or null to look about on its own */
  lookAt(x: number | null, y?: number): void;
  blink(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/** brings a bot to life inside target: an svg or g holding botSvg output, or an empty element to draw one into */
export function create(target: Element, opts?: CreateOptions): Bot;

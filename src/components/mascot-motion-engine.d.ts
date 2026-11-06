// types for the generated grok mark engine in mascot-motion-engine.js

export type MarkShape = string;
export type MarkGaze = [number, number];
export type MarkPoke = "spin" | "bounce" | "nod";
export type MarkLook = "left" | "right" | "up" | "down" | "center";

export interface MarkAppearance {
  ink: [number, number, number];
  spot: [number, number, number];
  cutout: boolean;
  inkPaint: string;
  spotPaint?: string;
}

/** One drawn frame, opaque to callers: build it into markup with markTree. */
export interface MarkFrame {
  readonly body: MarkShape;
}

export interface MarkAnimator {
  readonly isPlaying: boolean;
  /** Seconds in the loaded clip. */
  readonly duration: number;
  readonly isSettled: boolean;
  readonly loopCount: number;
  readonly face: string;
  load(clip: MarkClip, options?: { isPlaying?: boolean; transition?: "bridge" | "cut"; phase?: number }): void;
  play(): void;
  pause(): void;
  rest(): void;
  seek(seconds: number): void;
  setBody(body: MarkShape, options?: { isInstant?: boolean }): void;
  setMorph(morph: string | null, options?: { isInstant?: boolean }): void;
  setExpression(expression: string, options?: { isThroughBlink?: boolean }): void;
  holdFace(face: string | null): void;
  poke(kind: MarkPoke, options?: { turns?: number }): void;
  blink(): void;
  setGaze(gaze: MarkGaze | null): void;
  setGazeAlways(isAlways: boolean): void;
  look(direction: MarkLook): void;
  advance(seconds: number): void;
  frame(): MarkFrame;
}

export interface MarkStateDriver {
  readonly state: string;
  readonly clip: string | null;
  setState(state: string): void;
  setCompact(isCompact: boolean): void;
  setEmphasis(isEmphasized: boolean): void;
  setResting(isResting: boolean): void;
  advance(seconds: number): void;
}

export interface MarkRecipe {
  clips: string[];
  compactClips?: string[];
  face?: string;
  morph?: string;
  next?: string;
  holdSeconds?: number;
}

/** One authored clip: tracks for body, rotation, lids and expression keys. */
export interface MarkClip {
  readonly name: string;
  readonly duration: number;
}

export interface MarkNode {
  tag: string;
  attrs: Record<string, string | number>;
  children: MarkNode[];
}

export const MARK_FILL: number;
export const MARK_RECIPES: Record<string, MarkRecipe>;
export function createAnimator(options?: { body?: MarkShape }): MarkAnimator;
export function createStateDriver(
  animator: MarkAnimator,
  state: string,
  options?: { seed?: number; isCompact?: boolean; isResting?: boolean; firstPhase?: number },
): MarkStateDriver;
export function gazeFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  pointer: { x: number; y: number },
  range?: number,
): MarkGaze;
export function markAppearance(inkPaint: string, spotPaint?: string): MarkAppearance;
export function markFillScale(fill: number): number;
export function markShapeFor(body: string): MarkShape;
export function markTree(
  frame: MarkFrame,
  appearance: MarkAppearance,
  resolution: number,
  id: string,
  options?: { isProof?: boolean; displaySize?: number; extent?: string },
): MarkNode;
export function morphSeconds(morph: string): number;
export function markClip(name: string): MarkClip;
export const MARK_CLIPS: ReadonlyMap<string, MarkClip>;
/** The rest pose's [pitch, yaw, roll] in degrees. */
export const MARK_REST_ROTATION: readonly [number, number, number];
/** Grok's seeded PRNG: the same seed gives the same sequence in [0, 1). */
export function seededRandom(seed: number): () => number;
export function patchMark(canvas: Element, tree: MarkNode): void;

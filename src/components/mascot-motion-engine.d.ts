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
  readonly isSettled: boolean;
  readonly loopCount: number;
  readonly face: string;
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
export function patchMark(canvas: Element, tree: MarkNode): void;

export type BodyName = "circle" | "squircle" | "pill" | "hex" | "star" | "heart" | "drop" | "moon" | "cloud" | "pixel";

export interface Body {
  /** the outline, in a 100 by 100 box */
  d: string;
  /** the y the body stands on: squash, stretch and lean pivot there */
  foot: number;
  /** face centre x, y, half the eye gap, eye radius, optional turn in degrees */
  face: [number, number, number, number, number?];
}

/** each eye [size, top, bottom, droop], the mouth [half width, smile, open] and blush */
export interface Face { l: number[]; r?: number[]; m: number[]; k: number }

export declare const INK: string;
export declare const BODIES: Readonly<Record<BodyName, Body>>;
export declare const BODY_NAMES: readonly BodyName[];
export declare const FACES: Readonly<Record<string, Face>>;
export declare function bodyName(name: string): BodyName;
export declare function eyeD(top: number, bottom: number): string;
export declare function mouthD(halfWidth: number, smile: number, open: number): string;
export declare function botSvg(body: string, face?: string, ink?: string): string;
export declare function restSvg(body: string, opts?: { colour?: string; eyes?: string; face?: string; className?: string; attrs?: string }): string;

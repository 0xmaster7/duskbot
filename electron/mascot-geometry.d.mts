export type BodyName = "circle" | "squircle" | "pill" | "hex" | "star" | "heart" | "drop" | "moon" | "cloud" | "pixel";

export interface Body {
  /** the outline, in a 100 by 100 box */
  d: string;
  /** the y the body stands on: squash, stretch and lean pivot there */
  foot: number;
  /** face centre x, y, half the eye gap, eye radius, optional turn in degrees */
  face: [number, number, number, number, number?];
  /** turns like a ball and keeps its outline */
  round?: boolean;
}

/** eyes only: each eye [size, top, bottom, droop]; r is the right eye when it differs */
export interface Face { l: number[]; r?: number[] }

export declare const INK: string;
export declare const BODIES: Readonly<Record<BodyName, Body>>;
export declare const BODY_NAMES: readonly BodyName[];
export declare const FACES: Readonly<Record<string, Face>>;
export declare function bodyName(name: string): BodyName;
export declare function eyeD(top: number, bottom: number): string;
/** the inside of one eye in unit size; restyle eyes here */
export declare function eyeSvg(ink: string, top?: number, bottom?: number): string;
export declare function botSvg(body: string, face?: string, ink?: string): string;
export declare function restSvg(body: string, opts?: { colour?: string; eyes?: string; face?: string; className?: string; attrs?: string }): string;

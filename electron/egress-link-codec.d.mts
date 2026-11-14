export type EgressLinkFrame = { t: "bytes"; r: string; b: Buffer } | { t: string; r?: string; [key: string]: unknown };
export declare const CONTROL: 0;
export declare const BYTES: 1;
export declare const MAX_RECORD: number;
export declare function encodeControl(frame: Record<string, unknown>): Buffer;
export declare function encodeBytes(r: string, chunk: Buffer): Buffer;
export declare function linkReader(onFrame: (frame: EgressLinkFrame) => void): (chunk: Buffer) => void;

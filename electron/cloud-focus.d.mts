export declare const FOCUS_PING_MS: number;
export declare const FOCUS_CAP_MS: number;
export declare const FOCUS_CHECK_MS: number;
export declare function createCloudFocus(deps: {
  origin(): string | null; focused(): boolean; lastInput?(): number; fetch: typeof fetch; now?(): number; pingMs?: number; capMs?: number; checkMs?: number;
  every?(work: () => void, ms: number): unknown; stop?(timer: unknown): void; log?(line: string): void;
}): { check(): boolean; close(): void };

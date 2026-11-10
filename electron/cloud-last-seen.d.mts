import type { LastSeen } from "./home-window.mjs";
export declare const LAST_SEEN_BOTS: number;
export declare const LAST_SEEN_MESSAGES: number;
export declare const LAST_SEEN_TEXT: number;
export declare function parseLastSeen(input: unknown): LastSeen | null;
export declare function createLastSeenStore(deps: {
  file: string;
  encryption: { available(): Promise<boolean>; encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> };
  fs?: unknown;
  now?(): number;
}): { read(origin: string): Promise<LastSeen | null>; write(origin: string, snapshot: unknown): Promise<boolean>; forget(): Promise<void> };

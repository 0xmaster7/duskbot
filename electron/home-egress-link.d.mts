import type { Duplex } from "node:stream";

export declare const HOME_EGRESS_LINK_PATH: string;
export declare const CHECK_MS: number;
export declare const RETRY_MS: number[];
export interface HomeEgressTunnel { send(frame: object): boolean; bytes(r: string, chunk: Buffer): boolean; queued(): number; onDrain(fn: () => void): void }
export declare function createHomeEgressLink(deps: {
  origin(): string | null;
  awake(): boolean;
  cookie(origin: string): Promise<string | null>;
  connect(url: string, headers: Record<string, string>): Promise<{ readable: Duplex; close(): void }>;
  endpoint(tunnel: HomeEgressTunnel): { start(): void; handle(frame: object, via?: string): boolean; close(): void };
  log?(line: string): void;
  now?(): number;
  checkMs?: number;
}): { check(): void; linked(): boolean; close(): void };

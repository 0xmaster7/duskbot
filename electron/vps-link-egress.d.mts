import type { BlockList, Socket } from "node:net";
import type { networkInterfaces } from "node:os";

export declare const EGRESS_PORTS: readonly number[];
export declare const EGRESS_MAX_STREAMS: number;
export declare const EGRESS_DIALS_PER_MINUTE: number;
export declare const EGRESS_BYTES_PER_SECOND: number;
export declare const EGRESS_QUEUE_HIGH: number;
export declare const EGRESS_HELLO_MS: number;
export type EgressRefusal = "port" | "home-network" | "loopback" | "metadata" | "link-local" | "reserved";
export declare function egressNameRefusal(host: string): EgressRefusal | null;
export declare function egressRefusal(port: number, addresses: string[], lists?: { own?: BlockList; home?: BlockList }): EgressRefusal | null;
export declare function homeAddresses(interfaces: ReturnType<typeof networkInterfaces>, seenAs: string | null): BlockList;
export interface EgressDialer {
  open(target: { host: string; port: number }): Promise<{ socket: Socket } | { refused: string } | { failed: string }>;
}
export declare function createEgressDialer(options?: {
  resolve?(host: string): Promise<Array<{ address: string; family: number }>>;
  connect?(options: object): Socket;
  interfaces?(): ReturnType<typeof networkInterfaces>;
  seenAs?(): Promise<string | null>;
  connectMs?: number;
}): EgressDialer;
export declare function seenAsCache(fetchIp: () => Promise<unknown>, options?: { ttlMs?: number; waitMs?: number; now?(): number }): () => Promise<string | null>;
export interface EgressTunnel {
  send(frame: Record<string, unknown>): void;
  bytes(r: string, chunk: Buffer): boolean;
  queued(): number;
  onDrain(resume: () => void): void;
  log?(line: string): void;
}
export interface EgressEndpoint {
  stats(): { relayed: number; refused: number; active: number };
  start(): void;
  handle(frame: Record<string, unknown>): boolean;
  close(): void;
}
export declare function createEgressEndpoint(options: EgressTunnel & {
  dialer?: EgressDialer; now?(): number; maxStreams?: number; dialsPerMinute?: number; bytesPerSecond?: number;
  queueHigh?: number; helloMs?: number; idleMs?: number;
}): EgressEndpoint;

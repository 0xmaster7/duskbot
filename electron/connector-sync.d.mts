export type Answer = { ok: boolean; status: number; body: any };
export type Call = (method: string, route: string, body?: unknown) => Promise<Answer>;

export interface SyncSignIn { role: "holder" | "lent" | "needs-sign-in" | "none"; digest?: string; expiresAt?: number; signedInAt?: number }
export interface Listing {
  place: { id: string; label: string };
  servers: Array<{ name: string; url: string; enabled: boolean; addedAt: number; signIn: SyncSignIn }>;
  removed: Record<string, number>;
  signedOut: Record<string, number>;
}

export interface PlaceWrites {
  list(): Promise<Listing | null>;
  put(name: string, server: unknown, addedAt: number): Promise<any>;
  remove(name: string, at: number): Promise<any>;
  signOut(name: string, at: number): Promise<any>;
  borrow(name: string, lent: { access: string; expiresAt?: number; from: string; grantAt: number }): Promise<any>;
  adopt(name: string, taken: { record: unknown; signedInAt: number }, replaces?: string | null): Promise<any>;
}
export interface PlaceClient extends PlaceWrites {
  definition(name: string): Promise<any>;
  lend(name: string): Promise<any>;
  take(name: string): Promise<any>;
  release(name: string, digest: string, to: string): Promise<any>;
}
export interface Place { key: string; kind: "local" | "cloud" | "sleeping-cloud" | "server"; label: string; client: PlaceClient }
export interface SyncResult {
  added: Array<{ name: string; place: string }>;
  removed: Array<{ name: string; place: string }>;
  signedOut: Array<{ name: string; place: string }>;
  moved: Array<{ name: string; from: string; to: string }>;
  lent: Array<{ name: string; place: string }>;
  failed: string[];
}

export const TOPUP_MS: number;
export function parseListing(value: unknown): Listing | null;
export function writes(call: Call): PlaceWrites;
export function remotePlace(call: Call): PlaceClient;
export function localPlace(request: (route: string, init?: RequestInit) => Promise<Response>, handoff: (what: object) => Promise<any>): PlaceClient;
export function syncConnectors(places: Place[], options?: { now?: () => number; log?: (line: string) => void }): Promise<SyncResult>;
export function bringSignInsHome(remote: PlaceClient, local: PlaceWrites, options?: { label?: string }): Promise<string[]>;

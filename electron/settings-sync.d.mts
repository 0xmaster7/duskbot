export type Answer = { ok: boolean; status: number; body: any };
export type Call = (method: string, route: string, body?: unknown) => Promise<Answer>;

export interface SettingEntry { digest: string; at: number; kind: "plain" | "secret"; set: boolean }
export interface SettingsListing { place: { id: string; label: string }; settings: Record<string, SettingEntry> }
export interface SettingsClient {
  list(): Promise<SettingsListing | null>;
  values(keys: string[]): Promise<Record<string, unknown>>;
  put(key: string, value: unknown, at: number): Promise<any>;
}
export interface SettingsPlace { key: string; kind: "local" | "cloud" | "sleeping-cloud" | "server"; label: string; client: SettingsClient }
export interface SettingsResult { changed: Array<{ key: string; place: string }>; failed: string[] }

export const REFUSED_MS: number;
export function parseSettingsListing(value: unknown): SettingsListing | null;
export function remoteSettingsPlace(call: Call): SettingsClient;
export function localSettingsPlace(request: (route: string, init?: RequestInit) => Promise<Response>, handoff: (what: object) => Promise<any>,
  options?: { saveSecret?: (key: string, value: unknown) => Promise<boolean> }): SettingsClient;
export function syncSettings(places: SettingsPlace[], options?: { now?: () => number; log?: (line: string) => void; refused?: Map<string, number> }): Promise<SettingsResult>;

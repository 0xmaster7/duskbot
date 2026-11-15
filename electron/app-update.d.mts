/** `available`: a newer version was found; `progress` (0 to 1) while it downloads; `ready` once it waits for a restart */
export interface AppUpdateState {
  ready: string | null; available?: string | null; progress?: number | null;
  /** a check runs now; `failed`: the last one could not finish */
  checking?: boolean; failed?: boolean;
  /** main's word on how this app updates: "self" installs its own, "dev" runs from a code checkout, "notice" points at the download page */
  mode?: "self" | "dev" | "notice";
  /** the version this app updated to, until the window has said so once */
  updated?: string | null;
}
export interface AppUpdateBridge {
  state(): Promise<AppUpdateState>;
  /** downloads the newer version now (again, after a failed try); the version once ready, null when there is none */
  download?(): Promise<string | null>;
  /** restarts into the downloaded update now; false when none is waiting */
  restart(): Promise<boolean>;
  /** the "updated to" note was shown */
  seen?(): Promise<void>;
  onState(cb: (state: AppUpdateState) => void): () => void;
}
export declare const DESKTOP_MANIFEST_URL: string;
export declare const RELEASE_KEYS: readonly { kid: string; x: string }[];
export declare const QUIET_IDLE_MS: number;
export declare function sumsUrl(version: string): string;
export declare function zipUrl(version: string, name: string): string;
export declare function verifiedRelease(body: unknown, keys?: readonly { kid: string; x: string }[]): { version: string; sums: string } | null;
export declare function newer(a: string, b: string): boolean;
export declare function zipIn(sums: string, version: string, arch: string): { name: string; sha256: string } | null;
export declare function developerIdSigned(bundle: string, run?: (file: string, args: string[]) => Promise<string>): Promise<boolean>;
export interface AppInstaller { prepare(file: string, version: string): Promise<void>; install(): void }
export declare function squirrelInstaller(options: { autoUpdater: unknown; timeoutMs?: number }): AppInstaller;
export declare function quietNow(signals: { locked(): boolean; idleMs(): number; typedAt(): number; work(): Promise<string | null>; busy?(): string | null; focused?(): boolean }, now?: number): Promise<boolean>;
export declare function justUpdated(memory: { read(): { version?: string } | null; write(value: { version: string }): void }, current: string, installedHere?: () => boolean): boolean;
export interface AppUpdater { check(): Promise<string | null>; restart(): boolean; state(): AppUpdateState; start(): void; soon(delayMs?: number): void; stop(): void }
export declare function createAppUpdater(options: {
  current: string; arch: string; dir: string; fetchImpl?: typeof fetch; keys?: readonly { kid: string; x: string }[];
  signed(): Promise<boolean>; installer: AppInstaller; quiet(): Promise<boolean>; fallback: { check(): Promise<unknown> };
  onState?(state: AppUpdateState): void; log?(line: string): void; firstDelayMs?: number; intervalMs?: number; jitterMs?: number; random?: () => number; quietEveryMs?: number;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}): AppUpdater;

export interface AppUpdateState { ready: string | null }
export interface AppUpdateBridge {
  state(): Promise<AppUpdateState>;
  /** restarts into the downloaded update now; false when none is waiting */
  restart(): Promise<boolean>;
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
export declare function quietNow(signals: { locked(): boolean; idleMs(): number; typedAt(): number; work(): Promise<string | null>; busy?(): string | null }, now?: number): Promise<boolean>;
export interface AppUpdater { check(): Promise<string | null>; restart(): boolean; state(): AppUpdateState; start(): void; stop(): void }
export declare function createAppUpdater(options: {
  current: string; arch: string; dir: string; fetchImpl?: typeof fetch; keys?: readonly { kid: string; x: string }[];
  signed(): Promise<boolean>; installer: AppInstaller; quiet(): Promise<boolean>; fallback: { check(): Promise<unknown> };
  onState?(state: AppUpdateState): void; log?(line: string): void; firstDelayMs?: number; intervalMs?: number; jitterMs?: number; random?: () => number; quietEveryMs?: number;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}): AppUpdater;

export declare const ENTITLEMENT_SKEW_MS: number;
export declare const ENTITLEMENT_MAX_TTL_MS: number;
export declare const PINNED_ENTITLEMENT_KEYS: ReadonlyArray<{ readonly kid: string; readonly x: string }>;
export declare function entitlementKeys(env?: NodeJS.ProcessEnv, packaged?: boolean): Array<{ kid: string; x: string }>;
export declare function verifyEntitlement(token: unknown, options?: { keys?: ReadonlyArray<{ kid: string; x: string }>; audience?: "home" | "app"; cloudId?: string; now?: number }):
  { ok: true; claims: Record<string, unknown> } | { ok: false; error: string };

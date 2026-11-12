export const GRANT_PREFIX: "l1";
export const GRANT_MAX_TTL_MS: number;
export const GRANT_SKEW_MS: number;
export const PINNED_GRANT_KEYS: readonly { kid: string; x: string }[];
export function parseGrantKeys(value: string | undefined): { kid: string; x: string }[] | null;
export function verifyLinkGrant(token: unknown, options: { keys: readonly { kid: string; x: string }[]; now?: number }): { ok: true; acct: string } | { ok: false; error: string };

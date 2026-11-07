import { configSecrets, type CardSealKey, type SealedCardSecret, type SealPurpose } from "../../shared/saved-secrets.ts";
import type { ConfigStatus } from "@/state/config-status";
import { api, ApiError } from "@/state/api";
import { t } from "@/lib/i18n";
import { sealValues, SealTrustError } from "@/lib/card-seal";

let current: Promise<CardSealKey> | null = null;

function sealKey(): Promise<CardSealKey> {
  current ??= api<{ sealKey: CardSealKey }>("/api/seal-key").then((answer) => answer.sealKey);
  current.catch(() => { current = null; });
  return current;
}

const offeredKey = (error: unknown): CardSealKey | undefined => {
  const offered = error instanceof ApiError ? error.body?.sealKey : undefined;
  return offered && typeof offered === "object" ? offered as CardSealKey : undefined;
};

/** Sends `values` sealed for this server, for this purpose and target only, through `send`; nothing to seal sends none.
 * A server that restarted since its key was fetched answers with its new one, and this seals once more for that. */
export async function sendSealed<T>(
  purpose: SealPurpose,
  target: readonly string[],
  values: Record<string, string>,
  send: (sealed: SealedCardSecret | null) => Promise<T>,
): Promise<T> {
  const named = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
  if (!Object.keys(named).length) return send(null);
  try {
    const key = await sealKey();
    try {
      return await send(await sealValues(named, key, purpose, target));
    } catch (error) {
      const fresh = offeredKey(error);
      if (!fresh || fresh.keyId === key.keyId) throw error;
      current = Promise.resolve(fresh);
      return await send(await sealValues(named, fresh, purpose, target));
    }
  } catch (error) {
    if (error instanceof SealTrustError) throw new SealTrustError(t("seal.untrusted"));
    throw error;
  }
}

/** PUT /api/config with every API key in it sealed (shared/saved-secrets.ts CONFIG_SECRET_PATHS); "" removes a key. */
export async function putConfig(patch: Record<string, unknown>): Promise<ConfigStatus> {
  const secrets = configSecrets(patch);
  if (!secrets.size) return api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify(patch) });
  const paths = [...secrets.keys()].sort();
  const rest = withoutPaths(patch, paths);
  return sendSealed("config", paths, Object.fromEntries(secrets), (sealed) =>
    api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ ...rest, sealed, sealedPaths: paths }) }));
}

function withoutPaths(patch: Record<string, unknown>, paths: readonly string[]): Record<string, unknown> {
  const copy = structuredClone(patch);
  for (const path of paths) {
    const parts = path.split(".");
    const parent = parts.slice(0, -1).reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], copy) as Record<string, unknown> | undefined;
    if (parent) delete parent[parts.at(-1)!];
  }
  return copy;
}

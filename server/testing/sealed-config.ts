// a settings patch sealed as the app sends it from a remote client; "" (remove a key) is no secret and stays plain.
import { configSecrets, type CardSealKey } from "../../shared/saved-secrets.ts";
import { sealValues } from "../../src/lib/card-seal.ts";

/** The server's seal key, as GET /api/seal-key hands it to any client. */
export async function fetchSealKey(baseUrl: string, headers: Record<string, string> = {}): Promise<CardSealKey> {
  const response = await fetch(`${baseUrl}/api/seal-key`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GET /api/seal-key answered ${response.status}`);
  return ((await response.json()) as { sealKey: CardSealKey }).sealKey;
}

/** `patch` with its secrets moved into `sealed` + `sealedPaths`; a patch with none comes back as is. */
export async function sealConfigPatch(patch: Record<string, unknown>, key: CardSealKey): Promise<Record<string, unknown>> {
  const secrets = configSecrets(patch);
  if (!secrets.size) return patch;
  const paths = [...secrets.keys()].sort();
  const rest = structuredClone(patch);
  for (const path of paths) {
    const parts = path.split(".");
    const parent = parts.slice(0, -1).reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], rest) as Record<string, unknown> | undefined;
    if (parent) delete parent[parts.at(-1)!];
  }
  const sealed = await sealValues(Object.fromEntries(secrets), key, "config", paths);
  return { ...rest, sealed, sealedPaths: paths };
}

/** Fetches the seal key with `headers` and seals `patch` for a PUT or PATCH /api/config. */
export async function sealedConfigBody(baseUrl: string, patch: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  if (!configSecrets(patch).size) return patch;
  return sealConfigPatch(patch, await fetchSealKey(baseUrl, headers));
}

import { directoryKey, type DirectoryAnswer, type DirectoryApp, type DirectoryProviderState, type DirectorySource } from "../../shared/connector-directory.ts";

/** A source of connectable apps. Each one owns its own sign-in; this only lists what it can connect. */
export interface ConnectorProvider {
  readonly id: DirectorySource;
  /** False when this host has no setup for it (no key, no broker); its catalog is then not asked for. */
  available(): boolean;
  catalog(signal: AbortSignal): Promise<DirectoryApp[]>;
}

const PROVIDER_TIMEOUT_MS = 20_000;

/** Every provider's catalog at once, one row per app: when two providers list the same app, the earlier provider in
 * `providers` keeps it. A provider that fails or times out drops out and is reported, the rest still answer. */
export async function connectorDirectory(providers: readonly ConnectorProvider[], timeoutMs = PROVIDER_TIMEOUT_MS): Promise<DirectoryAnswer> {
  const answers = await Promise.all(providers.map(async (provider): Promise<{ state: DirectoryProviderState; apps: DirectoryApp[] }> => {
    if (!provider.available()) return { state: { id: provider.id, available: false, ok: true, count: 0 }, apps: [] };
    try {
      const apps = (await provider.catalog(AbortSignal.timeout(timeoutMs))).filter((app) => app.id && app.label);
      return { state: { id: provider.id, available: true, ok: true, count: apps.length }, apps };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      return { state: { id: provider.id, available: true, ok: false, count: 0, error: error.slice(0, 200) }, apps: [] };
    }
  }));
  const seen = new Set<string>();
  const apps: DirectoryApp[] = [];
  for (const { apps: listed } of answers) {
    for (const app of listed) {
      const keys = [directoryKey(app.id), directoryKey(app.label)];
      if (keys.some((key) => seen.has(key))) continue;
      for (const key of keys) seen.add(key);
      apps.push(app);
    }
  }
  return { apps, providers: answers.map(({ state }) => state) };
}

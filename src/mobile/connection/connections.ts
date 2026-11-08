import { useCallback, useEffect, useMemo, useState } from "react";
import type { MobileConnectionRecord, MobileTransport } from "../../../shared/mobile-link";
import { usePlatform, type MobilePlatform } from "../platform";
import { deviceChannelKey, type RelaySecrets } from "../transport/link-crypto";
import { open as openRelay } from "../transport/relay";
import type { PhoneTransport } from "../transport/transport";
import { PairError } from "./pair";

export async function connectToWorkspace(record: MobileConnectionRecord, token: string, platform: MobilePlatform, signal: AbortSignal): Promise<PhoneTransport> {
  const routes: MobileTransport[] = record.via ?? (record.origin ? [record.transport === "companion"
    ? { kind: "companion", url: record.origin, net: "lan", priority: 0 }
    : { kind: "https", url: record.origin }] : []);
  for (const route of routes) {
    signal.throwIfAborted();
    let transport: PhoneTransport | undefined;
    let response: Response;
    try {
      const timed = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      const headers = { Authorization: `Bearer ${token}` };
      if (route.kind === "relay") {
        const relay = record.relay;
        const saved = await platform.secrets.get(`relay.${record.id}`);
        if (!relay?.agentPub || !saved) continue;
        const keys = JSON.parse(saved) as RelaySecrets;
        const key = await deviceChannelKey(keys.priv, relay.agentPub, relay.channel);
        signal.throwIfAborted();
        const channel = openRelay(relay.base, relay.channel, keys.token, key);
        transport = { kind: "relay", channel, token };
        response = await channel.request("GET", "/api/auth/session", headers, null, timed);
      } else {
        if (route.kind === "companion" && !platform.native) continue;
        transport = { kind: "bearer", origin: route.url, token };
        response = await fetch(`${route.url}/api/auth/session`, { headers, credentials: "omit", redirect: "error", signal: timed });
      }
      await response.body?.cancel().catch(() => {});
    } catch {
      if (transport?.kind === "relay") transport.channel.close();
      continue;
    }
    if (signal.aborted || !response.ok) {
      if (transport.kind === "relay") transport.channel.close();
      signal.throwIfAborted();
      if (response.status === 401) throw new PairError("refused");
      continue;
    }
    return transport;
  }
  signal.throwIfAborted();
  throw new PairError("unreachable");
}

const CONNECTIONS_KEY = "omb.mobile.connections.v1";
const ACTIVE_KEY = "omb.mobile.active.v1";
type ActiveConnection = { record: MobileConnectionRecord; token: string };
type ConnectionStore = {
  list(): Promise<MobileConnectionRecord[]>;
  active(): Promise<ActiveConnection | null>;
  save(record: MobileConnectionRecord, token: string): Promise<void>;
  setActive(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  touch(id: string): Promise<void>;
};
const stores = new WeakMap<MobilePlatform, ConnectionStore>();

export function createConnectionStore(platform: MobilePlatform): ConnectionStore {
  const existing = stores.get(platform);
  if (existing) return existing;
  let writes = Promise.resolve();
  const serialize = (write: () => Promise<void>) => {
    const next = writes.then(write);
    writes = next.catch(() => {});
    return next;
  };
  const read = async (): Promise<MobileConnectionRecord[]> => {
    const json = await platform.prefs.get(CONNECTIONS_KEY);
    if (!json) return [];
    try {
      const records: unknown = JSON.parse(json);
      return Array.isArray(records) ? records.filter((record): record is MobileConnectionRecord => record && typeof record.id === "string" && typeof record.environmentId === "string" && record.sessionRef === `token.${record.id}`) : [];
    } catch { return []; }
  };
  const write = (records: MobileConnectionRecord[]) => platform.prefs.set(CONNECTIONS_KEY, JSON.stringify(records));
  const store: ConnectionStore = {
    async list() { await writes; return read(); },
    async active() {
      await writes;
      const id = await platform.prefs.get(ACTIVE_KEY);
      const record = (await read()).find((entry) => entry.id === id);
      if (!record) return null;
      const token = await platform.secrets.get(record.sessionRef);
      return token ? { record, token } : null;
    },
    save(record, token) {
      return serialize(async () => {
        const records = await read();
        const replaced = records.filter((entry) => entry.id === record.id || entry.environmentId === record.environmentId && entry.origin === record.origin);
        const saved = { ...record, sessionRef: `token.${record.id}` };
        await platform.secrets.set(saved.sessionRef, token);
        await write([...records.filter((entry) => !replaced.includes(entry)), saved]);
        await platform.prefs.set(ACTIVE_KEY, saved.id);
        for (const old of replaced) if (old.sessionRef !== saved.sessionRef) {
          await platform.secrets.remove(old.sessionRef);
          await platform.secrets.remove(`relay.${old.id}`);
          await platform.prefs.remove(`omb.mobile.push.${old.id}`);
        }
      });
    },
    setActive(id) {
      return serialize(async () => {
        const records = await read();
        const record = records.find((entry) => entry.id === id);
        if (!record || !await platform.secrets.get(record.sessionRef)) throw new Error("connection unavailable");
        await write(records.map((entry) => entry.id === id ? { ...entry, lastUsedAt: Date.now() } : entry));
        await platform.prefs.set(ACTIVE_KEY, id);
      });
    },
    remove(id) {
      return serialize(async () => {
        const records = await read();
        if (await platform.prefs.get(ACTIVE_KEY) === id) await platform.prefs.remove(ACTIVE_KEY);
        await platform.secrets.remove(`token.${id}`);
        await platform.secrets.remove(`relay.${id}`);
        await platform.prefs.remove(`omb.mobile.push.${id}`);
        await write(records.filter((entry) => entry.id !== id));
      });
    },
    touch(id) {
      return serialize(async () => write((await read()).map((entry) => entry.id === id ? { ...entry, lastUsedAt: Date.now() } : entry)));
    },
  };
  stores.set(platform, store);
  return store;
}

export type ConnectionsApi = {
  connections: MobileConnectionRecord[];
  activeId: string | null;
  switchTo(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
};

export function useConnections(): ConnectionsApi {
  const platform = usePlatform();
  const store = useMemo(() => createConnectionStore(platform), [platform]);
  const [connections, setConnections] = useState<MobileConnectionRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const records = await store.list();
    const id = await platform.prefs.get(ACTIVE_KEY);
    setConnections(records);
    setActiveId(id);
  }, [platform, store]);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  const switchTo = useCallback(async (id: string) => {
    await store.setActive(id);
    window.location.reload();
  }, [store]);
  const remove = useCallback(async (id: string) => {
    const wasActive = await platform.prefs.get(ACTIVE_KEY) === id;
    await store.remove(id);
    if (wasActive) window.location.reload();
    else await refresh();
  }, [platform, store, refresh]);
  return { connections, activeId, switchTo, remove, refresh };
}

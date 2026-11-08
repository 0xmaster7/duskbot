import { useCallback, useEffect, useMemo, useState } from "react";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { usePlatform, type MobilePlatform } from "../platform";

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
        for (const old of replaced) if (old.sessionRef !== saved.sessionRef) await platform.secrets.remove(old.sessionRef);
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

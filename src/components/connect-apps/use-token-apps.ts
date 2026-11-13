import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import type { DevicePoll, DeviceStart, TokenAccountView, TokenAppId, TokenAppsStatus } from "../../../shared/app-tokens";

// kept across opens, so the window's first frame already knows what is connected
let remembered: TokenAppsStatus | null = null;

export interface DeviceFlow {
  app: TokenAppId;
  start: DeviceStart;
  state: "waiting" | "failed";
  message?: string;
}

export interface TokenApps {
  status: TokenAppsStatus | null;
  accounts: (app: string) => TokenAccountView[];
  /** `replaces`: the refused account this one takes over, keeping its server so every bot keeps its access. */
  connect: (app: TokenAppId, fields: Record<string, string>, replaces?: string) => Promise<string | null>;
  remove: (id: string) => Promise<void>;
  device: DeviceFlow | null;
  startDevice: (app: TokenAppId, replaces?: string) => Promise<string | null>;
  stopDevice: () => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Apps connected with the person's own token or a device code: what is connected, and connecting one. */
export function useTokenApps(): TokenApps {
  const [status, setStatus] = useState<TokenAppsStatus | null>(() => remembered);
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = (next: TokenAppsStatus) => {
    // a server without this route answers something else: nothing is connected that way there
    const native = next?.native && typeof next.native === "object" ? Object.fromEntries(Object.entries(next.native).map(([id, ready]) => [id, ready === true])) : {};
    const valid: TokenAppsStatus = { accounts: Array.isArray(next?.accounts) ? next.accounts : [], native };
    remembered = valid;
    setStatus(valid);
  };

  useEffect(() => {
    let alive = true;
    (api("/api/app-tokens") as Promise<TokenAppsStatus>)
      .then((next) => { if (alive && next) save(next); })
      .catch(() => {});
    return () => { alive = false; clearTimeout(timer.current); };
  }, []);

  const accounts = useCallback((app: string) => (status?.accounts ?? []).filter((account) => account.app === app), [status]);

  const connect = useCallback(async (app: TokenAppId, fields: Record<string, string>, replaces?: string) => {
    try {
      save(await api(`/api/app-tokens/${app}`, { method: "POST", body: JSON.stringify({ fields, ...(replaces ? { replaces } : {}) }) }) as TokenAppsStatus);
      return null;
    } catch (cause) {
      return message(cause);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    save(await api(`/api/app-tokens/accounts/${id}`, { method: "DELETE" }) as TokenAppsStatus);
  }, []);

  const stopDevice = useCallback(() => { clearTimeout(timer.current); setDevice(null); }, []);

  const startDevice = useCallback(async (app: TokenAppId, replaces?: string) => {
    clearTimeout(timer.current);
    let start: DeviceStart;
    try {
      start = await api(`/api/app-tokens/${app}/device`, { method: "POST", ...(replaces ? { body: JSON.stringify({ replaces }) } : {}) }) as DeviceStart;
    } catch (cause) {
      return message(cause);
    }
    setDevice({ app, start, state: "waiting" });
    // a browser sign-in has no code to read first: its page opens right away
    if (!start.userCode) void openExternalLink(start.verificationUrl);
    const deadline = Date.now() + start.expiresIn * 1000;
    const poll = async () => {
      let answer: DevicePoll;
      try { answer = await api(`/api/app-tokens/device/${start.handle}`) as DevicePoll; }
      catch { answer = { status: "waiting" }; }
      if (answer.status === "connected") {
        setDevice(null);
        save(await api("/api/app-tokens") as TokenAppsStatus);
        return;
      }
      if (answer.status === "failed" || Date.now() > deadline) {
        setDevice({ app, start, state: "failed", ...(answer.status === "failed" ? { message: answer.message } : {}) });
        return;
      }
      timer.current = setTimeout(() => void poll(), start.interval * 1000);
    };
    timer.current = setTimeout(() => void poll(), start.interval * 1000);
    return null;
  }, []);

  return { status, accounts, connect, remove, device, startDevice, stopDevice };
}

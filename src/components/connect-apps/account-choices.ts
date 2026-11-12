import { useEffect, useState } from "react";

import { api } from "@/state/store";
import type { ConnectorAccount, ConnectorStatus } from "@/lib/connector-status";

/** Which account each app uses: a default per app, and a bot's own pick over it (server/connector-account-choice.ts). */
export interface AccountChoices { defaults: Record<string, string>; bots: Record<string, Record<string, string>> }

const EMPTY: AccountChoices = { defaults: {}, bots: {} };
let known: AccountChoices | null = null;
const watchers = new Set<(next: AccountChoices) => void>();
const publish = (answer: Partial<AccountChoices> | null | undefined) => {
  const next = { defaults: answer?.defaults ?? {}, bots: answer?.bots ?? {} };
  known = next;
  for (const watch of watchers) watch(next);
  return next;
};

export function useAccountChoices() {
  const [choices, setChoices] = useState<AccountChoices>(known ?? EMPTY);
  useEffect(() => {
    watchers.add(setChoices);
    if (!known) void (api("/api/connectors/account-choices") as Promise<AccountChoices>).then((answer) => { publish(answer); }, () => {});
    return () => { watchers.delete(setChoices); };
  }, []);
  /** Resolves false when it could not be saved. null clears the default, or the bot's pick. */
  const choose = (slug: string, accountId: string | null, botId?: string): Promise<boolean> =>
    (api(`/api/connectors/${encodeURIComponent(slug)}/account-choice`, { method: "PUT", body: JSON.stringify({ accountId, ...(botId ? { botId } : {}) }) }) as Promise<AccountChoices>)
      .then((answer) => { publish(answer); return true; }, () => false);
  return { choices, choose };
}

export const activeAccounts = (status: ConnectorStatus | undefined): ConnectorAccount[] =>
  (status?.accounts ?? []).filter((account) => /^active$/i.test(account.status));

/** The account an app uses when a bot has no pick: the one set as default, else the earliest one still active. */
export function defaultAccount(status: ConnectorStatus | undefined, stored: string | undefined): ConnectorAccount | undefined {
  const active = activeAccounts(status);
  return active.find((account) => account.id === stored) ?? active.at(-1);
}

/** A name for the next account that no account of the app has: "account 2", "account 3", ... */
export function nextAccountName(accounts: readonly ConnectorAccount[], word: string): string {
  const taken = new Set(accounts.map((account) => account.alias?.trim().toLowerCase()));
  for (let n = Math.max(2, accounts.length + 1); ; n += 1) {
    const name = `${word} ${n}`;
    if (!taken.has(name)) return name;
  }
}

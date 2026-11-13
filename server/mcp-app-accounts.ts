// A vendor's own MCP server connected more than once, one entry per account of the person's ("notion", "notion-2"): a bot
// mounts one of them, its own pick, else the app's default, else the first one added. The picks live with the Composio
// ones (connector-account-choice.ts) under the app's slug `mcp-<app id>`, with the entry's name as the account.
import { remoteMcpAppFor } from "./remote-mcp-label.ts";

type Choices = { defaults: Record<string, string>; bots: Record<string, Record<string, string>> };

export const appAccountSlug = (appId: string) => `mcp-${appId}`;

const urlOf = (server: unknown): string | undefined =>
  server && typeof server === "object" && typeof (server as { url?: unknown }).url === "string" ? (server as { url: string }).url : undefined;

/** Each catalog app's entries, in the order they were added, for apps that have more than one. */
export function appAccountGroups(servers: Readonly<Record<string, unknown>>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [name, server] of Object.entries(servers)) {
    const app = remoteMcpAppFor(urlOf(server));
    if (app) groups.set(app.id, [...(groups.get(app.id) ?? []), name]);
  }
  for (const [id, names] of groups) if (names.length < 2) groups.delete(id);
  return groups;
}

/** The entry of an app's accounts this bot uses. */
export function chosenAppAccount(appId: string, names: readonly string[], botId: string, choices: Choices): string {
  const slug = appAccountSlug(appId);
  const own = choices.bots[botId]?.[slug];
  if (own && names.includes(own)) return own;
  const usual = choices.defaults[slug];
  return usual && names.includes(usual) ? usual : names[0]!;
}

/** The servers a bot mounts: of an app with several accounts, only the one it uses. */
export function withChosenAppAccounts<T>(servers: Readonly<Record<string, T>>, botId: string, choices: Choices): Record<string, T> {
  const groups = appAccountGroups(servers);
  if (!groups.size) return { ...servers };
  const left = new Set<string>();
  for (const [appId, names] of groups) for (const name of names) if (name !== chosenAppAccount(appId, names, botId, choices)) left.add(name);
  return Object.fromEntries(Object.entries(servers).filter(([name]) => !left.has(name)));
}

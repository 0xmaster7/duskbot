import { directoryKey } from "../../../shared/connector-directory";
import type { AppEntry } from "./catalog";

/** Known pairs that share no slug, name or domain: our id, then the other sources' names for the same app. */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  x: ["twitter"],
};

/** Look-alikes that are different apps. */
export const DISTINCT: ReadonlyArray<readonly [string, string]> = [["gender_api", "genderapi_io"]];

/** Domains several apps share, so a match on them proves nothing. */
const SHARED_DOMAINS = new Set(["atlassian.com", "google.com", "microsoft.com", "zoho.com", "amazon.com", "github.io", "vercel.app"]);

// composio lists some apps twice: as itself and as its MCP flavour or its .io name
const VARIANT = /[_-](mcp|io|ai|us|tool)$/;

const slugKey = (id: string) => directoryKey(id.toLowerCase().replace(/^_+/, "").replace(VARIANT, ""));
const nameKey = (label: string) => directoryKey(label.replace(/\s+mcp$/i, ""));
const host = (website: string | undefined) => website?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^(www|mcp)\./, "");

/** What a row is matched on: its slug and name without the flavour suffixes, its known aliases, and its own domain. */
export function matchKeys(entry: AppEntry): string[] {
  const keys = [slugKey(entry.id), nameKey(entry.label), ...(ALIASES[entry.id] ?? []).map(nameKey)];
  const domain = host(entry.website);
  if (domain && !SHARED_DOMAINS.has(domain)) keys.push(`@${domain}`);
  return [...new Set(keys.filter(Boolean))];
}

const OWN: ReadonlySet<AppEntry["kind"]> = new Set(["native", "hosted", "logins"]);
const variant = (entry: AppEntry) => VARIANT.test(entry.id);

/** One row per app across our own cards, Composio's catalog and the vendors' own servers. `entries` come in the order
 * they list; a merged row sits where its first member did. Our own card keeps its id, name, logo and description, then a
 * vendor's server (our table), then Composio. The other ways in are kept on the row: `composio`, `remote`, `aliases`. */
export function mergeEntries(entries: readonly AppEntry[]): AppEntry[] {
  const parent = entries.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!;
    return index;
  };
  const distinct = (a: AppEntry, b: AppEntry) => DISTINCT.some(([x, y]) => (a.id === x && b.id === y) || (a.id === y && b.id === x));
  const owner = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.kind === "custom" || entry.id === "custom-mcp") return;
    for (const key of matchKeys(entry)) {
      const seen = owner.get(key);
      if (seen === undefined) { owner.set(key, index); continue; }
      if (distinct(entries[seen]!, entry)) continue;
      const [a, b] = [find(seen), find(index)];
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });

  const groups = new Map<number, AppEntry[]>();
  entries.forEach((entry, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });
  return [...groups.values()].map((members) => {
    if (members.length === 1) return members[0]!;
    const own = members.find((entry) => OWN.has(entry.kind));
    const composio = members.filter((entry) => entry.kind === "composio").sort((a, b) => Number(variant(a)) - Number(variant(b)));
    const remote = members.find((entry) => entry.kind === "remote");
    const row = own ?? composio[0] ?? remote!;
    const face = own ?? remote ?? row;
    const otherComposio = composio.filter((entry) => entry !== row).map((entry) => entry.id);
    return {
      ...row,
      label: face.label,
      description: face.description,
      categories: face.categories,
      icon: own ? own.icon : remote?.icon.image ? remote.icon : row.icon,
      website: face.website ?? members.find((entry) => entry.website)?.website,
      keywords: [...new Set(members.flatMap((entry) => [entry.keywords, entry.id, entry.label]).filter(Boolean))].join(" "),
      ...(row.kind !== "composio" && otherComposio[0] ? { composio: otherComposio[0] } : {}),
      ...(remote && row !== remote ? { remote: remote.id } : {}),
      ...((row.kind === "composio" ? otherComposio : otherComposio.slice(1)).length
        ? { aliases: row.kind === "composio" ? otherComposio : otherComposio.slice(1) } : {}),
    };
  });
}

/** Every id a merged row answers to, its own first: Composio's slugs and the vendor's id open its page too. */
export function idsOf(entry: AppEntry): string[] {
  return [entry.id, ...(entry.composio ? [entry.composio] : []), ...(entry.remote ? [entry.remote] : []), ...(entry.aliases ?? [])];
}

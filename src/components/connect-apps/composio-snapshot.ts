import type { ToolkitCard } from "../ServiceIcon";

/** One toolkit of Composio's bundled catalog (src/data/composio, written by scripts/composio-catalog-snapshot.mjs). */
export interface SnapshotToolkit {
  slug: string;
  name: string;
  description: string;
  category: string;
  /** Only where it is not logos.composio.dev/api/<slug>. */
  logo?: string;
  /** Composio's sign-in kinds: OAUTH2, API_KEY, BASIC, NO_AUTH... */
  auth?: string[];
  /** Composio holds its own sign-in app for it. */
  managed?: true;
  tools: number;
  triggers?: number;
}

export interface ComposioSnapshot { source: string; count: number; toolkits: SnapshotToolkit[] }
export interface ToolkitActions { actions: string[]; triggers?: string[] }

// keep in sync with scripts/composio-catalog-snapshot.mjs
const SHARDS = 16;
export function shardOf(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % SHARDS;
}

// globs, not imports, so the catalog stays its own lazy chunk and the type checker never reads the data
const CATALOG = import.meta.glob<ComposioSnapshot>("../../data/composio/toolkits.json", { import: "default" });
const ACTIONS = import.meta.glob<Record<string, ToolkitActions>>("../../data/composio/actions/*.json", { import: "default" });

let snapshot: ComposioSnapshot | null = null;
let request: Promise<ComposioSnapshot | null> | null = null;
let bySlug: Map<string, SnapshotToolkit> | null = null;

/** Reads the bundled catalog once; null when the build has none. */
export function loadComposioSnapshot(): Promise<ComposioSnapshot | null> {
  const load = Object.values(CATALOG)[0];
  request ??= load ? load().then((answer) => (snapshot = answer)).catch(() => null) : Promise.resolve(null);
  return request;
}

export const cachedComposioSnapshot = (): ComposioSnapshot | null => snapshot;

export function snapshotToolkit(slug: string): SnapshotToolkit | undefined {
  if (!snapshot) return undefined;
  bySlug ??= new Map(snapshot.toolkits.map((toolkit) => [toolkit.slug, toolkit]));
  return bySlug.get(slug);
}

const actionShards = new Map<number, Promise<Record<string, ToolkitActions>>>();

/** The first action and trigger names a toolkit lists, from the one small file that holds them. */
export function loadToolkitActions(slug: string): Promise<ToolkitActions | null> {
  const shard = shardOf(slug);
  const load = ACTIONS[`../../data/composio/actions/${shard}.json`];
  if (!load) return Promise.resolve(null);
  let pending = actionShards.get(shard);
  if (!pending) {
    pending = load().catch(() => ({}));
    actionShards.set(shard, pending);
  }
  return pending.then((all) => all[slug] ?? null);
}

export const composioLogo = (slug: string): string => `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;
export const composioPage = (slug: string): string => `https://docs.composio.dev/toolkits/${encodeURIComponent(slug)}`;

function cardOf(toolkit: SnapshotToolkit): ToolkitCard {
  return {
    slug: toolkit.slug,
    label: toolkit.name,
    blurb: toolkit.description,
    logo: toolkit.logo ?? composioLogo(toolkit.slug),
    domain: null,
    ...(toolkit.category ? { categories: [toolkit.category] } : {}),
  };
}

/** The live catalog first, in its own order, with what it leaves out filled in from the bundled one, then every bundled
 * toolkit it lacks. Without a live catalog (no broker, no key: the curated list) the bundled one leads. */
export function mergeCatalog(live: ToolkitCard[] | null, source: string | undefined, bundled: ComposioSnapshot | null): ToolkitCard[] | null {
  if (!bundled) return live;
  const known = new Map(bundled.toolkits.map((toolkit) => [toolkit.slug, toolkit]));
  if (source !== "api" || !live?.length) {
    const cards = bundled.toolkits.map(cardOf);
    const listed = new Set(cards.map((card) => card.slug));
    return [...cards, ...(live ?? []).filter((card) => !listed.has(card.slug))];
  }
  const cards = live.map((card): ToolkitCard => {
    const toolkit = known.get(card.slug);
    if (!toolkit) return card;
    return {
      ...card,
      // the live list cuts what an app does to 90 characters; the page shows all of it
      blurb: toolkit.description || card.blurb,
      logo: card.logo ?? toolkit.logo ?? composioLogo(card.slug),
      ...(card.categories?.length ? {} : toolkit.category ? { categories: [toolkit.category] } : {}),
    };
  });
  const listed = new Set(cards.map((card) => card.slug));
  return [...cards, ...bundled.toolkits.filter((toolkit) => !listed.has(toolkit.slug)).map(cardOf)];
}

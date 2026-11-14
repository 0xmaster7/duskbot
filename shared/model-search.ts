// One search over every provider's models: the connected ones as their engines list them, the rest from the catalog.

export interface SearchModel {
  id: string;
  name: string;
  /** Tokens. */
  context?: number;
  /** US dollars per million tokens. */
  input?: number;
  output?: number;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  /** YYYY-MM or YYYY-MM-DD. */
  released?: string;
}

export interface SearchGroup {
  providerId: string;
  label: string;
  connected: boolean;
  /** The instance a connected group's models run on. */
  instanceId?: string;
  words?: readonly string[];
  models: readonly SearchModel[];
}

export interface SearchHit {
  group: Omit<SearchGroup, "models">;
  models: SearchModel[];
  /** How many of the group's models matched, shown or not. */
  total: number;
}

export interface SearchOptions {
  perGroup?: number;
  maxGroups?: number;
}

const loose = (text: string) => text.toLowerCase().replace(/[-_./:()[\]]+/gu, " ").replace(/\s+/gu, " ").trim();

export function searchTokens(query: string): string[] {
  return loose(query).split(" ").filter(Boolean);
}

function modelScore(model: SearchModel, tokens: readonly string[], providerText: string, query: string): number {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  const own = `${loose(model.id)} ${loose(model.name)} ${id} ${name}`;
  let score = 0;
  for (const token of tokens) {
    if (own.includes(token)) score += 10;
    else if (providerText.includes(token)) score += 2;
    else return 0;
  }
  const whole = loose(query);
  const bare = loose(id.split("/").at(-1) ?? id);
  const full = loose(id);
  if (full === whole || bare === whole || loose(name) === whole) score += 100;
  else if (full.startsWith(whole) || bare.startsWith(whole) || loose(name).startsWith(whole)) score += 40;
  return score;
}

const newerFirst = (a: SearchModel, b: SearchModel) => (b.released ?? "").localeCompare(a.released ?? "");

/** Every group with a model matching all the words, best first; connected providers ahead of the rest. */
export function searchModels(groups: readonly SearchGroup[], query: string, options: SearchOptions = {}): SearchHit[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const perGroup = options.perGroup ?? 6;
  const hits: Array<SearchHit & { score: number }> = [];
  for (const { models, ...group } of groups) {
    const providerText = `${loose(group.label)} ${loose(group.providerId)} ${(group.words ?? []).map(loose).join(" ")}`;
    const scored = models.map((model) => ({ model, score: modelScore(model, tokens, providerText, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || newerFirst(a.model, b.model) || a.model.name.localeCompare(b.model.name));
    if (!scored.length) continue;
    hits.push({ group, models: scored.slice(0, perGroup).map((entry) => entry.model), total: scored.length,
      score: scored[0]!.score + (group.connected ? 30 : 0) });
  }
  hits.sort((a, b) => b.score - a.score || Number(b.group.connected) - Number(a.group.connected) || a.group.label.localeCompare(b.group.label));
  return hits.slice(0, options.maxGroups ?? 12).map(({ score: _score, ...hit }) => hit);
}

/** "200K", "1M", "32K". */
export function contextLabel(tokens: number | undefined): string | undefined {
  if (!tokens || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

const dollars = (value: number) => value >= 10 ? `$${Math.round(value)}` : `$${+value.toFixed(2)}`;

/** "Free", or input and output per million tokens: "$3 / $15". */
export function priceLabel(model: Pick<SearchModel, "input" | "output">): string | undefined {
  if (model.input === undefined || model.output === undefined) return undefined;
  if (model.input === 0 && model.output === 0) return "Free";
  return `${dollars(model.input)} / ${dollars(model.output)}`;
}

export type CapabilityBadge = "tools" | "vision" | "reasoning";

export function capabilityBadges(model: SearchModel): CapabilityBadge[] {
  return (["tools", "vision", "reasoning"] as const).filter((badge) => model[badge] === true);
}

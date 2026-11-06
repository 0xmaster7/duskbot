// The decision and language models Vercel AI Gateway lists at its public /v1/models, for the room's Jev picker.
import { OPENROUTER_MODEL_ID, OPENROUTER_MODEL_ID_MAX } from "./config.ts";
import { GATEWAY_DEFAULT_MODEL, gatewayEndpoint } from "./gateway.ts";

export interface GatewayModel {
  id: string;
  name: string;
  /** recommended: a decision model (`type: evaluation`); more: a language model that takes a JSON schema. */
  group: "recommended" | "more";
  api: "chat" | "decisions";
}

export interface GatewayModelList {
  source: "gateway" | "builtin";
  models: GatewayModel[];
}

const FETCH_TIMEOUT_MS = 3_000;
const OK_TTL_MS = 60 * 60_000;
const FAILED_TTL_MS = 60_000;
const MORE_MAX = 150;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const builtin = (): GatewayModelList => ({
  source: "builtin",
  models: [{ id: GATEWAY_DEFAULT_MODEL, name: "Jev", group: "recommended", api: "decisions" }],
});

const takesSchema = (entry: Record<string, unknown>) =>
  (Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes("response_format"))
  || (Array.isArray(entry.tags) && entry.tags.includes("structured-output"));

export function gatewayModels(body: unknown): GatewayModelList | null {
  if (!isRecord(body) || !Array.isArray(body.data)) return null;
  const decisions: GatewayModel[] = [];
  const language: GatewayModel[] = [];
  for (const entry of body.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    if (entry.id.length > OPENROUTER_MODEL_ID_MAX || !OPENROUTER_MODEL_ID.test(entry.id)) continue;
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.id;
    if (entry.type === "evaluation") decisions.push({ id: entry.id, name, group: "recommended", api: "decisions" });
    else if (entry.type === "language" && takesSchema(entry) && !entry.id.endsWith("-batch")) language.push({ id: entry.id, name, group: "more", api: "chat" });
  }
  if (!decisions.length && !language.length) return null;
  // jev first, the way the room uses it
  decisions.sort((a, b) => Number(b.id === GATEWAY_DEFAULT_MODEL) - Number(a.id === GATEWAY_DEFAULT_MODEL) || a.name.localeCompare(b.name));
  language.sort((a, b) => a.name.localeCompare(b.name));
  return { source: "gateway", models: [...decisions, ...language.slice(0, MORE_MAX)] };
}

/** Cached an hour after an answer, a minute after a failure. Never throws and never sends a key. */
export function createGatewayModelCatalog(deps: { fetch?: typeof fetch; now?: () => number } = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { until: number; list: GatewayModelList }>();
  return {
    async load(baseUrl?: string | null): Promise<GatewayModelList> {
      const endpoint = gatewayEndpoint(baseUrl, "v1/models");
      if (!endpoint) return builtin();
      const cached = cache.get(endpoint.href);
      if (cached && cached.until > now()) return cached.list;
      let list: GatewayModelList | null = null;
      try {
        const response = await fetchImpl(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
        if (response.ok) list = gatewayModels(await response.json());
        else await response.body?.cancel().catch(() => undefined);
      } catch {
        list = null;
      }
      const result = list ?? builtin();
      cache.set(endpoint.href, { until: now() + (list ? OK_TTL_MS : FAILED_TTL_MS), list: result });
      return result;
    },
  };
}

export type GatewayModelCatalog = ReturnType<typeof createGatewayModelCatalog>;

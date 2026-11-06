// Vercel AI Gateway: a decision model (Jev and the like) through its TypeSafe-compatible /typesafe/v1/systemone, or any
// language model through its OpenAI-compatible /v1/chat/completions with a strict JSON schema. The key goes only as a
// bearer to the gateway's own address; error bodies are never read into a message.
import { isLoopback } from "../provider-key-check.ts";
import { jevRequestBody, parseJevResponse, questionsFit, refusal } from "./jev.ts";
import { openrouterRequestBody, parseChatDecision } from "./openrouter.ts";
import type { BackendRequest, BackendResult, DeciderBackend, OpenRouterApi } from "./types.ts";

export const GATEWAY_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh";
export const GATEWAY_DEFAULT_MODEL = "typesafe-ai/jev";
export const GATEWAY_DEFAULT_API: OpenRouterApi = "decisions";

/** Null when the key must not be sent there: https anywhere, plain http only to this machine. */
export function gatewayEndpoint(baseUrl: string | null | undefined, path: string): URL | null {
  const root = (baseUrl?.trim() || GATEWAY_DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${root}/${path}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  return url.protocol === "http:" && isLoopback(url.hostname) ? url : null;
}

export function gatewayChatBody(state: unknown, questions: BackendRequest["questions"], model: string) {
  // `provider` is OpenRouter's routing field; the gateway has its own providerOptions and needs neither
  const { provider: _provider, ...body } = openrouterRequestBody(state, questions, model);
  return body;
}

async function decide(request: BackendRequest): Promise<BackendResult> {
  const model = request.model?.trim() || GATEWAY_DEFAULT_MODEL;
  const decisions = (request.api ?? (request.model?.trim() ? "chat" : GATEWAY_DEFAULT_API)) === "decisions";
  const endpoint = gatewayEndpoint(request.baseUrl, decisions ? "typesafe/v1/systemone" : "v1/chat/completions");
  if (!endpoint || !questionsFit(request.questions)) return { ok: false, reason: "misconfigured" };
  let response: Response;
  try {
    response = await request.fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${request.key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(decisions
        ? { ...jevRequestBody(request.state, request.questions), model }
        : gatewayChatBody(request.state, request.questions, model)),
      signal: request.signal,
      // Never replay the key to wherever a redirect points.
      redirect: "error",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return refusal(response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!decisions) return parseChatDecision(body, request.questions);
  const parsed = parseJevResponse(body, request.questions);
  return parsed.ok ? parsed : { ok: false, reason: "malformed" };
}

export const gatewayBackend: DeciderBackend = { id: "gateway", decide };

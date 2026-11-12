import { DAY_MS, json, utcDay } from "./common";

/** Tool calls one installation may run per UTC day. */
export const INSTALLATION_DAILY_TOOL_CALLS = 10_000;
/** Tool calls one Composio user (every installation sharing it) may run per UTC day. */
export const ACCOUNT_DAILY_TOOL_CALLS = 50_000;
/** New installations one client address may register per UTC day. */
export const REGISTRATIONS_PER_IP_DAY = 60;
const KEEP_DAYS = 7;

type Scope = "tool_calls_installation" | "tool_calls_account" | "tool_calls_global" | "registrations_ip";
interface Counter { scope: Scope; key: string; limit: number }

/**
 * Adds `amount` to every counter for today, or to none: a counter that would pass its limit is left as it was and the
 * ones already raised are put back. Each step is one atomic statement, so concurrent requests never lose a count.
 */
async function take(env: Env, counters: Counter[], amount: number, now: number): Promise<Counter | null> {
  const over = counters.find((counter) => amount > counter.limit);
  if (over) return over;
  try {
    return await raise(env, counters, amount, utcDay(now));
  } catch (error) {
    // known risk: until migration 0006 is applied the budgets are off, like every other table a deploy runs ahead of
    if (!/no such table: usage_counters/.test(error instanceof Error ? error.message : String(error))) throw error;
    console.error(JSON.stringify({ message: "usage budgets are off: apply migration 0006" }));
    return null;
  }
}

async function raise(env: Env, counters: Counter[], amount: number, day: string): Promise<Counter | null> {
  const results = await env.DB.batch(counters.map((counter) => env.DB.prepare(
    `INSERT INTO usage_counters (scope, key, day, count) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(scope, key, day) DO UPDATE SET count = count + excluded.count WHERE count + excluded.count <= ?5
     RETURNING count`,
  ).bind(counter.scope, counter.key, day, amount, counter.limit)));
  const refused = counters.find((_, index) => !results[index]?.results?.length);
  if (!refused) return null;
  const raised = counters.filter((_, index) => results[index]?.results?.length);
  if (raised.length) {
    await env.DB.batch(raised.map((counter) => env.DB.prepare(
      "UPDATE usage_counters SET count = count - ?4 WHERE scope = ?1 AND key = ?2 AND day = ?3",
    ).bind(counter.scope, counter.key, day, amount)));
  }
  return refused;
}

/** How many JSON-RPC `tools/call` requests an MCP body holds: one message or a batch. */
export function toolCallCount(body: ArrayBuffer | Uint8Array) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return 0;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages.filter((message) => (message as { method?: unknown } | null)?.method === "tools/call").length;
}

function globalLimit(env: Env) {
  const value = Number(env.GLOBAL_DAILY_TOOL_CALLS);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** null when the calls may run, else the 429 to answer. */
export async function spendToolCalls(env: Env, installationId: string, account: string, calls: number, now = Date.now()) {
  if (calls <= 0) return null;
  const global = globalLimit(env);
  const counters: Counter[] = [
    { scope: "tool_calls_installation", key: installationId, limit: INSTALLATION_DAILY_TOOL_CALLS },
    { scope: "tool_calls_account", key: account, limit: ACCOUNT_DAILY_TOOL_CALLS },
    ...(global ? [{ scope: "tool_calls_global" as const, key: "", limit: global }] : []),
  ];
  const refused = await take(env, counters, calls, now);
  if (!refused) return null;
  const error = refused.scope === "tool_calls_installation"
    ? `This computer reached today's limit of ${refused.limit.toLocaleString("en-US")} connected-app actions. It resets at midnight UTC.`
    : refused.scope === "tool_calls_account"
      ? `This account reached today's limit of ${refused.limit.toLocaleString("en-US")} connected-app actions. It resets at midnight UTC.`
      : "Connected apps are busy today. Try again later.";
  console.log(JSON.stringify({ message: "tool-call budget refused", scope: refused.scope, installationId }));
  return json({ error, code: "daily_tool_budget", scope: refused.scope.replace("tool_calls_", ""), limit: refused.limit }, 429);
}

/**
 * The address a registration is counted under: Cloudflare always sets cf-connecting-ip in production. An IPv6 address
 * counts by its /64, which one subscriber usually holds whole. Without the header (local tests) every caller shares one key.
 */
export function registrationKey(request: Request) {
  const ip = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip.slice(0, 64);
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** null when this address may register another installation today, else the 429 to answer. */
export async function spendRegistration(env: Env, key: string, now = Date.now()) {
  const refused = await take(env, [{ scope: "registrations_ip", key, limit: REGISTRATIONS_PER_IP_DAY }], 1, now);
  return refused ? json({ error: "Too many new installations from this network today. Try again tomorrow.", code: "registration_daily_limit" }, 429) : null;
}

export async function pruneUsage(env: Env, now = Date.now()) {
  await env.DB.prepare("DELETE FROM usage_counters WHERE day < ?").bind(utcDay(now - KEEP_DAYS * DAY_MS)).run().catch((error: Error) => {
    if (!/no such table: usage_counters/.test(error.message)) throw error;
  });
}

import type { TraceList, TraceRootSummary } from "../../../shared/usage-trace";
import type { MausColor } from "../../../shared/wire";
import type { BotBodyId } from "../../../shared/bot-body";
import type { AiAccount, Bot, DashboardData, Turn, TurnSource } from "./types";
import { dayKey } from "../lib/format";

// the harness server's own answers (server/routes/usage.ts, threads.ts, status.ts); only the fields read here
interface LiveBot { id: string; name: string; color: MausColor; mascotBody?: BotBodyId | null }
interface LiveUsage { budget: { monthlyUsd: number; warnAtPercent: number } | null }
interface LivePlanWindow { usedPercent: number | null; resetsAt: string | null; available: boolean }
interface LivePlans { providers: Array<{ id: string; name: string; plan: string | null; ok: boolean; fiveHour: LivePlanWindow; weekly: LivePlanWindow }> }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

const SOURCE: Record<TraceRootSummary["source"], TurnSource> = { person: "chat", owner: "chat", routine: "routine", bot: "room", helper: "webhook" };

function turnOf(root: TraceRootSummary): Turn | null {
  if (root.running) return null;
  const bot = root.bots[0];
  if (!bot) return null;
  const failed = root.errors > 0 && root.output === 0;
  return {
    id: root.id, at: root.startedAt, botId: bot.id, threadId: root.id.split(":")[0] ?? root.id, title: root.title || "Untitled turn",
    source: SOURCE[root.source], model: "", input: root.input, output: root.output, cached: root.cachedInput, tools: root.tools,
    computerMinutes: 0, voiceChars: 0, durationMs: root.durationMs, status: failed ? "failed" : "ok",
    // a self-hosted server pays its engines with the person's own accounts: never a bill from us
    lines: [{ category: "ai", coverage: "own", usd: failed ? 0 : root.costUsd ?? 0, estimated: root.costUsd === null || root.usageStatus !== "complete" }],
  };
}

async function liveTurns(now: number): Promise<Turn[]> {
  const from = dayKey(now - 364 * 86_400_000);
  const to = dayKey(now);
  const turns: Turn[] = [];
  let offset: number | undefined = 0;
  for (let page = 0; page < 40 && offset !== undefined; page++) {
    const list: TraceList = await get<TraceList>(`/api/usage/traces?from=${from}&to=${to}&limit=100&offset=${offset}`);
    for (const root of list.roots) { const turn = turnOf(root); if (turn) turns.push(turn); }
    offset = list.next;
  }
  return turns.sort((a, b) => b.at - a.at);
}

/** Lays whatever the local server can answer over the sample; each part that answers is marked live. */
export async function overlayLive(base: DashboardData): Promise<DashboardData> {
  const data: DashboardData = { ...base, origin: { ...base.origin } };
  const [bots, turns, usage, plans] = await Promise.allSettled([
    get<{ bots: LiveBot[] }>("/api/bots?messages=0"),
    liveTurns(base.now),
    get<LiveUsage>(`/api/usage?from=${dayKey(base.billing.periodStart)}&to=${dayKey(base.now)}&groupBy=bot`),
    get<LivePlans>("/api/plan-usage"),
  ]);
  if (bots.status === "fulfilled" && bots.value.bots.length) {
    data.bots = bots.value.bots.map((live, i): Bot => {
      const sample = base.bots[i % base.bots.length]!;
      return { ...sample, id: live.id, name: live.name, color: live.color, body: live.mascotBody ?? "blob", role: "", engine: "Your engine", model: "", engineCoverage: "own", capUsd: null, routines: [], computerId: null };
    });
    data.origin.bots = "live";
  }
  if (turns.status === "fulfilled" && data.origin.bots === "live") {
    data.turns = turns.value;
    const last = new Map<string, number>();
    for (const t of data.turns) if (!last.has(t.botId)) last.set(t.botId, t.at);
    data.bots = data.bots.map((b) => ({ ...b, lastActiveAt: last.get(b.id) ?? b.lastActiveAt }));
    data.origin.usage = "live";
  }
  if (usage.status === "fulfilled" && usage.value.budget) {
    data.billing = { ...data.billing, caps: { ...data.billing.caps, ai: { ...data.billing.caps.ai, limitUsd: usage.value.budget.monthlyUsd } } };
  }
  if (plans.status === "fulfilled" && plans.value.providers.length) {
    const win = (label: string, w: LivePlanWindow) => (w.available && w.usedPercent !== null ? [{ label, usedPercent: w.usedPercent, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null }] : []);
    data.account = {
      ...data.account,
      aiAccounts: plans.value.providers.map((p): AiAccount => ({ id: p.id, name: p.name, plan: p.plan ?? "Connected", ok: p.ok, windows: [...win("5-hour", p.fiveHour), ...win("Weekly", p.weekly)] })),
    };
  }
  return data;
}

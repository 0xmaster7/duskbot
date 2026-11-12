import { describe, expect, it } from "vitest";
import type { UsageTurn } from "../../../../shared/usage-signals.ts";
import { createUsage, memoryUsageStore } from "./usage.ts";
import { moreFocus, moreOf, type MoreInput } from "./usage-more.ts";
import { dayOf } from "./events.ts";
import type { StoredEvent } from "./sink.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z"), DAY = 86_400_000;
let n = 0;
const turn = (patch: Partial<UsageTurn> = {}): UsageTurn => ({ id: `turn${String(++n).padStart(6, "0")}`, at: NOW - 3_600_000, engine: "claude", outcome: "ok", ms: 8000, tools: [], apps: [],
  category: "chat", from: "app", place: "desktop", room: false, ...patch });
const event = (name: string, props: StoredEvent["props"], accountId: string | null = "acct_a", at = NOW - 3_600_000): StoredEvent => ({ id: `ev${++n}`, name, at, accountId, props });

async function setup() {
  const store = memoryUsageStore(() => NOW);
  const usage = createUsage({ store, now: () => NOW, optedOut: () => false, summariesOff: () => false });
  await usage.ingest("acct_a", "ws_1", { turns: [
    ...Array.from({ length: 30 }, (_, i) => turn({ apps: ["gmail"], tools: ["app"], model: "claude-sonnet-4-5", firstMs: 25_000, ms: 40_000, actions: ["gmail_send_email"], bot: "botAAAAAAA", chat: i < 20 ? "chatAAAAAA" : "chatBBBBBB",
      ...(i < 6 ? { failedApps: ["gmail"], failedTools: ["app"] as UsageTurn["tools"] } : {}) })),
  ], runs: [{ id: "run0000001", at: NOW - 1000, trigger: "schedule", outcome: "ok", ms: 30_000, every: "daily", routine: "rtnAAAAAAA" }],
  signals: [{ id: "sig0000001", at: NOW - 1000, name: "attachment", props: { kind: "pdf", size: "lt1m" } }, { id: "sig0000002", at: NOW - 1000, name: "setting_changed", props: { key: "theme" } }],
  snapshot: { bots: 3, rooms: 0, routines: 1, webhooks: 0, appEvents: 0, skills: 1, chats: 8, archived: 2, memory: 2, botEngines: { claude: 2, codex: 1 } } });
  await store.routine({ workspaceId: "ws_old", accountId: "acct_b", routine: "rtnOLDAAAA", first: NOW - 20 * DAY, last: NOW - 19 * DAY });
  return store;
}

describe("the deeper usage answer", () => {
  it("rolls the richer records into reliability, engagement, bots, apps and routines", async () => {
    const store = await setup(), days = [dayOf(NOW)];
    const daily = new Map((await store.daily(days[0]!, days[0]!)).map(row => [row.day, row.c]));
    const input: MoreInput = { days, daily, people: await store.people(days[0]!, days[0]!), snapshots: await store.snapshots(), routines: await store.routines(), from: NOW - DAY, to: NOW + DAY, now: NOW,
      accounts: [{ id: "acct_a", createdAt: NOW - 10 * DAY }], wake: { count: 12, p50Ms: 6000, p90Ms: 20_000 },
      events: [
        event("app_open", { kind: "desktop", platform: "darwin", appVersion: "0.2.15" }), event("app_close", { ms: 600_000 }),
        event("app_action", { name: "env", os: "darwin", arch: "arm64", locale: "en", screen: "m", theme: "dark", skin: "grok_dark", notifications: "granted", hour: 9 }),
        event("app_feature", { feature: "routine_created" }, "acct_a", NOW - 7 * DAY),
        ...["connected", "failed", "failed", "timed_out", "failed"].map(result => event("app_action", { name: "connector_connect", app: "notion", result })),
        event("engine_sign_in", { engine: "codex", outcome: "started" }), event("engine_sign_in", { engine: "codex", outcome: "failed", reason: "auth" }),
        ...Array.from({ length: 4 }, () => event("engine_sign_in", { engine: "codex", outcome: "started" })),
      ],
      billing: { checkouts: Array.from({ length: 6 }, (_, i) => ({ accountId: "acct_a", status: i < 1 ? "completed" : "expired", createdAt: NOW - 1000 })),
        subscriptions: [{ accountId: "acct_a", totalCents: 900, createdAt: NOW - 40 * DAY, status: "ended" }, { accountId: "acct_a", totalCents: 2900, createdAt: NOW - 1000, status: "active" }],
        feedback: [{ answer: "price", at: NOW - 1000 }] } };
    const m = moreOf(input);
    expect(m.reliability.models[0]).toMatchObject({ key: "claude-sonnet-4-5", turns: 30, firstP50: 30_000 });
    expect(m.reliability.toolErrors.find(row => row.kind === "app" && row.key === "gmail")).toMatchObject({ errors: 6, turns: 30, rate: 0.2 });
    expect(m.reliability.wake).toMatchObject({ count: 12, p50Ms: 6000 });
    expect(m.engagement).toMatchObject({ turnsPerChat: 10, attachments: [{ key: "pdf", count: 1 }], settings: [{ key: "theme", count: 1 }], archivedShare: 0.2, sessionMedianMs: 600_000 });
    expect(m.engagement.hours[9]).toBe(1);
    expect(m.bots).toMatchObject({ perPerson: 3, topBotShare: 1, engines: [{ key: "claude", count: 2 }, { key: "codex", count: 1 }] });
    expect(m.apps.actions).toEqual([{ key: "gmail_send_email", count: 30 }]);
    expect(m.apps.connects[0]).toMatchObject({ key: "notion", total: 5, good: 1, rate: 0.2 });
    expect(m.routines).toMatchObject({ every: [{ key: "daily", total: 1, good: 1 }], survival: { eligible: 1, survived: 0, share: 0 } });
    expect(m.money).toMatchObject({ checkouts: { started: 6, paid: 1, abandoned: 5 }, cancelReasons: [{ key: "price", count: 1 }], upgrades: 1, downgrades: 0 });
    expect(m.setup.signIn[0]).toMatchObject({ key: "codex", total: 5, bad: 1, reason: "auth" });
    expect(m.discovery[0]).toMatchObject({ feature: "routine_created", people: 1, medianDays: 3 });
    expect(m.setups.locale).toEqual([{ key: "en", count: 1 }]);
    expect(m.setups.version).toEqual([{ key: "0.2.15", count: 1 }]);

    const focus = moreFocus(m).map(item => item.text);
    expect(focus).toContain("only 0% of codex sign-ins finish (mostly sign-in expired or was refused): people can't even start there.");
    expect(focus).toContain("83% of checkouts are left unpaid (5 of 6): look at the checkout step.");
    expect(focus).toContain("connecting notion works 20% of the time: fix the connect flow.");
    expect(focus).toContain("the first reply takes 30 s for half of turns: people wait before seeing anything.");
    expect(focus).toContain("connected app calls error in 20% of the turns that use it.");
  });
});

import type { Account, Allowance, Billing, Bot, BotComputer, Category, Coverage, DashboardData, Machine, Turn, TurnSource } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const monthStart = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const nextMonth = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };

const TITLES: Record<string, string[]> = {
  nova: ["Compare three standing desks under $600", "Summarize this week in AI policy", "Find sources on heat pumps in cold climates", "Read the new battery paper and explain it", "Track flight prices to Lisbon"],
  quill: ["Draft the newsletter intro", "Tighten the launch post", "Rewrite the About page in plain words", "Edit chapter four for pacing", "Reply to Sam about the guest post"],
  rivet: ["Fix the failing CSV import test", "Bump dependencies and run the suite", "Add dark mode to the settings page", "Profile the slow search query", "Review the open pull request"],
  tally: ["Reconcile October card statements", "Categorize new receipts", "Flag subscriptions I forgot about", "Build the monthly budget sheet", "Check the electricity bill against last year"],
  echo: ["Call the clinic to move my appointment", "Leave a voicemail for the landlord", "Read me today's briefing", "Book a table for four on Friday", "Confirm the plumber for Tuesday"],
  juno: ["Plan next week around the two deadlines", "Find a time for the team offsite", "Morning brief: calendar and inbox", "Move the dentist to after work", "Sort the inbox and draft replies"],
};

export const SAMPLE_BOTS: Omit<Bot, "lastActiveAt">[] = [
  { id: "nova", name: "Nova", role: "Research", color: "purple", body: "sparkle", engine: "Claude", model: "Sonnet 4.5", engineCoverage: "own", computerId: "pc-studio", capUsd: null,
    routines: [], connectors: [{ name: "Google Drive", access: "Read only" }, { name: "Web research", access: "Search and read" }] },
  { id: "quill", name: "Quill", role: "Writing", color: "coral", body: "flower", engine: "Cloud AI", model: "Kimi K2", engineCoverage: "paid", computerId: null, capUsd: 8,
    routines: [], connectors: [{ name: "Gmail", access: "Read and draft" }, { name: "Notion", access: "Read and write" }] },
  { id: "rivet", name: "Rivet", role: "Code", color: "blue", body: "squircle", engine: "ChatGPT", model: "GPT-5 Codex", engineCoverage: "own", computerId: "pc-studio", capUsd: null,
    routines: [], connectors: [{ name: "GitHub", access: "Read and write" }] },
  { id: "tally", name: "Tally", role: "Money", color: "green", body: "clover", engine: "Cloud AI", model: "DeepSeek V3.2", engineCoverage: "paid", computerId: "pc-ledger", capUsd: 12,
    routines: [], connectors: [{ name: "Gmail", access: "Read only" }, { name: "Google Sheets", access: "Read and write" }] },
  { id: "echo", name: "Echo", role: "Calls", color: "orange", body: "heart", engine: "Cloud AI", model: "Grok 4 Fast", engineCoverage: "paid", computerId: null, capUsd: 6,
    routines: [], connectors: [{ name: "Phone", access: "Calls you approve" }, { name: "Calendar", access: "Read only" }] },
  { id: "juno", name: "Juno", role: "Planner", color: "teal", body: "cloud", engine: "Claude", model: "Haiku 4.5", engineCoverage: "trial", computerId: "pc-ledger", capUsd: null,
    routines: [], connectors: [{ name: "Calendar", access: "Read and write" }, { name: "Gmail", access: "Read and draft" }] },
];

const WEIGHT: Record<string, number> = { nova: 1.25, quill: 0.7, rivet: 1.1, tally: 0.75, echo: 0.35, juno: 0.95 };
// per-turn dollars of AI at engine rates; own subscriptions show this as value, never as a charge
const AI_RATE: Record<string, number> = { nova: 0.11, quill: 0.11, rivet: 0.16, tally: 0.15, echo: 0.09, juno: 0.03 };

function routinesFor(now: number): Bot["routines"] {
  const at = (days: number, hour: number, minute = 0) => { const d = new Date(startOfDay(now) + days * DAY); d.setHours(hour, minute); return d.getTime(); };
  return [
    { id: "r-brief", botId: "juno", name: "Morning brief", schedule: "Every day at 7:00", state: "on", lastRunAt: at(0, 7), nextRunAt: at(1, 7), costPerRunUsd: 0.04 },
    { id: "r-receipts", botId: "tally", name: "Categorize receipts", schedule: "Weekdays at 7:30", state: "on", lastRunAt: at(0, 7, 30), nextRunAt: at(1, 7, 30), costPerRunUsd: 0.21 },
    { id: "r-deps", botId: "rivet", name: "Dependency check", schedule: "Mondays at 9:00", state: "on", lastRunAt: at(-4, 9), nextRunAt: at(3, 9), costPerRunUsd: 0.38 },
    { id: "r-digest", botId: "nova", name: "AI policy digest", schedule: "Fridays at 16:00", state: "paused", lastRunAt: at(-9, 16), nextRunAt: null, costPerRunUsd: 0.52 },
    { id: "r-voicemail", botId: "echo", name: "Voicemail sweep", schedule: "Every 2 hours", state: "error", lastRunAt: at(0, 10), nextRunAt: at(0, 14), costPerRunUsd: 0.06 },
  ];
}

function makeTurns(now: number, rand: () => number): Turn[] {
  const turns: Turn[] = [];
  const today = startOfDay(now);
  const firstDay = today - 364 * DAY;
  const joined = today - 318 * DAY;
  let n = 0;
  for (let day = firstDay; day <= today; day += DAY) {
    if (day < joined) continue;
    const age = (day - joined) / (today - joined);
    const weekday = new Date(day).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const vacation = day > today - 120 * DAY && day < today - 109 * DAY;
    if (vacation && rand() < 0.85) continue;
    const quiet = rand() < (weekend ? 0.22 : 0.05);
    if (quiet) continue;
    const base = (4 + 22 * Math.pow(age, 1.4)) * (weekend ? 0.45 : 1) * (0.55 + rand() * 0.9);
    for (const bot of SAMPLE_BOTS) {
      if (bot.id === "echo" && age < 0.45) continue;
      if (bot.id === "tally" && age < 0.25) continue;
      const count = Math.round(base * WEIGHT[bot.id]! * (0.5 + rand()) / 3.2);
      for (let i = 0; i < count; i++) {
        const isToday = day === today;
        const hour = 7 + Math.floor(rand() * 15);
        const at = day + hour * HOUR + Math.floor(rand() * 59) * 60_000;
        if (isToday && at > now) continue;
        turns.push(makeTurn(bot, at, n++, rand, i === 0 && hour < 9 ? "routine" : undefined));
      }
    }
  }
  return turns.sort((a, b) => b.at - a.at);
}

function makeTurn(bot: Omit<Bot, "lastActiveAt">, at: number, n: number, rand: () => number, forced?: TurnSource): Turn {
  const roll = rand();
  const source: TurnSource = forced ?? (roll < 0.72 ? "chat" : roll < 0.88 ? "routine" : roll < 0.96 ? "room" : "webhook");
  const statusRoll = rand();
  const status = statusRoll < 0.025 ? "failed" : statusRoll < 0.035 ? "cancelled" : "ok";
  const scale = 0.4 + rand() * 1.6;
  const input = Math.round(6_000 + rand() * 38_000 * scale);
  const output = Math.round(300 + rand() * 2_800 * scale);
  const cached = Math.round(input * (0.3 + rand() * 0.6));
  const usesComputer = bot.computerId !== null && rand() < 0.42;
  const computerMinutes = usesComputer ? Math.round((1 + rand() * 14) * 10) / 10 : 0;
  const voiceChars = bot.id === "echo" ? Math.round(400 + rand() * 2_400) : 0;
  const lines: Turn["lines"] = [];
  const ok = status === "ok";
  const ai = Math.round(AI_RATE[bot.id]! * scale * 1000) / 1000;
  lines.push({ category: "ai", coverage: bot.engineCoverage as Coverage, usd: ok ? ai : 0, ...(bot.engineCoverage === "own" ? { estimated: true } : {}) });
  if (computerMinutes) lines.push({ category: "computer", coverage: "included", usd: ok ? Math.round(computerMinutes * 0.0015 * 1000) / 1000 : 0 });
  if (voiceChars) lines.push({ category: "voice", coverage: "included", usd: ok ? Math.round(voiceChars * 0.00003 * 1000) / 1000 : 0 });
  if (bot.id === "nova" && rand() < 0.3) lines.push({ category: "research", coverage: "included", usd: ok ? Math.round((0.02 + rand() * 0.12) * 1000) / 1000 : 0 });
  const titles = TITLES[bot.id]!;
  return {
    id: `t_${n.toString(36)}`,
    at,
    botId: bot.id,
    threadId: `th_${bot.id}_${Math.floor(n / 4).toString(36)}`,
    title: titles[Math.floor(rand() * titles.length)]!,
    source,
    model: bot.model,
    input, output, cached,
    tools: Math.round(rand() * 9 * scale),
    computerMinutes, voiceChars,
    durationMs: Math.round(4_000 + rand() * 90_000 * scale),
    status,
    lines,
  };
}

function machine(now: number, rand: () => number): Machine {
  const samples = [];
  for (let i = 30 * 24; i >= 0; i--) {
    const t = now - i * HOUR;
    const hour = new Date(t).getHours();
    const busy = hour >= 8 && hour <= 22 ? 1 : 0.35;
    samples.push({
      t,
      cpu: Math.min(96, Math.round((6 + rand() * 18 * busy + (rand() < 0.04 ? 40 : 0)) * 10) / 10),
      mem: Math.round((34 + busy * 8 + rand() * 6) * 10) / 10,
      disk: Math.round((58 + (30 * 24 - i) / (30 * 24) * 4) * 10) / 10,
      netMbps: Math.round((0.4 + rand() * 6 * busy) * 10) / 10,
    });
  }
  return {
    name: "maya-cloud", status: "running", region: "Frankfurt", size: { vcpu: 4, ramGb: 8, diskGb: 80 },
    host: "maya.cloud.openmausbot.com", startedAt: now - 6 * DAY - 4 * HOUR, version: "0.84.2",
    nextUpdateAt: startOfDay(now) + 3 * DAY + 4 * HOUR, updateWindow: "Sundays, 4:00 to 5:00",
    samples,
    snapshots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: `snap-${d}`, at: startOfDay(now) - d * DAY + 3 * HOUR, sizeGb: Math.round((11.2 - d * 0.14) * 10) / 10, kind: d === 3 ? "manual" as const : "automatic" as const })),
  };
}

function computers(now: number): BotComputer[] {
  return [
    { id: "pc-studio", name: "Studio", state: "running", botIds: ["nova", "rivet"], hoursThisMonth: 71.6, lastWokeAt: now - 38 * 60_000, idleSleepMinutes: 10, memPct: 58, diskFreeGb: 14.2,
      sessions: [
        { start: now - 38 * 60_000, end: null, wokeBy: "Rivet: Fix the failing CSV import test" },
        { start: now - 5 * HOUR, end: now - 3.6 * HOUR, wokeBy: "Nova: Compare three standing desks under $600" },
        { start: now - 21 * HOUR, end: now - 19.2 * HOUR, wokeBy: "Rivet: Dependency check (routine)" },
        { start: now - 26 * HOUR, end: now - 25.1 * HOUR, wokeBy: "Nova: Track flight prices to Lisbon" },
      ] },
    { id: "pc-ledger", name: "Ledger", state: "asleep", botIds: ["tally", "juno"], hoursThisMonth: 40.8, lastWokeAt: now - 3 * HOUR, idleSleepMinutes: 10, memPct: 0, diskFreeGb: 21.7,
      pressure: { kind: "restart", text: "Ledger restarted at 3:12 AM, most likely because it ran out of memory. Tally's spreadsheet export was retried and finished." },
      sessions: [
        { start: now - 3.9 * HOUR, end: now - 3 * HOUR, wokeBy: "Tally: Categorize receipts (routine)" },
        { start: now - 7 * HOUR, end: now - 6.7 * HOUR, wokeBy: "Juno: Morning brief (routine)" },
        { start: now - 27 * HOUR, end: now - 26.2 * HOUR, wokeBy: "Tally: Reconcile October card statements" },
      ] },
  ];
}

function allowances(computerHours: number): Allowance[] {
  return [
    { kind: "computerHours", label: "Computer hours", used: computerHours, max: 300, unit: "h", overUsd: "$0.09 an hour after that" },
    { kind: "voice", label: "Voice", used: 21_400, max: 60_000, unit: "chars", overUsd: "$0.03 per 1,000 characters after that" },
    { kind: "decisions", label: "Decisions", used: 6_120, max: 20_000, unit: "count", overUsd: "$0.20 per 1,000 after that" },
    { kind: "x", label: "X calls", used: 3_310, max: 20_000, unit: "calls", overUsd: "$0.10 per 1,000 after that" },
    { kind: "research", label: "Research", used: 6.4, max: 15, unit: "usd", overUsd: "Billed at cost after that" },
    { kind: "storage", label: "Storage", used: 38.6, max: 100, unit: "gb", overUsd: "$0.05 per GB a month after that" },
  ];
}

function billing(now: number): Billing {
  const period = monthStart(now);
  const invoices: Billing["invoices"] = [];
  for (let m = 0; m < 8; m++) {
    const d = new Date(period); d.setMonth(d.getMonth() - m);
    const at = d.getTime();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    invoices.push({ id: `inv-${stamp}`, at, number: `OMB-${stamp}-0${41 + m}`, kind: "subscription", amountUsd: m > 5 ? 15 : 49, status: "paid" });
    if (m % 2 === 1) invoices.push({ id: `top-${stamp}`, at: at + 12 * DAY, number: `OMB-${stamp}-T${m}`, kind: "top-up", amountUsd: 25, status: m === 3 ? "refunded" : "paid" });
  }
  invoices[0]!.status = "open";
  return {
    plan: { tier: "pro", label: "Pro", priceUsd: 49, renewsAt: nextMonth(now), includes: ["My Cloud machine, 4 vCPU and 8 GB", "300 bot computer hours", "60,000 voice characters", "20,000 decisions and X calls", "$15 of research", "100 GB storage"] },
    periodStart: period,
    periodEnd: nextMonth(now),
    balanceUsd: 32.6,
    autoTopUp: { enabled: false, belowUsd: 5, amountUsd: 25 },
    caps: { ai: { limitUsd: 50, alerts: [50, 75, 90, 100] }, cloud: { limitUsd: 20, alerts: [75, 90, 100] } },
    grants: [{ id: "g1", label: "Claude trial credit", remainingUsd: 3.85, expiresAt: startOfDay(now) + 6 * DAY }],
    methods: [
      { id: "pm1", brand: "visa", last4: "4242", expires: "08/28", isDefault: true },
      { id: "pm2", brand: "link", last4: "maya", expires: "", isDefault: false },
    ],
    details: { name: "Maya Shah", line1: "Torstrasse 104", city: "10119 Berlin", country: "Germany", taxId: "", email: "maya@shah.studio" },
    invoices,
  };
}

function account(now: number): Account {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    name: "Maya Shah", initials: "MS", email: "maya@shah.studio", handle: "maya", timezone: tz, language: "English", weekStart: "monday",
    passkeys: [{ id: "pk1", name: "MacBook Pro Touch ID", addedAt: now - 140 * DAY }, { id: "pk2", name: "iPhone", addedAt: now - 90 * DAY }],
    twoFactor: true,
    sessions: [
      { id: "s1", device: "Chrome on macOS", kind: "browser", place: "Berlin, Germany", lastActiveAt: now, current: true },
      { id: "s2", device: "OpenMausBot for Mac", kind: "desktop", place: "Berlin, Germany", lastActiveAt: now - 12 * 60_000 },
      { id: "s3", device: "OpenMausBot for iPhone", kind: "phone", place: "Berlin, Germany", lastActiveAt: now - 3 * HOUR },
      { id: "s4", device: "Safari on iPad", kind: "browser", place: "Lisbon, Portugal", lastActiveAt: now - 19 * DAY },
    ],
    paired: [
      { id: "p1", name: "Maya's MacBook Pro", kind: "Desktop app", lastSeenAt: now - 12 * 60_000 },
      { id: "p2", name: "Home server", kind: "Your own server", lastSeenAt: now - 2 * DAY },
    ],
    tokens: [
      { id: "tk1", name: "Shortcuts on iPhone", scope: "Send messages", createdAt: now - 60 * DAY, lastUsedAt: now - 5 * HOUR, prefix: "omb_live_7Qx" },
      { id: "tk2", name: "Home Assistant", scope: "Read usage", createdAt: now - 120 * DAY, lastUsedAt: null, prefix: "omb_live_2Lm" },
    ],
    apps: [
      { id: "a1", name: "Gmail", access: "Read and draft", bots: ["quill", "tally", "juno"], lastUsedAt: now - 40 * 60_000 },
      { id: "a2", name: "Google Calendar", access: "Read and write", bots: ["juno", "echo"], lastUsedAt: now - 3 * HOUR },
      { id: "a3", name: "GitHub", access: "Read and write", bots: ["rivet"], lastUsedAt: now - 38 * 60_000 },
      { id: "a4", name: "Notion", access: "Read and write", bots: ["quill"], lastUsedAt: now - 2 * DAY },
      { id: "a5", name: "Google Sheets", access: "Read and write", bots: ["tally"], lastUsedAt: now - 3 * HOUR },
    ],
    aiAccounts: [
      { id: "claude", name: "Claude", plan: "Max 5x", ok: true, windows: [{ label: "5-hour", usedPercent: 34, resetsAt: now + 2.4 * HOUR }, { label: "Weekly", usedPercent: 61, resetsAt: now + 3 * DAY }] },
      { id: "chatgpt", name: "ChatGPT", plan: "Plus", ok: true, windows: [{ label: "5-hour", usedPercent: 12, resetsAt: now + 4.1 * HOUR }, { label: "Weekly", usedPercent: 47, resetsAt: now + 5 * DAY }] },
    ],
    vault: [
      { id: "v1", name: "Bank portal", kind: "Login", bots: ["tally"], updatedAt: now - 30 * DAY },
      { id: "v2", name: "Clinic booking", kind: "Login", bots: ["echo", "juno"], updatedAt: now - 12 * DAY },
      { id: "v3", name: "npm publish token", kind: "Secret", bots: ["rivet"], updatedAt: now - 70 * DAY },
    ],
    notifications: {
      spend: { email: true, push: true }, health: { email: true, push: true }, routines: { email: false, push: true },
      approvals: { email: false, push: true }, invoices: { email: true, push: false }, weekly: { email: true, push: false },
    },
  };
}

export function sampleDashboard(now = Date.now()): DashboardData {
  const rand = seeded(20261108);
  const turns = makeTurns(now, rand);
  const routines = routinesFor(now);
  const lastActive = new Map<string, number>();
  for (const turn of turns) if (!lastActive.has(turn.botId)) lastActive.set(turn.botId, turn.at);
  const bots: Bot[] = SAMPLE_BOTS.map((bot) => ({ ...bot, routines: routines.filter((r) => r.botId === bot.id), lastActiveAt: lastActive.get(bot.id) ?? now - 30 * DAY }));
  const period = monthStart(now);
  const minutes = turns.filter((t) => t.at >= period).reduce((sum, t) => sum + t.computerMinutes, 0);
  const pcs = computers(now);
  const hours = Math.round((minutes / 60 * 2.4 + 18) * 10) / 10;
  pcs[0]!.hoursThisMonth = Math.round(hours * 0.62 * 10) / 10;
  pcs[1]!.hoursThisMonth = Math.round(hours * 0.38 * 10) / 10;
  const bill = billing(now);
  return {
    now,
    origin: { usage: "sample", bots: "sample", billing: "sample", cloud: "sample", account: "sample" },
    account: account(now),
    bots,
    turns,
    machine: machine(now, rand),
    computers: pcs,
    allowances: allowances(hours),
    billing: bill,
    alerts: [
      { id: "al-grant", tone: "info", text: `Your Claude trial credit ($${bill.grants[0]!.remainingUsd.toFixed(2)} left) ends in 6 days. Juno moves to Cloud AI after that.`, action: { label: "Review", to: "/billing" } },
      { id: "al-routine", tone: "warn", text: "Echo's Voicemail sweep failed twice: the phone connection needs signing in again.", action: { label: "Fix in the app", to: "/bots/echo" } },
    ],
  };
}

export const categoryLabel: Record<Category, string> = { ai: "AI", computer: "Bot computers", voice: "Voice", research: "Research", machine: "My Cloud" };

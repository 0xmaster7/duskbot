import { randomBytes } from "node:crypto";
import type { Mailer, MailMessage } from "../auth/mail.ts";
import type { EmailConfig } from "../email/layout.ts";
import { clientText, fingerprint, isClientSource, maskText, routeOf, shortStack, stackFrames } from "./fingerprint.ts";
import type { IncidentSource } from "./fingerprint.ts";
import { incidentEmail } from "./email.ts";
import type { IncidentMailKind } from "./email.ts";
import type { Incident, IncidentSample, IncidentStore } from "./store.ts";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** the throttle rules; docs/LAUNCH.md "alerts" repeats them for the owner */
export const RULES = {
  /** a new problem is mailed this long after it is first seen, so a burst of new problems shares one email */
  fastMs: 20_000,
  /** repeats of a problem already mailed wait for the digest, at most one digest this often */
  digestMs: 15 * MINUTE,
  /** a problem quiet for this long that comes back is new again */
  quietMs: DAY,
  /** every alert email in an hour, the daily summary aside */
  mailsPerHour: 12,
  /** new client fingerprints (from the public /v1/errors) that may be mailed fast per hour; more wait for the digest */
  fastClientPerHour: 3,
  /** new client fingerprints tracked per hour; past it they fold into one "too many client errors" incident */
  newClientPerHour: 100,
  /** fingerprints kept in memory */
  tracked: 1000,
  /** the daily summary's hour, utc */
  dailyHourUtc: 8,
  /** a failed alert email is retried each minute for this long */
  retryMs: HOUR,
} as const;

export interface IncidentInput {
  source: IncidentSource;
  name?: string;
  message?: string;
  stack?: string | null;
  /** a fixed fingerprint for lines that carry no stack */
  key?: string;
  route?: string | null;
  status?: number | null;
  requestId?: string | null;
  version?: string | null;
  os?: string | null;
  path?: string | null;
  at?: number;
}

export interface IncidentsOptions {
  env: string;
  store: IncidentStore;
  /** where the alert emails go; empty sends none */
  to: () => string[];
  /** tried in order: the second is the fallback when the first refuses */
  mailers: Mailer[];
  email: EmailConfig;
  panelUrl: string;
  /** false records incidents but sends no email (DUSK_ALERTS=off, or development) */
  mail: boolean;
  now?: () => number;
  /** off in tests, which call tick() themselves */
  timers?: boolean;
  log?: (line: string) => void;
}

interface Entry { incident: Incident; pending: number; unsaved: number; fast: boolean }
interface Outgoing { message: Omit<MailMessage, "to">; to: string[]; ids: string[]; until: number }

export function createIncidents(options: IncidentsOptions) {
  const now = options.now ?? Date.now, store = options.store;
  const log = options.log ?? ((line: string) => console.warn(`incidents: ${line}`));
  const entries = new Map<string, Entry>();
  const sent: number[] = [], fastClient: number[] = [], newClient: number[] = [];
  const outbox: Outgoing[] = [];
  let fastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDigest = 0, saving: Promise<void> | null = null, closed = false;
  const stats = { reported: 0, mailed: 0, mailFailed: 0, dropped: 0 };

  const within = (list: number[], ms: number) => { const time = now(); while (list.length && list[0]! <= time - ms) list.shift(); return list.length; };
  const muted = (incident: Incident) => incident.mutedUntil !== null && incident.mutedUntil > now();

  function sample(input: IncidentInput, at: number): IncidentSample {
    const client = isClientSource(input.source);
    const text = client ? clientText : (value: unknown) => maskText(value);
    const name = /^[A-Za-z_$][\w$ .:-]{0,60}$/.test(input.name ?? "") ? input.name! : "Error";
    const frames = stackFrames(`${name}\n${input.stack ?? ""}`);
    const route = routeOf(input.route);
    const message = text(input.message ?? "");
    const id = input.key ? fingerprint({ source: input.source, name, message: input.key, frames: [], route })
      : fingerprint({ source: input.source, name, message, frames, route });
    const short = (value: string | null | undefined, max: number) => value ? maskText(value, max).replace(/[^\w ./:+()-]/g, "") || null : null;
    return { id, env: options.env, source: input.source, name, message, route, status: input.status ?? null, stack: shortStack(frames),
      version: short(input.version, 40), os: short(input.os, 40), path: input.path ? routeOf(input.path) : null,
      requestId: input.requestId && /^[\w-]{4,64}$/.test(input.requestId) ? input.requestId : null, lastSeen: at };
  }

  /** counts one sighting and decides when the owner hears of it; never throws and never waits */
  function report(input: IncidentInput): string | null {
    try {
      if (closed) return null;
      const at = input.at ?? now();
      let fields = sample(input, at);
      let entry = entries.get(fields.id);
      if (!entry && isClientSource(input.source)) {
        if (within(newClient, HOUR) >= RULES.newClientPerHour) {
          stats.dropped++;
          fields = sample({ source: input.source, name: "TooManyClientErrors", key: "overflow", message: `more than ${RULES.newClientPerHour} different client errors in an hour; the rest are counted here` }, at);
          entry = entries.get(fields.id);
        } else newClient.push(now());
      }
      stats.reported++;
      if (!entry) {
        if (entries.size >= RULES.tracked) evict();
        entry = { incident: { ...fields, count: 0, firstSeen: at, notifiedAt: null, mutedUntil: null }, pending: 0, unsaved: 0, fast: false };
        entries.set(fields.id, entry);
      }
      const back = entry.incident.notifiedAt !== null && at - entry.incident.lastSeen > RULES.quietMs;
      Object.assign(entry.incident, fields, { count: entry.incident.count + 1, firstSeen: Math.min(entry.incident.firstSeen, at) });
      entry.pending++; entry.unsaved++;
      if (back) { entry.incident.notifiedAt = null; entry.incident.firstSeen = at; }
      if (!muted(entry.incident) && entry.incident.notifiedAt === null && !entry.fast) {
        const client = isClientSource(input.source);
        if (!client || within(fastClient, HOUR) < RULES.fastClientPerHour) {
          if (client) fastClient.push(now());
          entry.fast = true;
          fastTimer ??= options.timers === false ? null : setTimeout(() => { fastTimer = null; void flushNew(); }, RULES.fastMs);
          fastTimer?.unref?.();
        }
      }
      return fields.id;
    } catch (error) {
      log(`a report was dropped (${error instanceof Error ? error.name : "error"})`);
      return null;
    }
  }

  function evict() {
    const idle = [...entries].filter(([, entry]) => !entry.pending && !entry.unsaved && !entry.fast).sort((a, b) => a[1].incident.lastSeen - b[1].incident.lastSeen);
    for (const [id] of idle.slice(0, Math.max(1, Math.floor(RULES.tracked / 10)))) entries.delete(id);
    if (entries.size >= RULES.tracked) entries.delete(entries.keys().next().value!);
  }

  async function send(kind: IncidentMailKind, items: Array<{ incident: Incident; sinceMail: number | null }>, test = false): Promise<boolean> {
    const to = options.to();
    if (!options.mail || !to.length || !items.length) return false;
    if (kind !== "daily" && within(sent, HOUR) >= RULES.mailsPerHour) { log("the hourly email limit was reached; this waits for the next digest"); return false; }
    if (kind !== "daily") sent.push(now());
    const message = incidentEmail(options.email, { kind, env: options.env, incidents: items, panelUrl: options.panelUrl, test });
    const job: Outgoing = { message, to, ids: items.map(item => item.incident.id), until: now() + RULES.retryMs };
    if (await deliver(job)) return true;
    outbox.push(job);
    if (outbox.length > 20) outbox.shift();
    return true;
  }
  async function deliver(job: Outgoing): Promise<boolean> {
    for (const mailer of options.mailers) {
      try {
        await Promise.all(job.to.map(address => mailer.send({ to: address, ...job.message })));
        stats.mailed++;
        return true;
      } catch { stats.mailFailed++; }
    }
    log(`an alert email failed; it is retried every minute for ${RULES.retryMs / MINUTE} minutes`);
    return false;
  }

  function markMailed(items: Entry[]) {
    const at = now();
    for (const entry of items) { entry.incident.notifiedAt = at; entry.pending = 0; entry.fast = false; }
    void save().then(() => store.notified(items.map(entry => entry.incident.id), at)).catch(() => log("could not mark incidents as mailed"));
  }

  async function flushNew(): Promise<void> {
    const fresh = [...entries.values()].filter(entry => entry.fast);
    if (!fresh.length) return;
    for (const entry of fresh) entry.fast = false;
    if (await send("new", fresh.map(entry => ({ incident: { ...entry.incident }, sinceMail: entry.pending })))) markMailed(fresh);
  }

  async function digest(): Promise<void> {
    const time = now();
    if (time - lastDigest < RULES.digestMs) return;
    const due = [...entries.values()].filter(entry => entry.pending > 0 && !entry.fast && !muted(entry.incident)
      && (entry.incident.notifiedAt === null || time - entry.incident.notifiedAt >= RULES.digestMs));
    if (!due.length) return;
    due.sort((a, b) => b.pending - a.pending);
    if (await send("digest", due.map(entry => ({ incident: { ...entry.incident }, sinceMail: entry.pending })))) { lastDigest = time; markMailed(due); }
  }

  async function daily(): Promise<void> {
    const time = now(), today = Math.floor(time / DAY) * DAY;
    if (time < today + RULES.dailyHourUtc * HOUR || !options.mail || !options.to().length) return;
    const happened = await store.list({ limit: 50, since: today - DAY });
    const yesterday = happened.filter(incident => incident.lastSeen < today || incident.firstSeen < today);
    if (!yesterday.length || !await store.once(`daily|${options.env}|${today}`, time + 7 * DAY)) return;
    await send("daily", yesterday.map(incident => ({ incident, sinceMail: null })));
  }

  async function save(): Promise<void> {
    if (saving) return saving;
    const dirty = [...entries.values()].filter(entry => entry.unsaved > 0);
    if (!dirty.length) return;
    const batch = dirty.map(entry => ({ sample: { ...entry.incident }, add: entry.unsaved, firstSeen: entry.incident.firstSeen }));
    for (const entry of dirty) entry.unsaved = 0;
    saving = store.record(batch).catch(() => {
      for (const [index, entry] of dirty.entries()) entry.unsaved += batch[index]!.add;
      log("incidents could not be saved; they are kept in memory and tried again");
    }).finally(() => { saving = null; });
    return saving;
  }

  async function retry(): Promise<void> {
    const time = now();
    for (const job of [...outbox]) {
      if (job.until < time) { outbox.splice(outbox.indexOf(job), 1); log("an alert email was given up after an hour of retries"); continue; }
      if (await deliver(job)) outbox.splice(outbox.indexOf(job), 1);
    }
  }

  /** once a minute: save, retry, digest, daily summary */
  async function tick(): Promise<void> {
    await save();
    await retry();
    await digest();
    await daily().catch(() => log("the daily summary failed"));
  }

  /** loads the last day's incidents, so a restart (or a crash loop) does not mail old problems as new */
  async function load(): Promise<void> {
    const recent = await store.list({ limit: RULES.tracked, since: now() - RULES.quietMs });
    for (const incident of recent) if (!entries.has(incident.id)) entries.set(incident.id, { incident, pending: 0, unsaved: 0, fast: false });
  }

  const timer = options.timers === false ? null : setInterval(() => { void tick().catch(() => log("a tick failed")); }, MINUTE);
  timer?.unref?.();

  return {
    report,
    tick,
    flushNew,
    load,
    stats,
    /** an owner's test: a fresh fingerprint each time, mailed at once */
    async test(source: "test" | "server" = "test"): Promise<string | null> {
      const nonce = randomBytes(4).toString("hex");
      const id = report({ source, name: "TestAlert", message: `a test alert (${nonce}) fired by the owner`, key: `test-${nonce}`, route: "/v1/admin/incidents/test",
        stack: `TestAlert: test\n    at fireTest (apps/dashboard/server/incidents/routes.ts:1:1)`, requestId: `test-${nonce}` });
      const entry = id ? entries.get(id) : undefined;
      if (!entry) return null;
      entry.fast = false;
      if (await send("new", [{ incident: { ...entry.incident }, sinceMail: 1 }], true)) markMailed([entry]);
      return id;
    },
    async list(query: { limit: number; before?: number; source?: string }) { await save(); return store.list(query); },
    async mute(id: string, until: number | null) {
      const found = await store.mute(id, until);
      const entry = entries.get(id);
      if (entry) { entry.incident.mutedUntil = until; if (until !== null) { entry.pending = 0; entry.fast = false; } }
      return found || !!entry;
    },
    async close() {
      if (fastTimer) clearTimeout(fastTimer);
      if (timer) clearInterval(timer);
      await save().catch(() => {});
      closed = true;
    },
  };
}
export type Incidents = ReturnType<typeof createIncidents>;

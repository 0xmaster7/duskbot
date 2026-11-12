import type { Mailer } from "../auth/mail.ts";
import type { AnalyticsSink } from "../analytics/sink.ts";
import { DAY, HOUR, visitsOf } from "../analytics/web.ts";
import type { LedgerEntry } from "../billing/ledger.ts";

/** DUSK_ADMIN_ALERTS: which emails the admins get; "all", or any of these, comma-separated; unset sends none.
 *  "paid" is the first payment ever and money trouble: a paying customer's failed payment, a dispute, a refund, a big
 *  customer's churn and MRR milestones */
export const ALERT_KINDS = ["signup", "paid", "waitlist", "spike", "digest"] as const;
/** MRR milestones in cents: $100, $500, $1k, $2.5k, $5k, $10k, $25k, $50k, $100k a month */
export const MRR_MILESTONES = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
/** DUSK_ALERT_CHURN_CENTS: a churned customer worth at least this much MRR gets its own email; $50 unless set */
export function churnThreshold(value: string | undefined) { const cents = Number(value); return Number.isSafeInteger(cents) && cents >= 0 && value !== "" && value !== undefined ? cents : 5_000; }
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export interface MoneyDigest { newCustomers: Array<{ email: string | null; cents: number }>; mrr: number; netNew: number; failed: number; recovered: number; churned: number; refunds: number }
export type AlertKind = (typeof ALERT_KINDS)[number];
export function parseAlerts(value: string | undefined): Set<AlertKind> {
  const parts = (value ?? "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return new Set(parts.includes("all") ? ALERT_KINDS : ALERT_KINDS.filter(kind => parts.includes(kind)));
}

/** the visitors of the last hour against the median hour of the week before: a spike is 4x and at least 20 */
export function isSpike(lastHour: number, hours: number[]): boolean {
  const sorted = [...hours].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  return lastHour >= 20 && lastHour >= 4 * Math.max(1, median);
}

const MAX_PER_HOUR = 30;
const esc = (text: string) => text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]!);

export interface AlertsOptions {
  kinds: Set<AlertKind>;
  emails: () => string[];
  mailer: Mailer;
  sink: AnalyticsSink;
  now: () => number;
  /** the admin panel's address, for links in the emails */
  panelUrl: string;
  /** yesterday's numbers for the digest: signups, payments, waitlist joins */
  totals(from: number, to: number): { signups: number; paid: number; waitlist: number | null; accounts: number; money?: MoneyDigest };
  churnCents?: number;
}

/**
 * Emails to the admins: a signup, a first payment, waitlist joins (batched hourly), a traffic spike (at most every six hours)
 * and a daily digest at 08:00 UTC. Marks in the sink keep a restart from sending one twice.
 */
export function createAlerts(options: AlertsOptions) {
  const { kinds, sink, now } = options;
  const sent: number[] = [];
  let waitlist = 0;
  async function send(subject: string, lines: string[]) {
    const to = options.emails();
    if (!to.length) return;
    const time = now();
    while (sent.length && sent[0]! < time - HOUR) sent.shift();
    if (sent.length >= MAX_PER_HOUR) return;
    sent.push(time);
    const text = `${lines.join("\n")}\n\n${options.panelUrl}`;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#131316">${lines.map(line => `<p style="margin:0 0 8px">${esc(line)}</p>`).join("")}<p style="margin:16px 0 0"><a href="${esc(options.panelUrl)}">open the admin panel</a></p></div>`;
    for (const address of to) await options.mailer.send({ to: address, subject, text, html }).catch(() => console.warn("alerts: an admin email failed"));
  }
  function signup(email: string, method: string) {
    if (kinds.has("signup")) void send(`New signup: ${email}`, [`${email} made a dusk bot account (${method}).`]);
  }
  /** the first payment ever; each later new customer is in the daily digest instead */
  function paid(accountId: string, email: string | null, amountCents: number) {
    if (!kinds.has("paid") || amountCents <= 0) return;
    void sink.once("alert|paid|first-ever", null).then(first => {
      if (first) void send(`First payment ever: ${email ?? "an account"}`, [`${email ?? accountId} just paid ${usd(amountCents)}. That's dusk bot's first money in.`]);
    }, () => {});
  }
  /** one email per incident, each behind a mark so a retry, a replay or a restart never sends it twice */
  async function money(entry: LedgerEntry, facts: { email: string | null; paidBefore: boolean; mrr: number }) {
    if (!kinds.has("paid")) return;
    const who = facts.email ?? entry.accountId ?? "a customer", time = now();
    const failure = entry.type === "payment.failed" || entry.type === "subscription.on_hold" || entry.type === "subscription.failed";
    if (failure && facts.paidBefore && await sink.once(`alert|failed|${entry.subscriptionId ?? entry.accountId ?? entry.providerPaymentId}`, time + 30 * DAY)) {
      await send(`Payment failed: ${who}`, [`A payment from ${who} didn't go through${entry.amountCents ? ` (${usd(entry.amountCents)})` : ""}${entry.reason ? `: ${entry.reason.replace(/_/g, " ")}` : ""}.`,
        "dodo retries it on its own. You'll hear again only if it fails again after a month."]);
    }
    if (entry.type === "dispute.opened" && await sink.once(`alert|dispute|${entry.providerRef ?? entry.id}`, null)) {
      await send(`Dispute opened: ${who}`, [`${who} disputed a payment${entry.amountCents ? ` of ${usd(entry.amountCents)}` : ""}. Answer it in the dodo dashboard before its deadline.`]);
    }
    if (entry.type === "refund.succeeded" && await sink.once(`alert|refund|${entry.providerRef ?? entry.id}`, null)) {
      await send(`Refund: ${usd(entry.amountCents ?? 0)} to ${who}`, [`${usd(entry.amountCents ?? 0)} went back to ${who}${entry.reason ? ` (${entry.reason})` : ""}.`]);
    }
    const churn = entry.type === "subscription.cancelled" || entry.type === "subscription.expired";
    if (churn && (entry.mrrCents ?? 0) >= (options.churnCents ?? 5_000) && await sink.once(`alert|churn|${entry.subscriptionId ?? entry.id}`, null)) {
      await send(`Customer lost: ${who} (${usd(entry.mrrCents ?? 0)}/mo)`, [`${who} stopped paying for ${entry.plan ?? "their plan"}, worth ${usd(entry.mrrCents ?? 0)} a month.`]);
    }
    const reached = MRR_MILESTONES.filter(cents => facts.mrr >= cents);
    const fresh: number[] = [];
    for (const cents of reached) if (await sink.once(`alert|mrr|${cents}`, null)) fresh.push(cents);
    if (fresh.length) await send(`MRR passed ${usd(fresh.at(-1)!).replace(/\.00$/, "")} a month`, [`dusk bot now makes ${usd(facts.mrr)} a month in recurring revenue.`]);
  }
  function waitlistJoin() { if (kinds.has("waitlist")) waitlist++; }
  async function tick() {
    const time = now();
    if (kinds.has("waitlist") && waitlist > 0) {
      const count = waitlist; waitlist = 0;
      await send(`${count} new on the waitlist`, [`${count} ${count === 1 ? "person" : "people"} joined the waitlist in the last hour.`]);
    }
    if (kinds.has("spike")) {
      const events = await sink.scan(time - 7 * DAY - HOUR, time, ["site_view"]);
      const hours = Array.from({ length: 7 * 24 }, () => new Set<string>());
      const last = new Set<string>();
      for (const visit of visitsOf(events)) {
        if (visit.start >= time - HOUR) last.add(visit.visitor);
        else { const index = Math.floor((time - HOUR - visit.start) / HOUR); hours[index]?.add(visit.visitor); }
      }
      if (isSpike(last.size, hours.map(set => set.size)) && await sink.once(`alert|spike|${Math.floor(time / (6 * HOUR))}`, time + 7 * DAY)) {
        await send(`Traffic spike: ${last.size} visitors in the last hour`, [`${last.size} people visited the site in the last hour, at least 4 times a usual hour this week.`]);
      }
    }
    const today = Math.floor(time / DAY) * DAY;
    if (kinds.has("digest") && time >= today + 8 * HOUR && await sink.once(`alert|digest|${today}`, time + 7 * DAY)) {
      const from = today - DAY, events = await sink.scan(from, today, ["site_view", "site_goal", "site_leave"]);
      const visits = visitsOf(events), visitors = new Set(visits.map(visit => visit.visitor)).size;
      const channels = new Map<string, number>();
      for (const visit of visits) channels.set(visit.channel, (channels.get(visit.channel) ?? 0) + 1);
      const top = [...channels].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([channel, count]) => `${channel} ${count}`).join(", ");
      const totals = options.totals(from, today);
      await send(`dusk bot yesterday: ${visitors} visitors, ${totals.signups} signups`, [
        `Visitors: ${visitors}${top ? ` (${top})` : ""}.`, `Signups: ${totals.signups}. Accounts in all: ${totals.accounts}.`,
        `Paid: ${totals.paid}.`, ...(totals.waitlist === null ? [] : [`Waitlist joins: ${totals.waitlist}.`]),
        ...(totals.money ? [
          ...(totals.money.newCustomers.length ? [`New paying customers: ${totals.money.newCustomers.length} (${totals.money.newCustomers.slice(0, 10).map(row => `${row.email ?? "an account"} ${usd(row.cents)}`).join(", ")}${totals.money.newCustomers.length > 10 ? ", and more" : ""}).`] : []),
          `MRR: ${usd(totals.money.mrr)} (${totals.money.netNew >= 0 ? "+" : "-"}${usd(Math.abs(totals.money.netNew))} yesterday).`,
          ...(totals.money.failed || totals.money.recovered || totals.money.churned || totals.money.refunds
            ? [`Failed payments: ${totals.money.failed}, recovered: ${totals.money.recovered}, cancellations: ${totals.money.churned}, refunds: ${totals.money.refunds}.`] : []),
        ] : [])]);
    }
  }
  const timer = kinds.size ? setInterval(() => { void tick().catch(() => console.warn("alerts: a check failed")); }, 10 * 60_000) : null;
  timer?.unref();
  return { signup, paid, money: (entry: LedgerEntry, facts: { email: string | null; paidBefore: boolean; mrr: number }) => { void money(entry, facts).catch(() => console.warn("alerts: a money alert failed")); }, waitlistJoin, tick, close() { if (timer) clearInterval(timer); } };
}

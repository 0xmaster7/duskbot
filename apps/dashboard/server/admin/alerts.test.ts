import { describe, expect, it } from "vitest";
import { memorySink } from "../analytics/sink.ts";
import { memoryMailer } from "../auth/mail.ts";
import { createAlerts, isSpike, parseAlerts } from "./alerts.ts";

const HOUR = 3_600_000, DAY = 86_400_000;
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe("admin alerts", () => {
  function setup(kinds: string, time: { now: number }) {
    const mailer = memoryMailer(), sink = memorySink(() => time.now);
    const alerts = createAlerts({ kinds: parseAlerts(kinds), emails: () => ["owner@example.test"], mailer, sink, now: () => time.now, panelUrl: "https://preview.dusk.bot/app/admin",
      totals: () => ({ signups: 3, paid: 1, waitlist: null, accounts: 40 }) });
    return { mailer, sink, alerts };
  }
  it("reads which alerts are on", () => {
    expect([...parseAlerts("all")]).toEqual(["signup", "paid", "waitlist", "spike", "digest"]);
    expect([...parseAlerts("signup, digest, nonsense")]).toEqual(["signup", "digest"]);
    expect(parseAlerts(undefined).size).toBe(0);
  });
  it("calls a spike only at four times a usual hour and at least 20 visitors", () => {
    expect(isSpike(19, [1, 1, 1])).toBe(false);
    expect(isSpike(20, [1, 2, 5])).toBe(true);
    expect(isSpike(40, [10, 12, 11])).toBe(false);
    expect(isSpike(44, [10, 11, 12])).toBe(true);
  });
  it("mails a signup, a first payment once, batches waitlist joins, and sends nothing that is off", async () => {
    const time = { now: Date.parse("2026-11-12T06:00:00Z") };
    const { mailer, alerts } = setup("signup,paid,waitlist", time);
    alerts.signup("new@example.test", "google");
    alerts.paid("acct_1", "new@example.test", 2000); alerts.paid("acct_1", "new@example.test", 2000);
    alerts.waitlistJoin(); alerts.waitlistJoin();
    await settle();
    await alerts.tick();
    expect(mailer.outbox.map(mail => mail.subject)).toEqual(["New signup: new@example.test", "First payment: new@example.test", "2 new on the waitlist"]);
    expect(mailer.outbox[1]!.text).toContain("$20.00");
    alerts.close();
    const off = setup("", time);
    off.alerts.signup("x@example.test", "email");
    await off.alerts.tick();
    expect(off.mailer.outbox).toEqual([]);
  });
  it("sends one digest a day after 08:00 UTC and one spike mail per six hours", async () => {
    const time = { now: Date.parse("2026-11-12T08:05:00Z") };
    const { mailer, sink, alerts } = setup("digest,spike", time);
    for (let v = 0; v < 25; v++) await sink.insert({ id: `e${v}`, name: "site_view", at: time.now - 10 * 60_000, accountId: null, props: { path: "/" }, ctx: { visitor: `visitor-${v}`, session: `session-${v}`, pv: `pv-${v}` } });
    await alerts.tick(); await alerts.tick();
    expect(mailer.outbox.map(mail => mail.subject)).toEqual(["Traffic spike: 25 visitors in the last hour", "dusk bot yesterday: 0 visitors, 3 signups"]);
    time.now += DAY + HOUR;
    await alerts.tick();
    expect(mailer.outbox.filter(mail => mail.subject.startsWith("dusk bot yesterday"))).toHaveLength(2);
    alerts.close();
  });
});

// made-up people, clouds, events and waitlist entries for the admin panel in the local fixture; nothing here is real
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createDashboardApp } from "../server/app.ts";
import { memoryWaitlist, type WaitlistEntry } from "../server/admin/waitlist.ts";
import { BILLING_CONFIG } from "../server/billing/plans.ts";

const DAY = 86_400_000;
const PEOPLE = ["mira.okafor", "tomas.lindqvist", "priya.raman", "jules.moreau", "kenji.watanabe", "ana.ferreira", "leo.brandt", "sofia.marin", "ravi.kulkarni", "noor.haddad",
  "elena.petrova", "sam.oduya", "hana.kim", "diego.alvarez", "freya.holm", "omar.siddiqui", "lucia.rossi", "ben.carter"];
const COUNTRIES = ["US", "IN", "DE", "GB", "FR", "BR", "JP", "CA", "NL", "SE"];
const REFERRERS: Array<string | undefined> = [undefined, undefined, "www.google.com", "x.com", "news.ycombinator.com", "chatgpt.com", "www.reddit.com", "perplexity.ai", "someblog.dev"];
const id = (prefix: string) => `${prefix}${randomBytes(16).toString("base64url")}`;
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

export interface SeededAccount { id: string; email: string; name: string; createdAt: number }

/** writes auth.json before the service starts, so the seeded accounts have real sign-up dates */
export function seedAdminAuth(dataDir: string, now: number): SeededAccount[] {
  const accounts = PEOPLE.map((handle, i) => ({ id: id("acct_"), email: `${handle}@example.test`, name: handle.split(".").map(part => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    createdAt: now - Math.round((i * 1.7 + rand() * 2) * DAY) - Math.round(rand() * 20) * 3_600_000 }));
  const identities = accounts.filter((_, i) => i % 3 === 0).map(account => ({ accountId: account.id, provider: "google", subject: id("g_"), email: account.email, label: account.email, addedAt: account.createdAt }));
  const sessions = accounts.flatMap((account, i) => {
    const list = [{ kind: "web", name: "Browser", platform: null, appVersion: null }];
    if (i % 2 === 0) list.push({ kind: "desktop", name: `${account.name.split(" ")[0]}'s ${i % 4 === 0 ? "MacBook Pro" : "PC"}`, platform: i % 4 === 0 ? "darwin" : "win32", appVersion: i % 6 === 0 ? "0.2.14" : "0.2.15" } as never);
    if (i % 5 === 1) list.push({ kind: "mobile", name: "iPhone", platform: "ios", appVersion: "0.2.15" } as never);
    return list.map(device => ({ id: id("ses_"), accountId: account.id, tokenHash: createHash("sha256").update(id("t")).digest("hex"), ...device,
      createdAt: account.createdAt + 3_600_000, lastSeenAt: now - Math.round(rand() * 5 * DAY), expiresAt: now + 60 * DAY }));
  });
  writeFileSync(join(dataDir, "auth.json"), JSON.stringify({ accounts: accounts.map(a => ({ ...a, name: a.name })), identities, sessions }), { mode: 0o600 });
  return accounts;
}

export function seedWaitlist(now: number) {
  const entries: WaitlistEntry[] = [];
  for (let i = 0; i < 64; i++) entries.push({ email: `waiting${String(i + 1).padStart(2, "0")}@example.test`, position: i + 1, createdAt: now - Math.round((64 - i) * 0.6 * DAY + rand() * DAY),
    source: pick(["home", "pricing", "x", "launch", null] as const), ref: rand() < 0.2 ? pick(["friend", "newsletter"]) : null });
  return memoryWaitlist(entries);
}

/** clouds through the real (fake-provider) checkout path, then a month of events */
export async function seedAdminData(app: ReturnType<typeof createDashboardApp>, accounts: SeededAccount[], now: number) {
  const { analytics, billing } = app;
  for (const [i, account] of accounts.slice(0, 6).entries()) {
    const bundle = BILLING_CONFIG.bundles.find(item => item.id === (i % 3 === 2 ? "pro" : "starter"))!;
    const answer = await billing.service.checkout({ id: account.id, email: account.email }, { kind: "cart", cart: billing.service.quote({ ...bundle.cart, interval: "month" }).cart, name: `${account.name.split(" ")[0]}'s cloud` }, { source: pick(["dash_onboarding", "app_card", "dash_home"] as const) });
    if (i === 5) continue;
    const stored = billing.store.state.checkouts.find(item => item.id === answer.checkoutId)!;
    for (const delivery of billing.fake!.complete(stored.providerSessionId!)) billing.service.handleWebhook(delivery.headers, delivery.body);
  }
  for (let n = 0; n < 8; n++) await billing.clouds.reconcile();
  const paused = billing.clouds.list(accounts[1]!.id)[0];
  if (paused) await billing.clouds.power(paused.accountId, paused.id, "off").catch(() => {});

  const days = 30;
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = now - d * DAY;
    const visitors = 18 + Math.round(rand() * 30 + (days - d) * 0.8);
    for (let v = 0; v < visitors; v++) {
      const visitor = id("v");
      const referrer = pick(REFERRERS);
      const channel = !referrer ? "direct" : /chatgpt|perplexity/.test(referrer) ? "ai" : /google/.test(referrer) ? "search" : /x\.com|reddit|ycombinator/.test(referrer) ? "social" : "referral";
      for (const path of ["/", ...(rand() < 0.5 ? ["/pricing"] : []), ...(rand() < 0.2 ? ["/docs"] : [])]) {
        await analytics.record("site_view", { at: dayStart - Math.round(rand() * 20 * 3_600_000), visitor, props: { path },
          ctx: { page: path, referrer, channel, country: pick(COUNTRIES), device: rand() < 0.3 ? "mobile" : "desktop" } });
      }
    }
  }
  for (const [i, account] of accounts.entries()) {
    await analytics.record("signup", { accountId: account.id, at: account.createdAt, props: { method: i % 3 === 0 ? "google" : "email" } });
    await analytics.record("sign_in", { accountId: account.id, at: account.createdAt + 1000, props: { kind: "web" } });
    for (const [s, step] of ["name", "plan", "app"].entries()) if (i % 7 !== 3 || s === 0) await analytics.record("onboarding_step", { accountId: account.id, at: account.createdAt + (s + 1) * 60_000, props: { step } });
    if (i % 7 !== 3) await analytics.record("onboarding_done", { accountId: account.id, at: account.createdAt + 5 * 60_000 });
    if (i % 2 === 0) await analytics.record("app_paired", { accountId: account.id, at: account.createdAt + 3_600_000, props: { via: "app", platform: i % 4 === 0 ? "darwin" : "win32" } });
    if (i % 3 !== 2 && i < 12) await analytics.record("first_bot_reply", { accountId: account.id, at: account.createdAt + 2 * 3_600_000 });
    for (let t = account.createdAt + DAY; t < now; t += DAY) {
      if (rand() < 0.55) await analytics.record("page_view", { accountId: account.id, at: t, props: { path: pick(["/", "/bots", "/usage", "/cloud", "/billing"]) } });
      if (i % 2 === 0 && rand() < 0.7) await analytics.record("app_active", { accountId: account.id, at: t + 3_600_000, props: { platform: i % 4 === 0 ? "darwin" : "win32", appVersion: "0.2.15" } });
    }
  }
}

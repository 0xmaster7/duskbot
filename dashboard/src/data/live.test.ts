import assert from "node:assert/strict";
import test from "node:test";
import { accountFromWire, billingFromWire, cartFromSelection, catalogFromWire, cloudFromWire, providersFromWire, selectionFromCart, subscriptionFromWire } from "./live.ts";
import type { Selection } from "./contracts.ts";
import { CLOUD_STATUSES, SETUP_STEPS, SUBSCRIPTION_STATUSES, type AccountAnswer, type BillingOverview, type Catalog, type CloudDesktopView, type SubscriptionView } from "./wire.ts";

const catalog: Catalog = {
  v: 1, currency: "USD", defaultRegion: "eu", yearlyDiscountPercent: 20, freeWorkUntil: 1_800_000_000_000, graceDays: 7,
  licenses: [
    { kind: "solo", label: "Solo", monthlyCents: 1200, includedMembers: 1, extraMemberCents: null, maxMembers: 1, priority: false },
    { kind: "team", label: "Team", monthlyCents: 3000, includedMembers: 3, extraMemberCents: 1500, maxMembers: 50, priority: true },
  ],
  desktops: [
    { kind: "shared_s", label: "Shared S", monthlyCents: 1000, machine: { vcpu: 2, ramGb: 4, diskGb: 40 }, placement: "pool", botComputers: 2, priority: false },
    { kind: "shared_m", label: "Shared M", monthlyCents: 4000, machine: { vcpu: 4, ramGb: 8, diskGb: 80 }, placement: "pool", botComputers: 5, priority: true },
    { kind: "dedicated", label: "Dedicated", monthlyCents: null, machine: { vcpu: 8, ramGb: 16, diskGb: 165 }, placement: "dedicated", botComputers: null, priority: true },
  ],
  dedicated: { baseCents: 600, perVcpuCents: 350, perGbRamCents: 125, per10GbDiskCents: 51, includedDiskGb: 100, vcpu: { min: 2, max: 32, step: 2 }, ramGb: { min: 4, max: 64, step: 4 }, diskGb: { min: 40, max: 1000, step: 20 } },
  bundles: [
    { id: "free", label: "Free", monthlyCents: 0, yearlyMonthlyCents: 0, cart: { license: { kind: "none" }, desktop: { kind: "none" } }, highlights: ["Personal use"] },
    { id: "starter", label: "Starter", monthlyCents: 2000, yearlyMonthlyCents: 1600, cart: { license: { kind: "solo" }, desktop: { kind: "shared_s" } }, highlights: ["Always on"] },
    { id: "pro", label: "Pro", monthlyCents: 5000, yearlyMonthlyCents: 4000, cart: { license: { kind: "solo" }, desktop: { kind: "shared_m" } }, highlights: ["Priority"] },
    { id: "team", label: "Team", monthlyCents: 10000, yearlyMonthlyCents: 8000, cart: { license: { kind: "team" }, desktop: { kind: "dedicated" } }, highlights: ["Unlimited computers"] },
  ],
  regions: [{ id: "us", country: "United States", label: "Ashburn" }, { id: "eu", country: "Germany", label: "Falkenstein" }, { id: "ap", country: "Singapore", label: "Singapore" }],
  creditPacks: [{ id: "credits-10", label: "$10", priceCents: 1000, creditCents: 1200 }],
};

test("catalog maps ids, prices, bundles, custom pricing and the default region", () => {
  const result = catalogFromWire(catalog);
  assert.deepEqual(result.licenses[0], { id: "personal", name: "Personal", monthly: 0, includedMembers: 1, perExtraMember: 0, maxMembers: 1, work: false, blurb: "Personal and non-commercial use" });
  assert.deepEqual(result.licenses.slice(1).map((license) => [license.id, license.name, license.monthly, license.perExtraMember, license.work, license.blurb]), [["starter", "Solo", 12, 0, true, ""], ["team", "Team", 30, 15, true, ""]]);
  assert.deepEqual(result.desktops.map((desktop) => [desktop.id, desktop.placement, desktop.monthly, desktop.sizable]), [["shared-s", "shared", 10, false], ["shared-m", "shared", 40, false], ["dedicated", "dedicated", 57.32, true]]);
  assert.equal(result.custom.includedDiskGb, 100);
  assert.equal(result.custom.base, 6);
  assert.equal(result.custom.perVcpu, 3.5);
  assert.equal(result.custom.perGbRam, 1.25);
  assert.equal(result.custom.per10GbDisk, 0.51);
  assert.deepEqual(result.custom.diskGb, catalog.dedicated.diskGb);
  assert.deepEqual(result.bundles.map((bundle) => [bundle.license, bundle.members, bundle.desktop, bundle.monthly, bundle.recommended]), [["personal", 1, "none", 0, false], ["starter", 1, "shared-s", 20, false], ["starter", 1, "shared-m", 50, true], ["team", 3, "dedicated", 100, false]]);
  assert.equal(result.bundles[0]!.blurb, "For personal use on your Mac or your own VPS");
  assert.equal(result.bundles[1]!.blurb, "Work license and a cloud desktop that never sleeps");
  assert.equal(result.bundles[2]!.blurb, "More room and priority for serious bots");
  assert.equal(result.bundles[3]!.blurb, "A dedicated machine for the whole team");
  assert.deepEqual(result.bundles[2]!.features, ["Priority"]);
  assert.deepEqual(result.regions, [{ id: "eu", name: "Germany", city: "Falkenstein" }, { id: "us", name: "United States", city: "Ashburn" }, { id: "ap", name: "Singapore", city: "Singapore" }]);
  assert.equal(result.yearlyDiscount, 0.2);
  assert.equal(result.workFreeUntil, catalog.freeWorkUntil);
  assert.deepEqual(result.creditPacks, [{ id: "credits-10", usd: 10 }]);
  const smaller = structuredClone(catalog);
  smaller.desktops[2]!.machine.diskGb = 40;
  assert.equal(catalogFromWire(smaller).desktops[2]!.monthly, 54);
});

test("selection and cart round trip and omit fields irrelevant to the chosen parts", () => {
  const plans = catalogFromWire(catalog);
  for (const license of ["personal", "starter", "team"] as const) for (const desktop of ["none", "shared-s", "shared-m", "dedicated"] as const) for (const interval of ["month", "year"] as const) {
    const selection: Selection = { license, members: license === "team" ? 7 : 1, desktop, size: desktop === "dedicated" ? { vcpu: 8, ramGb: 16, diskGb: 160 } : null, region: desktop === "none" ? "eu" : "us", interval };
    const cart = cartFromSelection(selection);
    assert.deepEqual(selectionFromCart(cart, plans), selection);
    assert.equal("members" in cart.license, license === "team");
    assert.equal("region" in cart.desktop, desktop !== "none");
    assert.equal("spec" in cart.desktop, desktop === "dedicated");
  }
  assert.deepEqual(selectionFromCart({ interval: "month", license: { kind: "team" }, desktop: { kind: "dedicated" } }, plans), { license: "team", members: 3, desktop: "dedicated", size: null, region: "eu", interval: "month" });
  const irrelevant: Selection = { license: "starter", members: 99, desktop: "none", region: "ap", size: { vcpu: 4, ramGb: 8, diskGb: 80 }, interval: "month" };
  assert.deepEqual(cartFromSelection(irrelevant), { interval: "month", license: { kind: "solo" }, desktop: { kind: "none" } });
});

const cloud: CloudDesktopView = { id: "cloud", name: "My Cloud", color: null, kind: "shared_m", placement: "pool", status: "provisioning", setupStep: "reserving", region: "eu", machine: { vcpu: 4, ramGb: 8, diskGb: 80 }, botComputers: 5, origin: null, workspaceId: "workspace", lastReportAt: null, destroyAt: null, error: null, subscriptionId: "sub", createdAt: 123 };

test("cloud statuses, progress, errors and destroyed desktops map to the view", () => {
  const expected = ["provisioning", "provisioning", "running", "sleeping", "stopped", "error", "error", "error", null, null];
  CLOUD_STATUSES.forEach((status, index) => {
    const result = cloudFromWire({ ...cloud, status });
    assert.equal(result?.status ?? null, expected[index]);
    if (result && result.status !== "provisioning") assert.equal(result.progress, null);
  });
  const labels = ["Reserving your machine", "Preparing its disk", "Installing OpenMausBot", "Waking your bots"];
  SETUP_STEPS.forEach((setupStep, index) => assert.deepEqual(cloudFromWire({ ...cloud, setupStep })!.progress, { step: labels[index], value: (index + 0.5) / 4 }));
  assert.equal(cloudFromWire({ ...cloud, setupStep: null })!.progress, null);
  assert.equal(cloudFromWire({ ...cloud, status: "payment_problem" })!.error, "The last payment did not go through. Update your card to wake it.");
  assert.equal(cloudFromWire({ ...cloud, status: "suspended" })!.error, "It is paused. Write to us to sort it out.");
  assert.equal(cloudFromWire({ ...cloud, status: "error", error: "Setup failed" })!.error, "Setup failed");
  assert.deepEqual(cloudFromWire({ ...cloud, status: "running" }), { id: "cloud", name: "My Cloud", status: "running", tier: "shared-m", placement: "shared", region: "eu", vcpu: 4, ramGb: 8, diskGb: 80, workspaceId: "workspace", createdAt: 123, progress: null, error: null, botComputers: { used: 0, limit: 5 }, uptimeSec: null });
  assert.equal(cloudFromWire({ ...cloud, kind: "dedicated", placement: "dedicated", botComputers: null })!.tier, "dedicated");
});

const account: AccountAnswer = {
  account: { id: "account", email: "me@example.test", name: null, providers: ["google", "email", "x", "apple"], createdAt: 1000 },
  identities: [
    { provider: "google", label: "My name", email: "google@example.test", addedAt: 2000 },
    { provider: "x", label: null, email: "x@example.test", addedAt: 3000 },
    { provider: "apple", label: null, email: null, addedAt: 4000 },
  ],
  sessions: ["web", "desktop", "mobile"].map((kind, index) => ({ id: String(index), kind: kind as "web" | "desktop" | "mobile", name: `Device ${index}`, platform: "Platform", appVersion: null, createdAt: 1000, lastSeenAt: 5000, expiresAt: 10000, current: index === 0 })),
};

test("account prepends email, preserves OAuth identities, and maps devices and local preferences", () => {
  const emptyStorage = { getItem: () => null };
  const result = accountFromWire(account, 5000, emptyStorage);
  assert.deepEqual(result.identities, [{ provider: "email", label: "me@example.test", linkedAt: 1000 }, { provider: "google", label: "My name", linkedAt: 2000 }, { provider: "x", label: "x@example.test", linkedAt: 3000 }, { provider: "apple", label: "", linkedAt: 4000 }]);
  assert.deepEqual(result.devices.map((device) => [device.kind, device.label, device.location, device.current]), [["browser", "Device 0", null, true], ["desktop", "Device 1", null, false], ["phone", "Device 2", null, false]]);
  assert.equal(result.profile.onboarded, false);
  assert.equal(result.profile.avatarUrl, null);
  assert.deepEqual(result.notifications, { cloudStatus: true, billing: true, botDigest: true, product: false });
  const saved = new Map([["omb-dash-onboarded:account", "1"], ["omb-dash-notify", JSON.stringify({ billing: false, product: true })]]);
  const local = accountFromWire(account, 5000, { getItem: (key) => saved.get(key) ?? null });
  assert.equal(local.profile.onboarded, true);
  assert.deepEqual(local.notifications, { cloudStatus: true, billing: false, botDigest: true, product: true });
  assert.equal(accountFromWire(account, 86_401_001, emptyStorage).profile.onboarded, true);
  assert.deepEqual(accountFromWire({ ...account, account: { ...account.account, providers: ["google"] } }, 5000, emptyStorage).identities, result.identities.slice(1));
  assert.deepEqual(accountFromWire(account, 5000, { getItem: () => { throw new Error("unavailable"); } }).notifications, result.notifications);
});

test("billing selects the newest non-ended subscription and maps invoices and monthly credit use", () => {
  const plans = catalogFromWire(catalog);
  const subscription: SubscriptionView = { id: "sub", cart: { interval: "month", license: { kind: "solo" }, desktop: { kind: "shared_m", region: "eu" } }, bundle: "pro", lines: [], totalCents: 5000, status: "active", licenseId: null, cloudId: null, currentPeriodEnd: 9999, cancelAtPeriodEnd: true, createdAt: 1 };
  SUBSCRIPTION_STATUSES.forEach((status, index) => assert.equal(subscriptionFromWire({ ...subscription, status }, plans).status, ["pending", "active", "past_due", "canceled", "canceled"][index]));
  assert.equal(subscriptionFromWire({ ...subscription, currentPeriodEnd: null, cancelAtPeriodEnd: false }, plans).currentPeriodEnd, 0);
  const now = new Date(2026, 10, 8).getTime();
  const overview: BillingOverview = {
    v: 1, subscriptions: [subscription, { ...subscription, id: "new", createdAt: 2 }, { ...subscription, id: "ended", status: "ended", createdAt: 3 }], licenses: [], license: { v: 1, work: "unlicensed", license: null, freeWorkUntil: null, checkedAt: now }, clouds: [],
    invoices: { invoices: [{ id: "invoice", at: now, amountCents: 1250, currency: "USD", status: "failed", description: "Plan", downloadUrl: "/invoice" }], nextCursor: null },
    credits: { balanceCents: 1234, entries: [{ id: "usage", at: now, deltaCents: -150, reason: "usage" }, { id: "prior", at: new Date(2026, 9, 31).getTime(), deltaCents: -900, reason: "usage" }, { id: "future", at: new Date(2026, 11, 1).getTime(), deltaCents: -900, reason: "usage" }, { id: "topup", at: now, deltaCents: 1000, reason: "top_up" }] },
  };
  const result = billingFromWire(overview, plans, now);
  assert.equal(result.subscription!.id, "new");
  assert.equal(result.subscription!.amountUsd, 50);
  assert.equal(result.subscription!.cancelAt, 9999);
  assert.equal(result.paymentMethod, null);
  assert.deepEqual(result.invoices, [{ id: "invoice", number: "invoice", date: now, amountUsd: 12.5, status: "open", description: "Plan", url: "/invoice" }]);
  assert.deepEqual(result.credits, { balanceUsd: 12.34, autoTopUp: false, usedThisMonthUsd: 1.5 });
  assert.equal(billingFromWire({ ...overview, subscriptions: [{ ...subscription, status: "ended" }] }, plans, now).subscription, null);
  assert.deepEqual(providersFromWire({ v: 1, signupOpen: true, providers: [{ id: "apple", enabled: false, comingSoon: true }] }), { providers: [{ id: "apple", enabled: false, comingSoon: true }] });
});

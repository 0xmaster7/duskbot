import type { IncomingMessage, ServerResponse } from "node:http";
import type { Cart } from "../../../shared/billing-api.ts";
import type { StoredCloud } from "../clouds/types.ts";
import { CloudError } from "../clouds/service.ts";
import type { AccountRef } from "./types.ts";
import type { BillingContext } from "./index.ts";
import { BillingError } from "./service.ts";
import { body, cloudName, color, invalid, json, optionalText, survey, text } from "./http.ts";

export function createAdminRoutes(ctx: BillingContext) {
  const { service, clouds, config, now } = ctx;
  const confirmations = new Map<string, { accountId: string; plan: string; subscriptionId: string; expiresAt: number }>();
  function available() { if (!ctx.enabled) throw new BillingError(503, "unavailable"); }
  function bundleCart(plan: unknown, interval: unknown): Cart {
    const bundle = config.bundles.find(b => b.id === plan && b.id !== "free");
    if (!bundle || (interval !== "month" && interval !== "year")) invalid();
    const cart: Cart = structuredClone({ ...bundle.cart, interval });
    if (cart.desktop.kind !== "none") cart.desktop.region = config.defaultRegion;
    return cart;
  }
  function publicConfig() {
    const catalog = service.catalog();
    return { cloudContractVersion: 1, plans: catalog.bundles.filter(b => b.id !== "free").map(bundle => {
      const kind = bundle.cart.desktop.kind;
      if (kind === "none") throw new Error("Bundle desktop missing.");
      const desktop = config.desktops[kind], spec = bundle.cart.desktop.spec ?? desktop.machine;
      return { tier: bundle.id, label: bundle.label, price: { currency: "USD", interval: "month", amount: bundle.monthlyCents },
        allowances: { cpus: spec.vcpu, memoryMb: spec.ramGb * 1024, diskGb: spec.diskGb, maxDiskGb: kind === "dedicated" ? config.dedicated.diskGb.max : spec.diskGb,
          computers: desktop.botComputers ?? 0, ...config.appAllowances[kind] } };
    }) };
  }
  function openCheckout(account: AccountRef) { return ctx.store.state.checkouts.find(c => c.accountId === account.id && c.kind === "cart" && c.status === "open" && c.openUntil > now()); }
  function primary(account: AccountRef) {
    const list = clouds.list(account.id), id = service.appState(account).primary?.cloudId;
    return list.find(c => c.id === id) ?? list.find(c => c.primary) ?? null;
  }
  function requireCloud(account: AccountRef, id?: string): StoredCloud {
    const cloud = id === undefined ? primary(account) : clouds.owned(account.id, id);
    if (!cloud) throw new BillingError(404, "not_found"); return cloud;
  }
  function subscription(account: AccountRef) {
    const sub = service.subscriptions(account.id).find(s => s.cart.license.kind !== "none" && s.status !== "ended" && s.status !== "pending");
    if (!sub) throw new BillingError(409, "not_subscribed"); return sub;
  }
  function cloudEntry(account: AccountRef, c: StoredCloud) {
    const view = clouds.view(c), sub = service.subscriptions(account.id).find(s => s.id === c.subscriptionId);
    const isPrimary = primary(account)?.id === c.id;
    const ended = ["destroyed", "destroying", "error"].includes(view.status) || sub?.status === "ended";
    const status = ended ? "ended" : view.status === "provisioning" ? "setting_up" : view.status === "running" ? "ready" : ["sleeping", "suspended"].includes(view.status) ? "stopped" : view.status;
    const tier = sub?.bundle ?? config.bundles.find(b => b.cart.desktop.kind === c.kind)?.id ?? "custom";
    const runs = sub && sub.status !== "ended" && sub.status !== "pending" && sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now();
    return { id: c.id, name: c.name, color: c.color, role: "owner", tier, runsOn: "cloud", status, origin: c.origin, teamId: null, primary: isPrimary, managed: true,
      ...(status === "setting_up" ? { setup: { step: c.setupStep ?? "reserving", progress: ({ reserving: 0.15, storage: 0.4, starting: 0.65, checking: 0.9 })[c.setupStep ?? "reserving"] } } : {}),
      ...(view.lastReportAt === null ? {} : { lastSeenAt: view.lastReportAt }),
      ...(["stopped", "ended"].includes(status) && c.destroyAt !== null ? { deleteAfter: c.destroyAt } : {}),
      removable: status === "ended" || status === "checkout",
      ...(isPrimary && runs ? { renewal: { trial: false, endsAt: sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null, keptDays: config.graceDays } } : {}),
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false, renewsAt: sub?.currentPeriodEnd ?? null };
  }
  function sessionFields(account: AccountRef): Record<string, unknown> {
    available();
    const state = service.appState(account), c = primary(account), list = clouds.list(account.id);
    const active = state.entitlement.status === "active";
    const open = openCheckout(account), blocked = open ? "checkout_open" : clouds.list(account.id, true).filter(c => c.status !== "destroyed").length >= config.maxCloudsPerAccount ? "cap" : null;
    let summary: Record<string, unknown> | undefined;
    if (c && c.status !== "checkout") {
      const view = clouds.view(c);
      const state = view.status === "provisioning" ? "setting_up" : view.status === "running" ? "ready" : view.status === "payment_problem" ? "payment_problem" : view.status === "error" ? "failed" : "stopped";
      summary = { state, ...(state === "ready" ? { origin: c.origin } : {}), ...(state === "setting_up" ? { setup: { step: c.setupStep ?? "reserving" } } : {}),
        disk: { gb: c.spec.diskGb, maxGb: c.placement === "dedicated" ? config.dedicated.diskGb.max : c.spec.diskGb } };
    }
    const openPlan = open?.cart ? service.quote(open.cart).bundle : null;
    return { entitlement: active ? state.entitlement : { plan: "free", status: "inactive", expiresAt: null, version: state.entitlement.version },
      ...(summary ? { cloud: summary } : {}), clouds: list.map(c => cloudEntry(account, c)).sort((a, b) => Number(b.primary) - Number(a.primary)), canAdd: !blocked, ...(blocked ? { addBlocked: blocked } : {}),
      ...(!active ? { offer: { plans: publicConfig().plans, recommended: "pro", ...(open && openPlan ? { checkout: { plan: openPlan, openUntil: open.openUntil } } : {}) } } : {}), license: service.licenseCheck(account) };
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname, method = req.method ?? "GET";
    if (path === "/api/public/config" && method === "GET") { json(res, 200, publicConfig()); return true; }
    if (!path.startsWith("/api/cloud/desktop/")) return false;
    const route = path.slice("/api/cloud/desktop/".length);
    // identity, devices and the session belong to the accounts service
    if (!/^(?:license|checkout|clouds|clouds\/[^/]+(?:\/(?:hide|cancel|keep))?|feedback|upgrade|upgrade\/preview|pairing|wake|resize-now|moved-to)$/.test(route)) return false;
    try {
      const match = /^Bearer (omc_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "");
      const account = match ? await ctx.accounts.fromBearer(req) : null;
      if (!account) { json(res, 401, { error: "invalid_token" }); return true; }
      available();
      const send = (value: object) => { json(res, 200, { ...value, cloudContractVersion: 1 }); return true; };
      if (route === "license" && method === "GET") return send(service.licenseCheck(account));
      const cloudRoute = /^clouds\/([^/]+)(?:\/(hide|cancel|keep))?$/.exec(route);
      if (cloudRoute && (method === "POST" || method === "PATCH")) {
        const cloud = requireCloud(account, cloudRoute[1]), data = await body(req);
        if (!cloudRoute[2] && method === "PATCH") { clouds.rename(account.id, cloud.id, { color: color(data.color) }); return send({ ok: true }); }
        if (method === "POST" && cloudRoute[2] === "hide") {
          if (!cloudEntry(account, cloud).removable) throw new CloudError(409, "not_removable");
          clouds.hide(account.id, cloud.id); return send({ ok: true });
        }
        if (method === "POST" && ["cancel", "keep"].includes(cloudRoute[2])) {
          const sub = service.subscriptions(account.id).find(s => s.cloudId === cloud.id);
          if (!sub) throw new BillingError(409, "not_subscribed");
          if (cloudRoute[2] === "cancel") { await service.cancel(account, sub.id); return send({ cloud: cloudEntry(account, cloud) }); }
          await service.keep(account, sub.id); return send({ ok: true });
        }
        throw new BillingError(404, "not_found");
      }
      if (method !== "POST") throw new BillingError(404, "not_found");
      const data = await body(req);
      if (route === "checkout" || route === "clouds") {
        const add = route === "clouds", cart = bundleCart(add ? data.tier : data.plan, add ? data.interval : "month");
        const source = add ? optionalText(data.source) : text(data.source);
        if (add && service.licenseCheck(account).license?.status === "active") cart.license = { kind: "none" };
        if (!add && service.subscriptions(account.id).some(s => s.status !== "ended" && s.cart.license.kind !== "none")) throw new BillingError(409, "already_subscribed");
        const name = add ? cloudName(data.name) : undefined;
        const swatch = !add || data.color === undefined ? null : color(data.color);
        const answer = await service.checkout(account, { kind: "cart", cart, ...(name ? { name } : {}), ...(swatch ? { color: swatch } : {}) }, { source });
        return send(add ? { cloudId: answer.cloudId, checkoutUrl: answer.checkoutUrl } : { url: answer.checkoutUrl });
      }
      if (route === "feedback") {
        service.feedback(account, { cloudId: text(data.cloudId), survey: survey(data) }); return send({ ok: true });
      }
      if (route === "upgrade/preview" || route === "upgrade") {
        if (data.plan === "personal" || data.plan === "max") throw new BillingError(409, "plan_change_unavailable");
        if (data.plan !== "starter" && data.plan !== "pro") invalid();
        text(data.source);
        const sub = subscription(account), cart = bundleCart(data.plan, sub.cart.interval);
        if (route === "upgrade/preview") {
          const preview = service.previewChange(account, sub.id, cart);
          for (const [key, value] of confirmations) if (value.expiresAt <= now() || value.accountId === account.id) confirmations.delete(key);
          confirmations.set(preview.confirmation, { accountId: account.id, plan: data.plan, subscriptionId: sub.id, expiresAt: preview.expiresAt });
          return send({ tier: data.plan, from: sub.bundle ?? "custom", price: preview.quote.totalCents, chargeNow: preview.chargeNowCents, tax: 0, currency: "USD", trial: false,
            confirmation: preview.confirmation, expiresAt: preview.expiresAt, nextBillingAt: sub.currentPeriodEnd });
        }
        const token = text(data.confirmation), confirmation = confirmations.get(token);
        if (!confirmation || confirmation.accountId !== account.id || confirmation.subscriptionId !== sub.id || confirmation.plan !== data.plan || confirmation.expiresAt <= now()) throw new BillingError(409, "confirmation_required");
        confirmations.delete(token);
        const changed = await service.change(account, sub.id, token);
        return send({ status: changed.bundle === data.plan ? "upgraded" : "pending", tier: changed.bundle ?? "custom" });
      }
      if (route === "pairing") {
        const cloud = requireCloud(account, optionalText(data.cloudId));
        if (cloud.status !== "running" || !cloud.origin || cloud.suspended !== null) throw new CloudError(409, "not_running");
        return send(await clouds.pair(account.id, cloud.id));
      }
      if (route === "wake" || route === "resize-now") {
        const cloud = requireCloud(account);
        if (route === "wake") {
          if (["stopped", "sleeping"].includes(cloud.status)) await clouds.power(account.id, cloud.id, "on");
          return send({ state: cloud.status === "running" ? "awake" : "waking" });
        }
        await clouds.reconcile();
        return send({ state: Object.keys(cloud.spec).every(k => cloud.spec[k as keyof typeof cloud.spec] === cloud.desiredSpec[k as keyof typeof cloud.spec]) ? "current" : "restarting" });
      }
      if (route === "moved-to") {
        const origin = text(data.origin);
        try { const url = new URL(origin); if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password) invalid(); } catch { invalid(); }
        const cloud = clouds.list(account.id).find(c => c.origin === origin || c.destroyedOrigin === origin);
        return send({ state: !cloud ? "unknown" : cloud.status === "destroyed" ? "deleted" : ["destroying", "stopped", "error"].includes(cloud.status) ? "ended" : "live" });
      }
      throw new BillingError(404, "not_found");
    } catch (error) {
      const known = error instanceof BillingError || error instanceof CloudError, code = known ? error.code : "failed";
      const blocked = route === "clouds" ? code === "rate_limited" ? "rate" : ["checkout_open", "cap"].includes(code) ? code : null : null;
      json(res, known ? error.status : 500, { error: code, ...(blocked ? { addBlocked: blocked } : {}), ...(error instanceof BillingError && error.url ? { checkoutUrl: error.url } : {}) });
      return true;
    }
  }
  return { handle, sessionFields };
}

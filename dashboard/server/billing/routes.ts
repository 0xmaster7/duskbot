import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CheckoutItem } from "../../../shared/billing-api.ts";
import { AuthError } from "../auth/index.ts";
import { CloudError } from "../clouds/service.ts";
import type { BillingContext } from "./index.ts";
import { BillingError } from "./service.ts";
import { body, cartInput, cloudName, color, invalid, json, rawBody, survey, text } from "./http.ts";

/** the operator's funnel read: a bearer token from OMB_OPS_TOKEN, compared in constant time */
function opsAllowed(header: string | undefined, token: string) {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
const messages: Record<string, string> = { signed_out: "Sign in to continue.", invalid_request: "Invalid request.", not_found: "Not found.", unavailable: "Billing is unavailable.", bad_signature: "Invalid webhook signature.", checkout_open: "A checkout is already open.", csrf: "Refresh the page and try again.", cap: "Cloud limit reached.", rate_limited: "Try again later." };
export function createBillingRoutes(ctx: BillingContext) {
  const { service, clouds } = ctx;
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname, method = req.method ?? "GET";
    if (!path.startsWith("/v1/billing/") && path !== "/v1/clouds" && !path.startsWith("/v1/clouds/")) return false;
    if (path === "/v1/billing/fake/complete" && (!ctx.fake || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? ""))) return false;
    const webhook = path === "/v1/billing/webhooks/dodo" && method === "POST";
    try {
      if (path === "/v1/billing/catalog" && method === "GET") {
        const wake = ctx.wakeStats();
        json(res, 200, { ...service.catalog(), ...(Object.keys(wake).length ? { wake } : {}) }); return true;
      }
      if (path === "/v1/billing/quote" && method === "POST") { json(res, 200, service.quote(cartInput((await body(req)).cart))); return true; }
      if (path === "/v1/billing/ops/funnel" && method === "GET") {
        if (!ctx.opsToken || !opsAllowed(req.headers.authorization, ctx.opsToken)) throw new BillingError(404, "not_found");
        const days = Number(url.searchParams.get("days") ?? "30");
        if (!Number.isInteger(days) || days < 1 || days > 365) invalid();
        json(res, 200, service.funnel(ctx.now() - days * 86_400_000, ctx.now())); return true;
      }
      if (!ctx.enabled) throw new BillingError(503, "unavailable");
      if (webhook) {
        service.handleWebhook(req.headers, await rawBody(req, 64 * 1024));
        json(res, 200, { ok: true }); return true;
      }
      const account = await ctx.accounts.fromCookie(req);
      if (!account) throw new BillingError(401, "signed_out");
      const send = (data: unknown) => { json(res, 200, data); return true; };
      if (method === "GET") {
        if (path === "/v1/billing/overview") return send(service.overview(account));
        if (path === "/v1/billing/invoices") return send(service.invoices(account.id, url.searchParams.get("cursor")));
        if (path === "/v1/billing/credits") return send(service.credits(account.id));
        if (path === "/v1/billing/license") return send(service.licenseCheck(account));
        if (path === "/v1/clouds") return send({ clouds: clouds.list(account.id).map(clouds.view) });
        const invoice = /^\/v1\/billing\/invoices\/([^/]+)\/download$/.exec(path);
        if (invoice) {
          const result = await service.invoiceDownload(account.id, invoice[1]);
          if (result.redirect) { res.writeHead(302, { location: result.redirect, "cache-control": "no-store" }); res.end(); }
          else { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="invoice.pdf"`, "cache-control": "no-store" }); res.end(result.pdf!.body); }
          return true;
        }
      }
      if (method === "POST") {
        if (path === "/v1/billing/checkout") {
          const data = await body(req); let item: CheckoutItem;
          if (data.kind === "cart") {
            const parsed = service.quote(cartInput(data.cart)).cart;
            const name = data.name === undefined ? undefined : cloudName(data.name), swatch = data.color === undefined ? undefined : color(data.color);
            if (swatch === null) invalid();
            item = { kind: "cart", cart: parsed, ...(name === undefined ? {} : { name }), ...(swatch === undefined ? {} : { color: swatch }) };
          } else if (data.kind === "credits") item = { kind: "credits", pack: text(data.pack) };
          else return invalid();
          return send(await service.checkout(account, item, { source: data.source }));
        }
        if (path === "/v1/billing/portal") { await body(req); return send(await service.portal(account)); }
        if (path === "/v1/billing/fake/complete" && ctx.fake) {
          const data = await body(req), id = text(data.checkoutId);
          const checkout = ctx.store.state.checkouts.find(c => c.id === id && c.accountId === account.id);
          if (!checkout?.providerSessionId) throw new BillingError(404, "not_found");
          const deliveries = ctx.fake.complete(checkout.providerSessionId);
          for (const delivery of deliveries) service.handleWebhook(delivery.headers, delivery.body);
          void clouds.reconcile().catch(() => {});
          return send({ ok: true, deliveries: deliveries.length });
        }
      }
      const subscription = /^\/v1\/billing\/subscriptions\/([^/]+)\/(preview|change|cancel|keep)$/.exec(path);
      if (subscription && method === "POST") {
        if (!service.subscriptions(account.id).some(sub => sub.id === subscription[1])) throw new BillingError(404, "not_found");
        const data = await body(req), id = subscription[1];
        if (subscription[2] === "preview") return send(service.previewChange(account, id, cartInput(data.cart)));
        if (subscription[2] === "change") return send({ subscription: await service.change(account, id, text(data.confirmation)) });
        if (subscription[2] === "cancel") return send({ subscription: await service.cancel(account, id, data.survey === undefined ? undefined : survey(data.survey)) });
        return send({ subscription: await service.keep(account, id) });
      }
      const member = /^\/v1\/billing\/licenses\/([^/]+)\/members(?:\/([^/]+))?$/.exec(path);
      if (member && ((method === "POST" && !member[2]) || (method === "DELETE" && member[2]))) {
        if (!ctx.store.state.licenses.some(l => l.id === member[1] && l.ownerAccountId === account.id)) throw new BillingError(404, "not_found");
        if (method === "POST") return send({ license: service.addMember(account, member[1], text((await body(req)).email)) });
        await body(req);
        let email: string; try { email = decodeURIComponent(member[2]); } catch { return invalid(); }
        return send({ license: service.removeMember(account, member[1], email) });
      }
      const cloudMatch = /^\/v1\/clouds\/([^/]+)(\/power)?$/.exec(path);
      if (cloudMatch) {
        const cloud = clouds.owned(account.id, cloudMatch[1]);
        if (!cloud) throw new BillingError(404, "not_found");
        if (!cloudMatch[2] && method === "GET") return send({ cloud: clouds.view(cloud) });
        if (!cloudMatch[2] && method === "PATCH") {
          const data = await body(req);
          return send({ cloud: clouds.view(clouds.rename(account.id, cloud.id, { ...(data.name === undefined ? {} : { name: text(data.name) }), ...(data.color === undefined ? {} : { color: color(data.color) }) })) });
        }
        if (cloudMatch[2] && method === "POST") {
          const data = await body(req); if (data.action !== "on" && data.action !== "off") invalid();
          return send({ cloud: clouds.view(await clouds.power(account.id, cloud.id, data.action)) });
        }
      }
      throw new BillingError(404, "not_found");
    } catch (error) {
      const known = error instanceof BillingError || error instanceof CloudError || error instanceof AuthError;
      const code = known ? error.code : "failed";
      const status = webhook ? code === "bad_signature" ? 401 : known && error.status === 400 ? 400 : 500 : known ? error.status : 500;
      json(res, status, { error: messages[code] ?? "Request failed.", code, ...(error instanceof BillingError && error.url ? { checkoutUrl: error.url } : {}) });
      return true;
    }
  };
}

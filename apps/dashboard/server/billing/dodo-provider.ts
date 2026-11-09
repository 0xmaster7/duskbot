import { BillingProviderError } from "./types.ts";
import type { BillingProvider } from "./types.ts";
import { verifyWebhook } from "./webhook-signature.ts";

export interface DodoProviderOptions {
  apiKey: string; webhookSecret: string; mode: "test" | "live"; fetch?: typeof fetch; now?: () => number;
  /** loopback http only, for isolated provider fixtures */
  baseUrl?: string;
}
export function createDodoProvider(options: DodoProviderOptions): BillingProvider {
  const base = options.baseUrl ?? `https://${options.mode}.dodopayments.com`;
  if (options.baseUrl) {
    const url = new URL(base);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new BillingProviderError("refused");
  }
  const requestFetch = options.fetch ?? fetch, now = options.now ?? Date.now;
  async function request(path: string, method: string, body?: unknown, pdf = false): Promise<{ contentType: string; body: Buffer } | null> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await requestFetch(`${base.replace(/\/$/, "")}${path}`, { method, redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: pdf ? "application/pdf" : "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (pdf && response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw new BillingProviderError(response.status >= 500 ? "unavailable" : "refused"); }
      const cap = pdf ? 5 * 1024 * 1024 : 256 * 1024;
      if (Number(response.headers.get("content-length")) > cap) { await response.body?.cancel(); throw new BillingProviderError("refused"); }
      const chunks: Uint8Array[] = []; let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length;
            if (size > cap) { await reader.cancel(); throw new BillingProviderError("refused"); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";
      if (pdf && contentType !== "application/pdf") throw new BillingProviderError("refused");
      return { contentType, body: Buffer.concat(chunks) };
    } catch (error) { if (error instanceof BillingProviderError) throw error; throw new BillingProviderError("unavailable"); }
    finally { clearTimeout(timer); }
  }
  async function json(path: string, body?: unknown) {
    const result = await request(path, "POST", body);
    try {
      const data: unknown = JSON.parse(result!.body.toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      return data as Record<string, unknown>;
    } catch { throw new BillingProviderError("refused"); }
  }
  function allowedUrl(value: unknown, host: string) {
    try {
      if (typeof value !== "string") throw new Error();
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password) throw new Error();
      return url.href;
    } catch { throw new BillingProviderError("refused"); }
  }
  const prefix = options.mode === "test" ? "test." : "";
  return {
    name: "dodo",
    async createCheckout(input) {
      const result = await json("/checkouts", { product_cart: input.cart.map(line => ({ product_id: line.productId, quantity: line.quantity,
        ...(line.addons.length ? { addons: line.addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })) } : {}) })),
        customer: input.customerId ? { customer_id: input.customerId } : { email: input.email }, return_url: input.returnUrl, metadata: { checkoutId: input.checkoutId, accountId: input.accountId } });
      if (typeof result.session_id !== "string" || !result.session_id) throw new BillingProviderError("refused");
      return { sessionId: result.session_id, url: allowedUrl(result.checkout_url, `${prefix}checkout.dodopayments.com`) };
    },
    async portal(customerId, returnUrl) {
      const result = await json(`/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`);
      return { url: allowedUrl(result.link, `${prefix}customer.dodopayments.com`) };
    },
    verifyWebhook: (headers, body) => verifyWebhook(options.webhookSecret, headers, body, now()),
    async cancelAtPeriodEnd(id, cancel) { await request(`/subscriptions/${encodeURIComponent(id)}`, "PATCH", { cancel_at_next_billing_date: cancel }); },
    async changePlan(input) { await request(`/subscriptions/${encodeURIComponent(input.subscriptionId)}/change-plan`, "POST", { product_id: input.productId, quantity: 1, proration_billing_mode: "difference_immediately", on_payment_failure: "prevent_change", addons: input.addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })) }); },
    async invoiceUrl() { return null; },
    invoicePdf: id => request(`/invoices/payments/${encodeURIComponent(id)}`, "GET", undefined, true),
  };
}

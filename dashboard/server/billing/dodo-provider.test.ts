import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createDodoProvider } from "./dodo-provider.ts";

let server: Server, baseUrl: string;
let requests: Array<{ method: string; url: string; auth: string | undefined; body: unknown }>;
let reply: unknown, status: number, contentType: string;
const apiKey = "fixture-private-key";
beforeEach(async () => {
  requests = []; reply = {}; status = 200; contentType = "application/json";
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    res.writeHead(status, { "content-type": contentType }); res.end(Buffer.isBuffer(reply) ? reply : JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture failed.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
const provider = () => createDodoProvider({ apiKey, webhookSecret: "whsec_Zml4dHVyZQ==", mode: "test", baseUrl });
const input = { checkoutId: "chk_1", accountId: "a1", email: "owner@example.com", customerId: null, cart: [{ productId: "solo", quantity: 1, addons: [{ addonId: "desktop", quantity: 1 }] }], returnUrl: "https://dashboard.test/billing" };

describe("dodo HTTP provider fixture", () => {
  it("sends checkout auth, metadata and line items", async () => {
    reply = { session_id: "session", checkout_url: "https://test.checkout.dodopayments.com/session/session" };
    expect(await provider().createCheckout(input)).toEqual({ sessionId: "session", url: (reply as { checkout_url: string }).checkout_url });
    expect(requests[0]).toEqual({ method: "POST", url: "/checkouts", auth: `Bearer ${apiKey}`, body: { product_cart: [{ product_id: "solo", quantity: 1, addons: [{ addon_id: "desktop", quantity: 1 }] }], customer: { email: "owner@example.com" }, return_url: input.returnUrl, metadata: { checkoutId: "chk_1", accountId: "a1" } } });
    await provider().createCheckout({ ...input, customerId: "cus_1" });
    expect(requests[1].body).toMatchObject({ customer: { customer_id: "cus_1" } });
  });
  it("creates portal sessions, cancels, changes plans and streams private invoices", async () => {
    const p = provider(); reply = { link: "https://test.customer.dodopayments.com/session/1" };
    expect(await p.portal("cus/1", input.returnUrl)).toEqual({ url: (reply as { link: string }).link });
    expect(requests[0].url).toBe(`/customers/cus%2F1/customer-portal/session?return_url=${encodeURIComponent(input.returnUrl)}`);
    reply = {}; await p.cancelAtPeriodEnd("sub/1", true); await p.changePlan({ subscriptionId: "sub/1", productId: "new", addons: [{ addonId: "cpu", quantity: 8 }] });
    expect(requests[1]).toMatchObject({ method: "PATCH", url: "/subscriptions/sub%2F1", body: { cancel_at_next_billing_date: true } });
    expect(requests[2]).toMatchObject({ method: "POST", url: "/subscriptions/sub%2F1/change-plan", body: { product_id: "new", quantity: 1, proration_billing_mode: "prorated_immediately", addons: [{ addon_id: "cpu", quantity: 8 }] } });
    expect(await p.invoiceUrl("pay")).toBeNull(); contentType = "application/pdf"; reply = Buffer.from("%PDF-fixture");
    expect(await p.invoicePdf("pay/1")).toEqual({ contentType, body: reply }); expect(requests[3].url).toBe("/invoices/payments/pay%2F1");
    status = 404; expect(await p.invoicePdf("missing")).toBeNull();
  });
  it("refuses cross-mode, credential-bearing and unsafe checkout urls", async () => {
    for (const checkout_url of ["http://test.checkout.dodopayments.com/a", "https://checkout.dodopayments.com/a", "https://test.checkout.dodopayments.com.evil.test/a", "https://user@test.checkout.dodopayments.com/a", "https://test.checkout.dodopayments.com:444/a"]) {
      reply = { session_id: "s", checkout_url }; await expect(provider().createCheckout(input)).rejects.toMatchObject({ code: "refused" });
    }
  });
  it("bounds responses and never leaks credentials or response bodies", async () => {
    status = 500; reply = { error: `private ${apiKey}` };
    await expect(provider().createCheckout(input)).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    status = 200; reply = { value: "x".repeat(256 * 1024) };
    await expect(provider().createCheckout(input)).rejects.toMatchObject({ code: "refused" });
    contentType = "application/pdf"; reply = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(provider().invoicePdf("large")).rejects.toMatchObject({ code: "refused" });
  });
});

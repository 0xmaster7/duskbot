import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "./webhook-signature.ts";

const time = Date.UTC(2026, 10, 8), secret = `whsec_${Buffer.from("independent fixture secret").toString("base64")}`;
const body = JSON.stringify({ business_id: "business", timestamp: new Date(time).toISOString(), type: "payment.succeeded", data: { payment_id: "payment", total_amount: 1234, currency: "USD" } });
describe("standard webhook signatures", () => {
  it("matches an independently computed known answer and accepts every v1 position", () => {
    const delivery = signWebhook(secret, "event", body, time);
    const expected = createHmac("sha256", Buffer.from("independent fixture secret")).update(`event.${time / 1000}.${body}`).digest("base64");
    expect(delivery.headers["webhook-signature"]).toBe(`v1,${expected}`);
    for (const signature of [`v1,${expected}`, `v1,${Buffer.alloc(32).toString("base64")} v1,${expected} v2,no`, `v1,${expected} v1,${Buffer.alloc(32).toString("base64")}`]) {
      expect(verifyWebhook(secret, { ...delivery.headers, "webhook-signature": signature }, delivery.body, time)).toMatchObject({ id: "event", at: time, event: { kind: "payment", amountCents: 1234 } });
    }
  });
  it("refuses bad, stale, future and tampered deliveries", () => {
    const delivery = signWebhook(secret, "event", body, time);
    for (const [headers, raw, clock] of [[{ ...delivery.headers, "webhook-signature": "v1,bad" }, delivery.body, time], [delivery.headers, delivery.body, time + 301000], [delivery.headers, delivery.body, time - 301000], [delivery.headers, Buffer.from(`${body} `), time], [{ ...delivery.headers, "webhook-timestamp": [String(time / 1000)] }, delivery.body, time]] as const) {
      expect(() => verifyWebhook(secret, headers as Record<string, string | string[]>, raw, clock)).toThrow(expect.objectContaining({ code: "bad_signature" }));
    }
  });
  it("rejects malformed signed payloads and ignores unknown types", () => {
    for (const value of ["{", "null", JSON.stringify({ type: "payment.succeeded" }), body.replace("1234", "1.5")]) {
      const delivery = signWebhook(secret, "event", value, time);
      expect(() => verifyWebhook(secret, delivery.headers, delivery.body, time)).toThrow(expect.objectContaining({ code: "refused" }));
    }
    const delivery = signWebhook(secret, "event", body.replace("payment.succeeded", "customer.updated"), time);
    expect(verifyWebhook(secret, delivery.headers, delivery.body, time).event).toEqual({ kind: "ignored", type: "customer.updated" });
  });
});

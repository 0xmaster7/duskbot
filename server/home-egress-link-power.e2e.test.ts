// A real My Cloud home and the app's real egress link client: while the app lends its connection, and as it links again,
// the home's power report (what the Admin reads to sleep it) shows no work in flight and no use by the person.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { createWebSocketStream } from "ws";

import { createHomeEgressLink as createAppLink } from "../electron/home-egress-link.mjs";
import { createEgressEndpoint } from "../electron/vps-link-egress.mjs";
import { launchCloudSendFixture, type CloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

let fx: CloudSendFixture;
beforeAll(async () => { fx = await launchCloudSendFixture({ onePasswordToken: `ops_fake-${"a".repeat(24)}` }); }, hostTimeout(60_000));
afterAll(async () => { await fx?.close(); });

function lend() {
  return createAppLink({
    origin: () => fx.cloudBase, awake: () => true, cookie: async () => "unused", checkMs: 200,
    connect: async (url: string) => {
      const ws = new WebSocket(url, { headers: { ...fx.edge, authorization: `Bearer ${fx.owner}` } });
      await new Promise((open, fail) => {
        ws.once("open", open);
        ws.once("error", fail);
        ws.once("unexpected-response", (_req, res) => fail(Object.assign(new Error(`link ${res.statusCode}`), { status: res.statusCode })));
      });
      return { readable: createWebSocketStream(ws), close: () => ws.close() };
    },
    endpoint: (tunnel) => createEgressEndpoint({ ...tunnel, dialer: { open: async () => ({ failed: "unreachable" }) } }),
  });
}
const power = async () => {
  const answer = await fx.signed("GET", "/api/cloud/power");
  expect(answer.status).toBe(200);
  return answer.body as { busy: string[]; lastActivityAt: number | null };
};

describe("the app lending its connection to a sleeping-plan My Cloud", () => {
  it("is neither work in flight nor someone using the home, linked, relinked or gone", async () => {
    const before = await power();
    for (let round = 0; round < 3; round++) {
      const app = lend();
      app.check();
      await expect.poll(() => app.linked(), { timeout: 10_000 }).toBe(true);
      await new Promise((settle) => setTimeout(settle, 300));
      const linked = await power();
      expect(linked.busy).not.toContain("maintenance");
      expect(linked.lastActivityAt).toBe(before.lastActivityAt);
      app.close();
    }
    await new Promise((settle) => setTimeout(settle, 300));
    expect((await power()).busy).not.toContain("maintenance");
  }, hostTimeout(60_000));
});

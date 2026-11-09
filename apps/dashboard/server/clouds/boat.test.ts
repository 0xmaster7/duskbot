import { afterEach, expect, it } from "vitest";
import { boatScope, boatSize, createBoatProvider, BoatError } from "./boat.ts";
import { startFakeBoatApi, type FakeBoatApi } from "./fake-boat-api.ts";
import { RetryableCloudError } from "./http.ts";

const apis: FakeBoatApi[] = [];
afterEach(async () => { for (const api of apis.splice(0)) await api.close(); });
const CLOUD = `c${"a".repeat(24)}`, SCOPE = "0123456789abcdef";
async function fixture() {
  const api = await startFakeBoatApi(); apis.push(api);
  return { api, provider: createBoatProvider({ apiKey: api.key, baseUrl: api.baseUrl, scope: SCOPE }) };
}
const input = { cloudId: CLOUD, spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, region: "eu", userData: "#!/bin/bash\ntrue\n", ttlSeconds: 7200 };

it("maps plan machines to the smallest Boat size that fits", () => {
  expect(boatSize({ vcpu: 2, ramGb: 4, diskGb: 40 })).toBe("small");
  expect(boatSize({ vcpu: 4, ramGb: 8, diskGb: 80 })).toBe("default");
  expect(boatSize({ vcpu: 8, ramGb: 16, diskGb: 160 })).toBe("large");
  expect(boatSize({ vcpu: 2, ramGb: 4, diskGb: 40 }, "default")).toBe("default");
  expect(() => boatSize({ vcpu: 64, ramGb: 512, diskGb: 40 })).toThrow("unavailable");
  expect(boatScope("https://dash.example.test/x")).toBe(boatScope("https://dash.example.test"));
  expect(boatScope("https://a.example.test")).not.toBe(boatScope("https://b.example.test"));
});

it("creates one labelled no-env sandbox per cloud and attempt, even when the answer is retried", async () => {
  const { api, provider } = await fixture();
  const first = await provider.create(input), again = await provider.create(input);
  expect(again.id).toBe(first.id);
  expect(api.sandboxes.size).toBe(1);
  expect(first.origin).toMatch(/^https:\/\/[a-z0-9]+-8080\.on\.boat\.dev$/);
  const body = api.requests.find(r => r.method === "POST" && r.path === "/sandboxes")!.body as Record<string, any>;
  expect(body).toMatchObject({ type: "small", ttlSeconds: 7200, noEnv: true, monitoring: false, labels: { "omb.cloud": CLOUD, "omb.scope": SCOPE }, hostedPorts: [{ port: 8080, public: true }] });
  const recovery = await provider.create({ ...input, attempt: 1 });
  expect(recovery.id).not.toBe(first.id);
  expect((await provider.find(CLOUD))?.id).toBe(recovery.id);
});

it("pauses and resumes, and reports a stopping sandbox as stopping", async () => {
  const { api, provider } = await fixture();
  const server = await provider.create(input);
  expect((await provider.status(server.id)).state).toBe("running");
  await provider.power(server.id, "off");
  expect(api.sandboxes.get(server.id)!.state).toBe("archiving");
  expect((await provider.status(server.id)).state).toBe("off");
  await provider.power(server.id, "on");
  expect((await provider.status(server.id)).state).toBe("running");
  api.expire(server.id); await provider.power(server.id, "off"); await provider.status(server.id);
  expect((await provider.status(server.id)).state).toBe("error");
  api.lose(server.id);
  expect((await provider.status(server.id)).state).toBe("missing");
});

it("never deletes through destroy, and deletes only with Boat's confirm header and a receipt", async () => {
  const { api, provider } = await fixture();
  const server = await provider.create(input);
  await expect(provider.destroy(server.id)).rejects.toThrow("retention reconciler");
  expect(api.deletes()).toHaveLength(0);
  const answer = await provider.requestDelete(server.id);
  expect(answer.operationId).toMatch(/^bdop_[a-f0-9]{32}$/);
  expect((await provider.deletion(answer.operationId!))?.status).toBe("completed");
  expect(await provider.sandbox(server.id)).toBeNull();
});

it("sees only its own deployment's sandboxes and keeps the API key out of every error", async () => {
  const { api, provider } = await fixture();
  await provider.create(input);
  const other = createBoatProvider({ apiKey: api.key, baseUrl: api.baseUrl, scope: "fedcba9876543210" });
  await other.create({ ...input, cloudId: `c${"b".repeat(24)}` });
  expect((await provider.inventory()).map(s => s.cloudId)).toEqual([CLOUD]);
  const wrong = createBoatProvider({ apiKey: "boat_wrong_key_9999", baseUrl: api.baseUrl, scope: SCOPE });
  const failure = await wrong.create(input).then(() => new Error("created"), (error: Error) => error);
  expect(failure).toBeInstanceOf(BoatError);
  expect(String(failure.message)).not.toContain("boat_wrong_key_9999");
  api.failNext(1);
  await expect(provider.status("bx_23456789")).rejects.toBeInstanceOf(RetryableCloudError);
  expect(() => createBoatProvider({ apiKey: api.key, baseUrl: "http://boat.example.test", scope: SCOPE })).toThrow("BOAT_BASE_URL");
});

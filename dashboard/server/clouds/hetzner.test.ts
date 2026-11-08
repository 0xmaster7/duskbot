import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createHetznerProvider } from "./hetzner.ts";

const active: HttpServer[] = [];
afterEach(async () => { for (const server of active.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
const cloudId = `c${"a".repeat(24)}`, token = "synthetic-test-token";
async function fixture() {
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body: Record<string, unknown>; authorization: string | undefined }> = [];
  let exists = false, status = "initializing", failure = 0, volume = false, attached = false;
  const machine = () => ({ id: 42, name: cloudId, labels: { omb_cloud: cloudId }, status, public_net: { ipv4: { ip: "203.0.113.42" } }, server_type: { name: "cx23", disk: 40 }, datacenter: { location: { name: "fsn1" } } });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}, url = new URL(req.url!, "http://127.0.0.1");
    calls.push({ method: req.method!, path: url.pathname, query: url.searchParams, body, authorization: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    if (failure) { res.statusCode = failure; res.end(JSON.stringify({ error: { code: "rate_limit_exceeded", message: token } })); failure = 0; return; }
    let answer: unknown = {};
    if (url.pathname === "/servers" && req.method === "GET") answer = { servers: exists ? [machine()] : [] };
    else if (url.pathname === "/servers" && req.method === "POST") { exists = true; attached = volume; answer = { server: machine() }; }
    else if (url.pathname === "/servers/42" && req.method === "GET") { if (!exists) res.statusCode = 404; else answer = { server: machine() }; }
    else if (url.pathname === "/servers/42" && req.method === "DELETE") { exists = false; attached = false; }
    else if (url.pathname === "/volumes" && req.method === "GET") answer = { volumes: volume ? [{ id: 7, size: 60, server: attached ? 42 : null }] : [] };
    else if (url.pathname === "/volumes" && req.method === "POST") { volume = true; answer = { volume: { id: 7, size: body.size, server: null } }; }
    else if (url.pathname === "/volumes/7" && req.method === "DELETE") volume = false;
    else if (url.pathname === "/volumes/7/actions/attach") attached = true;
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); active.push(server);
  const address = server.address() as { port: number };
  return { calls, provider: createHetznerProvider({ token, baseUrl: `http://127.0.0.1:${address.port}` }), status: (value: string) => { status = value; }, failure: (value: number) => { failure = value; } };
}
it("creates the documented server body, looks up by label, powers, resizes while off and deletes idempotently", async () => {
  const f = await fixture(), provider = f.provider;
  expect(await provider.find(cloudId)).toBeNull();
  const input = { cloudId, region: "fsn1", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, userData: "synthetic user data" };
  const server = await provider.create(input);
  expect(server.state).toBe("creating");
  expect(f.calls.find(c => c.method === "POST" && c.path === "/servers")?.body).toEqual({ name: cloudId, server_type: "cx23", image: "ubuntu-24.04", location: "fsn1", user_data: input.userData, labels: { omb_cloud: cloudId }, start_after_create: true, public_net: { enable_ipv4: true, enable_ipv6: true } });
  expect(f.calls[0].query.get("label_selector")).toBe(`omb_cloud==${cloudId}`);
  expect((await provider.find(cloudId))?.id).toBe("42");
  expect((await provider.create(input)).id).toBe("42"); expect(f.calls.filter(c => c.method === "POST" && c.path === "/servers")).toHaveLength(1);
  await expect(provider.resize("42", { vcpu: 4, ramGb: 8, diskGb: 40 })).rejects.toThrow("must be off");
  f.status("off"); await provider.resize("42", { vcpu: 4, ramGb: 8, diskGb: 40 });
  expect(f.calls.find(c => c.path.endsWith("change_type"))?.body).toEqual({ server_type: "cx33", upgrade_disk: false });
  await provider.power("42", "on"); await provider.power("42", "off");
  expect(f.calls.some(c => c.path.endsWith("poweron"))).toBe(true); expect(f.calls.some(c => c.path.endsWith("shutdown"))).toBe(true);
  await provider.destroy("42"); await provider.destroy("42"); expect((await provider.status("42")).state).toBe("missing");
  expect(f.calls.every(c => c.authorization === `Bearer ${token}`)).toBe(true);
});
it("maps every provider status and treats unknown ones as error", async () => {
  const f = await fixture(); await f.provider.create({ cloudId, region: "fsn1", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, userData: "" });
  for (const [input, output] of Object.entries({ initializing: "creating", starting: "starting", running: "running", stopping: "stopping", off: "off", deleting: "deleting", rebuilding: "error" })) { f.status(input); expect((await f.provider.status("42")).state).toBe(output); }
});
it("creates an additional disk first and cleans it up by label after the machine is gone", async () => {
  const f = await fixture();
  await f.provider.create({ cloudId, region: "fsn1", spec: { vcpu: 2, ramGb: 4, diskGb: 100 }, userData: "" });
  const volumeIndex = f.calls.findIndex(c => c.path === "/volumes" && c.method === "POST"), serverIndex = f.calls.findIndex(c => c.path === "/servers" && c.method === "POST");
  expect(volumeIndex).toBeLessThan(serverIndex);
  expect(f.calls[volumeIndex].body).toMatchObject({ size: 60, name: cloudId, location: "fsn1", labels: { omb_cloud: cloudId }, format: "ext4" });
  expect(f.calls[serverIndex].body).toMatchObject({ volumes: [7], automount: true });
  await f.provider.destroy("42");
  expect(f.calls.some(c => c.path === "/volumes/7" && c.method === "DELETE")).toBe(true);
});
it.each([429, 500, 503, 401])("sanitizes API failures (%s) and marks transient ones retryable", async status => {
  const f = await fixture(); f.failure(status);
  try { await f.provider.find(cloudId); expect.unreachable(); } catch (error) {
    expect(String(error)).not.toContain(token); expect(String(error)).not.toContain("message");
    if (status !== 401) expect(error).toMatchObject({ retryable: true }); else expect(String(error)).toContain("rate_limit_exceeded");
  }
});

it("grows an extra disk without upgrading the machine's root disk", async () => {
  const f = await fixture();
  await f.provider.create({ cloudId, region: "fsn1", spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, userData: "" });
  f.status("off");
  await f.provider.resize("42", { vcpu: 2, ramGb: 4, diskGb: 100 });
  expect(f.calls.find(c => c.path === "/volumes" && c.method === "POST")?.body).toMatchObject({ size: 60, labels: { omb_cloud: cloudId, omb_server: "42" } });
  expect(f.calls.find(c => c.path.endsWith("/actions/attach"))?.body).toEqual({ server: 42, automount: true });
  await f.provider.resize("42", { vcpu: 2, ramGb: 4, diskGb: 120 });
  expect(f.calls.find(c => c.path.endsWith("/actions/resize"))?.body).toEqual({ size: 80 });
  expect(f.calls.filter(c => c.path.endsWith("change_type")).every(c => c.body.upgrade_disk === false)).toBe(true);
});

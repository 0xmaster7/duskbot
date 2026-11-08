import { once } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startFakeSlack, type FakeSlack, type FakeSlackOptions, type FakeSlackManifest } from "./fake-slack.ts";

const fixtures: FakeSlack[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((fake) => fake.close())); });
async function fixture(options?: FakeSlackOptions) {
  const fake = await startFakeSlack(options);
  fixtures.push(fake);
  return fake;
}
const manifest: FakeSlackManifest = {
  features: { bot_user: { display_name: "Test Helper" } },
  oauth_config: { redirect_urls: ["http://127.0.0.1:3210/callback"], scopes: { bot: ["chat:write", "users:read"] } },
  settings: { socket_mode_enabled: true },
};
async function request(fake: FakeSlack, method: string, token: string | null, params: Record<string, string> = {}) {
  return fetch(`${fake.url}/api/${method}`, {
    method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: new URLSearchParams(params),
  });
}
async function call<T = unknown>(fake: FakeSlack, method: string, token: string | null, params: Record<string, string> = {}) {
  return await (await request(fake, method, token, params)).json() as T;
}
async function createApp(fake: FakeSlack, value = manifest): Promise<string> {
  const result = await call<{ ok: boolean; app_id: string }>(fake, "apps.manifest.create", fake.config.access, { manifest: JSON.stringify(value) });
  expect(result.ok).toBe(true);
  return result.app_id;
}
async function install(fake: FakeSlack, appId = "") {
  appId ||= await createApp(fake);
  const credentials = fake.apps.get(appId)!.credentials;
  const result = await call<{ ok: boolean; access_token: string; bot_user_id: string }>(fake, "oauth.v2.access", null, {
    ...credentials, code: fake.mintCode(appId), redirect_uri: manifest.oauth_config!.redirect_urls![0],
  });
  expect(result.ok).toBe(true);
  return { appId, token: result.access_token as string, userId: result.bot_user_id as string };
}
async function connect(fake: FakeSlack, appId: string) {
  const result = await call<{ url: string }>(fake, "apps.connections.open", fake.mintAppToken(appId));
  const ws = new WebSocket(result.url);
  const hello = once(ws, "message");
  await once(ws, "open");
  return { ws, hello: JSON.parse(String((await hello)[0])), url: result.url as string };
}
const nextFrame = async (ws: WebSocket) => JSON.parse(String((await once(ws, "message"))[0]));

describe("fake Slack", () => {
  it("rotates custom configuration tokens and rejects old pairs and expired access", async () => {
    const fake = await fixture({ configToken: "custom-access", refreshToken: "custom-refresh", configTtlSeconds: 60 });
    const oldAccess = fake.config.access, oldRefresh = fake.config.refresh;
    expect(await call(fake, "auth.test", oldAccess)).toMatchObject({ ok: true, team_id: "T0FAKE", user_id: "U0OWNER", team: "Fake Team" });
    const rotated = await call<{ exp: number; iat: number }>(fake, "tooling.tokens.rotate", null, { refresh_token: oldRefresh });
    expect(rotated).toMatchObject({ ok: true, token: fake.config.access, refresh_token: fake.config.refresh, team_id: "T0FAKE", user_id: "U0OWNER" });
    expect(rotated.exp - rotated.iat).toBe(60);
    expect(fake.config.rotations).toBe(1);
    expect(fake.config.access).toBe("xoxe.xoxp-1-fake-access-1");
    expect(await call(fake, "tooling.tokens.rotate", null, { refresh_token: oldRefresh })).toEqual({ ok: false, error: "invalid_refresh_token" });
    expect(await call(fake, "auth.test", oldAccess)).toEqual({ ok: false, error: "invalid_auth" });
    expect(await call(fake, "auth.test", fake.config.access)).toMatchObject({ ok: true });
    fake.expireConfigToken();
    expect(await call(fake, "auth.test", fake.config.access)).toEqual({ ok: false, error: "invalid_auth" });
    expect(await call(fake, "tooling.tokens.rotate", null, { refresh_token: fake.config.refresh })).toMatchObject({ ok: true });
    expect(fake.config.rotations).toBe(2);
  });

  it("creates, replaces and deletes manifests with config authentication", async () => {
    const fake = await fixture();
    expect(await call(fake, "apps.manifest.create", null)).toEqual({ ok: false, error: "not_authed" });
    expect(await call(fake, "apps.manifest.create", "wrong")).toEqual({ ok: false, error: "invalid_auth" });
    expect(await call(fake, "apps.manifest.create", fake.config.access, { manifest: "{" })).toEqual({ ok: false, error: "invalid_manifest" });
    const appId = await createApp(fake), app = fake.apps.get(appId)!;
    expect(appId).toBe("A0FAKE1");
    expect(app.credentials.client_id).toBe("1000.1");
    expect(app.credentials.client_secret).toMatch(/^fake-client-secret-1-[a-f0-9]{12}$/);
    expect(app.credentials.signing_secret).toMatch(/^fake-signing-secret-1-[a-f0-9]{12}$/);
    const replacement = { display_information: { name: "Changed" } };
    expect(await call(fake, "apps.manifest.update", fake.config.access, { app_id: appId, manifest: JSON.stringify(replacement) })).toMatchObject({ ok: true, app_id: appId });
    expect(app.manifest).toEqual(replacement);
    expect(await createApp(fake)).toBe("A0FAKE2");
    expect(await call(fake, "apps.manifest.delete", fake.config.access, { app_id: appId })).toEqual({ ok: true });
    expect(fake.apps.has(appId)).toBe(false);
    expect(await call(fake, "apps.manifest.delete", fake.config.access, { app_id: appId })).toEqual({ ok: false, error: "app_not_found" });
  });

  it("checks OAuth credentials, app binding, redirect and single-use codes without leaking errors", async () => {
    const fake = await fixture(), appId = await createApp(fake), otherId = await createApp(fake);
    const credentials = fake.apps.get(appId)!.credentials, code = fake.mintCode(appId);
    expect(code).toMatch(/^fake-code-\d+-[a-f0-9]{8}$/);
    const params = { ...credentials, code, redirect_uri: manifest.oauth_config!.redirect_urls![0] };
    const invalid = await call(fake, "oauth.v2.access", null, { ...params, client_secret: "wrong" });
    expect(invalid).toEqual({ ok: false, error: "invalid_client_id" });
    for (const secret of [code, credentials.client_secret, credentials.signing_secret]) expect(JSON.stringify(invalid)).not.toContain(secret);
    expect(await call(fake, "oauth.v2.access", null, { ...params, ...fake.apps.get(otherId)!.credentials })).toEqual({ ok: false, error: "invalid_code" });
    expect(await call(fake, "oauth.v2.access", null, { ...params, redirect_uri: "http://127.0.0.1:3210/wrong" })).toEqual({ ok: false, error: "bad_redirect_uri" });
    const result = await call<{ ok: boolean; access_token: string; bot_user_id: string }>(fake, "oauth.v2.access", null, params);
    expect(result).toMatchObject({ ok: true, token_type: "bot", scope: "chat:write,users:read", bot_user_id: "U0BOT1", app_id: appId, team: { id: "T0FAKE", name: "Fake Team" } });
    expect(result.access_token).toMatch(/^xoxb-fake-A0FAKE1-[a-f0-9]{16}$/);
    expect(await call(fake, "oauth.v2.access", null, params)).toEqual({ ok: false, error: "invalid_code" });
    expect(await call(fake, "users.info", result.access_token, { user: result.bot_user_id })).toMatchObject({ user: { name: "test-helper", is_bot: true, profile: { display_name: "Test Helper" } } });
    expect(await call(fake, "auth.test", result.access_token)).toMatchObject({ ok: true, user_id: "U0BOT1", app_id: appId, bot_id: "B0BOT1" });
    expect(await call(fake, "auth.revoke", result.access_token)).toEqual({ ok: true, revoked: true });
    expect(await call(fake, "auth.test", result.access_token)).toEqual({ ok: false, error: "invalid_auth" });
  });

  it("opens Socket Mode, uses single-use tickets, sends to the newest socket and times acks", async () => {
    const fake = await fixture(), appId = await createApp(fake);
    const pending = fake.socket.waitForConnection(appId);
    const first = await connect(fake, appId);
    await pending;
    expect(first.hello).toEqual({ type: "hello", num_connections: 1, debug_info: { host: "fake" }, connection_info: { app_id: appId } });
    await fake.socket.waitForConnection(appId);
    const reused = new WebSocket(first.url);
    const [error] = await once(reused, "error");
    expect(error.message).toContain("401");
    const two = fake.socket.waitForConnections(appId, 2);
    const second = await connect(fake, appId);
    await two;
    expect(second.hello.num_connections).toBe(2);
    expect(fake.socket.connections(appId)).toBe(2);
    const event = { type: "message", channel: "C0GENERAL", text: "hello" };
    const frame = nextFrame(second.ws);
    const envelopeId = fake.socket.event(appId, event, { retryAttempt: 2, envelopeId: "envelope-test", eventId: "event-test" });
    expect(envelopeId).toBe("envelope-test");
    expect(await frame).toMatchObject({ envelope_id: envelopeId, type: "events_api", retry_attempt: 2, accepts_response_payload: false,
      payload: { token: "fake", team_id: "T0FAKE", api_app_id: appId, event, type: "event_callback", event_id: "event-test" } });
    const ack = fake.socket.waitForAck(envelopeId);
    second.ws.send("malformed");
    second.ws.send(JSON.stringify({ envelope_id: "unknown" }));
    second.ws.send(JSON.stringify({ envelope_id: envelopeId }));
    const timing = await ack;
    expect(timing.ms).toBeGreaterThanOrEqual(0);
    expect(timing.ms).toBeLessThan(1000);
    expect(await fake.socket.waitForAck(envelopeId)).toEqual(timing);
    expect(fake.socket.acks).toHaveLength(1);
    expect(fake.socket.acks[0]).toMatchObject({ envelopeId, ms: timing.ms });
  });

  it("sends disconnect before closing and drops sockets without a frame", async () => {
    const fake = await fixture(), appId = await createApp(fake);
    const { ws } = await connect(fake, appId);
    const frame = nextFrame(ws), close = once(ws, "close");
    fake.socket.disconnect(appId, "refresh_requested");
    expect(await frame).toEqual({ type: "disconnect", reason: "refresh_requested" });
    expect(fake.socket.connections(appId)).toBe(1);
    await close;
    expect(fake.socket.connections(appId)).toBe(0);
    const replacement = await connect(fake, appId);
    const frames: string[] = [];
    replacement.ws.on("message", (data) => frames.push(String(data)));
    const dropped = once(replacement.ws, "close");
    fake.socket.drop(appId);
    await dropped;
    expect(fake.socket.connections(appId)).toBe(0);
    expect(frames).toEqual([]);
  });

  it("refuses revoked app tokens and disabled Socket Mode", async () => {
    const fake = await fixture(), appId = await createApp(fake), token = fake.mintAppToken(appId);
    expect(token).toMatch(/^xapp-1-A0FAKE1-fake-[a-f0-9]{24}$/);
    fake.revokeAppToken(token);
    expect(await call(fake, "apps.connections.open", token)).toEqual({ ok: false, error: "invalid_auth" });
    fake.apps.get(appId)!.manifest = { settings: { socket_mode_enabled: false } };
    expect(await call(fake, "apps.connections.open", fake.mintAppToken(appId))).toEqual({ ok: false, error: "invalid_auth" });
    await expect(fake.socket.waitForConnection(appId, 5)).rejects.toThrow("Fake Slack wait timed out");
    await expect(fake.socket.waitForAck("missing", 5)).rejects.toThrow("Fake Slack wait timed out");
  });

  it("posts increasing timestamps, waits for posts, and records updates", async () => {
    const fake = await fixture(), { appId, token } = await install(fake);
    const pending = fake.waitForPost((post) => post.text === "first");
    const first = await call<{ ts: string }>(fake, "chat.postMessage", token, { channel: "C0GENERAL", text: "first" });
    expect(first).toMatchObject({ ok: true, channel: "C0GENERAL", ts: "1700000100.000100", message: { text: "first", user: "U0BOT1", bot_id: "B0BOT1" } });
    expect(await pending).toEqual({ appId, channel: "C0GENERAL", text: "first", ts: first.ts });
    const second = await call<{ ts: string }>(fake, "chat.postMessage", token, { channel: "C0GENERAL", text: "reply", thread_ts: first.ts });
    expect(second.ts).toBe("1700000100.000200");
    expect(await fake.waitForPost((post) => post.ts === second.ts)).toMatchObject({ thread_ts: first.ts });
    await call(fake, "chat.update", token, { channel: "C0GENERAL", text: "edited", ts: first.ts });
    expect(fake.updated).toEqual([{ appId, channel: "C0GENERAL", text: "edited", ts: first.ts }]);
  });

  it("tracks reaction membership per app and waits for reactions", async () => {
    const fake = await fixture(), { token } = await install(fake);
    const params = { channel: "C0GENERAL", timestamp: "1.0", name: "eyes" };
    const pending = fake.waitForReaction((reaction) => reaction.op === "add");
    expect(await call(fake, "reactions.add", token, params)).toEqual({ ok: true });
    expect(await pending).toMatchObject({ op: "add", appId: "A0FAKE1", ...params });
    expect(await call(fake, "reactions.add", token, params)).toEqual({ ok: false, error: "already_reacted" });
    const other = await install(fake);
    expect(await call(fake, "reactions.add", other.token, params)).toEqual({ ok: true });
    expect(await call(fake, "reactions.remove", token, params)).toEqual({ ok: true });
    expect(await call(fake, "reactions.remove", token, params)).toEqual({ ok: false, error: "no_reaction" });
    expect(fake.reactions).toHaveLength(5);
  });

  it("authenticates downloads and records raw uploads without adding authorization", async () => {
    const fake = await fixture(), { appId, token } = await install(fake);
    const bytes = Buffer.from([0, 1, 255, 10]), file = fake.addFile({ name: "test file.bin", mime: "application/octet-stream", bytes });
    expect(file).toMatchObject({ size: 4, name: "test file.bin", mimetype: "application/octet-stream" });
    expect((await fetch(file.url_private)).status).toBe(403);
    expect((await fetch(file.url_private, { headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
    const response = await fetch(file.url_private_download, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.headers.get("content-type")).toBe(file.mimetype);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(fake.downloads).toEqual([{ fileId: file.id, token }]);
    const upload = await call<{ upload_url: string; file_id: string }>(fake, "files.getUploadURLExternal", token, { filename: "out.bin", length: "4" });
    expect((await fetch(upload.upload_url, { method: "POST", body: bytes })).status).toBe(200);
    expect(fake.uploads).toEqual([{ fileId: upload.file_id, filename: "out.bin", bytes, authorization: null }]);
    await fetch(upload.upload_url, { method: "POST", body: bytes, headers: { Authorization: "Bearer explicit" } });
    expect(fake.uploads[1].authorization).toBe("Bearer explicit");
    const files = [{ id: upload.file_id, title: "output" }];
    expect(await call(fake, "files.completeUploadExternal", token, { files: JSON.stringify(files), channel_id: "C0GENERAL", thread_ts: "1.0", initial_comment: "done" })).toEqual({ ok: true, files });
    expect(fake.completed).toEqual([{ appId, files, channel_id: "C0GENERAL", thread_ts: "1.0", initial_comment: "done" }]);
    await call(fake, "auth.revoke", token);
    expect((await fetch(file.url_private, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
  });

  it("parses multipart icons and records file metadata", async () => {
    const fake = await fixture(), appId = await createApp(fake), bytes = Buffer.from([137, 80, 78, 71]);
    const form = new FormData();
    form.set("app_id", appId);
    form.set("image", new Blob([bytes], { type: "image/png" }), "icon.png");
    const response = await fetch(`${fake.url}/api/apps.icon.set`, { method: "POST", headers: { Authorization: `Bearer ${fake.config.access}` }, body: form });
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.icons).toEqual([{ appId, bytes, mime: "image/png" }]);
    expect(fake.callsTo("apps.icon.set")[0]).toMatchObject({ token: fake.config.access, params: { app_id: appId }, files: [{ field: "image", name: "icon.png", type: "image/png", size: 4 }] });
  });

  it("injects a bounded number of failures and rate limits, and delays calls", async () => {
    const fake = await fixture();
    fake.fail("auth.test", "temporary_failure", 2);
    expect(await call(fake, "auth.test", fake.config.access)).toEqual({ ok: false, error: "temporary_failure" });
    expect(await call(fake, "auth.test", fake.config.access)).toEqual({ ok: false, error: "temporary_failure" });
    expect(await call(fake, "auth.test", fake.config.access)).toMatchObject({ ok: true });
    fake.rateLimit("auth.test", 3);
    const limited = await request(fake, "auth.test", fake.config.access);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
    expect(await limited.json()).toEqual({ ok: false, error: "ratelimited" });
    fake.delay("auth.test", 30);
    const start = performance.now();
    expect(await call(fake, "auth.test", fake.config.access)).toMatchObject({ ok: true });
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
    expect(fake.callsTo("auth.test")).toHaveLength(5);
    expect(fake.calls[0].at).toBeGreaterThan(0);
    expect(await call(fake, "missing.method", null)).toEqual({ ok: false, error: "unknown_method" });
    expect(await call(fake, "chat.postMessage", null)).toEqual({ ok: false, error: "not_authed" });
  });

  it("pages channels, looks up users, and serves sorted history and threads", async () => {
    const fake = await fixture(), { token } = await install(fake);
    fake.addChannel({ id: "C0EXTRA", name: "extra", is_private: false });
    const first = await call<{ channels: Array<{ id: string }>; response_metadata: { next_cursor: string } }>(fake, "conversations.list", token, { limit: "2" });
    expect(first.channels.map((channel: { id: string }) => channel.id)).toEqual(["C0GENERAL", "C0PRIVATE"]);
    expect(first.response_metadata.next_cursor).toBe("2");
    const second = await call<{ channels: Array<{ id: string }>; response_metadata: { next_cursor: string } }>(fake, "conversations.list", token, { limit: "2", cursor: first.response_metadata.next_cursor });
    expect(second.channels).toEqual([{ id: "C0EXTRA", name: "extra", is_private: false }]);
    expect(second.response_metadata.next_cursor).toBe("");
    expect(await call(fake, "conversations.info", token, { channel: "C0PRIVATE" })).toMatchObject({ channel: { name: "secret-room", is_private: true } });
    expect(await call(fake, "conversations.open", token, { users: "U0ALICE" })).toEqual({ ok: true, channel: { id: "D0ALICE" } });
    expect(await call(fake, "users.lookupByEmail", token, { email: "bob@example.test" })).toMatchObject({ user: { id: "U0BOB", real_name: "Bob Example" } });
    fake.addUser({ id: "U0NEW", name: "new" });
    expect(await call(fake, "users.info", token, { user: "U0NEW" })).toMatchObject({ user: { name: "new" } });
    expect(await call(fake, "users.info", token, { user: "missing" })).toEqual({ ok: false, error: "user_not_found" });
    expect(await call(fake, "users.lookupByEmail", token, { email: "missing" })).toEqual({ ok: false, error: "users_not_found" });
    fake.seedMessages("C0GENERAL", [{ ts: "3.0", text: "reply", thread_ts: "1.0" }, { ts: "1.0", text: "root" }, { ts: "2.0", text: "other" }]);
    expect(await call(fake, "conversations.history", token, { channel: "C0GENERAL", limit: "2" })).toMatchObject({ messages: [{ ts: "3.0" }, { ts: "2.0" }], has_more: true });
    expect(await call(fake, "conversations.replies", token, { channel: "C0GENERAL", ts: "1.0" })).toMatchObject({ messages: [{ ts: "1.0" }, { ts: "3.0" }], has_more: false });
  });

  it("accepts JSON parameters and cancels pending waits on close", async () => {
    const fake = await fixture(), { token } = await install(fake);
    const response = await fetch(`${fake.url}/api/chat.postMessage`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ channel: "C0GENERAL", text: "JSON", mrkdwn: true }) });
    expect(await response.json()).toMatchObject({ ok: true });
    expect(fake.callsTo("chat.postMessage")[0].params).toEqual({ channel: "C0GENERAL", text: "JSON", mrkdwn: "true" });
    const pending = expect(fake.waitForPost(() => false)).rejects.toThrow("Fake Slack closed");
    await fake.close();
    await pending;
    await fake.close();
  });

  it("stays self-contained, strip-types compatible and free of em dashes", () => {
    const source = readFileSync(new URL("./fake-slack.ts", import.meta.url), "utf8");
    const test = readFileSync(new URL("./fake-slack.test.ts", import.meta.url), "utf8");
    expect(source.startsWith("#!")).toBe(false);
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports.every((name) => name.startsWith("node:") || name === "ws")).toBe(true);
    expect(source.split("\n").length).toBeLessThan(700);
    expect(source + test).not.toContain(String.fromCharCode(0x2014));
  });
});

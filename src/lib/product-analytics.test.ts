// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_FEATURES as SERVER_FEATURES, cleanProps } from "../../apps/dashboard/server/analytics/events";

type Client = typeof import("./product-analytics");
type Payload = { install: string; session: string; platform: string; version: string; events: { name: string; at: number; props: Record<string, string | number> }[] };
let client: Client;
const fetcher = vi.fn<typeof fetch>();
const config = { origin: "https://accounts.example", token: null, platform: "darwin", version: "1.2.3", kind: "desktop", force: true } as const;
const watchWindow = () => vi.spyOn(window, "addEventListener");
const watchDocument = () => vi.spyOn(document, "addEventListener");
let windowEvents: ReturnType<typeof watchWindow>;
let documentEvents: ReturnType<typeof watchDocument>;
const bodies = (): Payload[] => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Payload);
const events = () => bodies().flatMap(body => body.events);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  fetcher.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  windowEvents = watchWindow();
  documentEvents = watchDocument();
  client = await import("./product-analytics");
});

afterEach(() => {
  for (const [name, handler, options] of windowEvents.mock.calls) window.removeEventListener(name, handler as EventListener, options);
  for (const [name, handler, options] of documentEvents.mock.calls) document.removeEventListener(name, handler as EventListener, options);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("product analytics", () => {
  it("persists a random install id and makes a fresh session for each launch", async () => {
    client.configure(config);
    await client.flush();
    const first = bodies()[0];
    expect(first.install).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.session).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(localStorage.getItem("dusk-install-id")).toBe(first.install);
    vi.resetModules();
    const next = await import("./product-analytics");
    next.configure(config);
    await next.flush();
    expect(bodies()[1].install).toBe(first.install);
    expect(bodies()[1].session).not.toBe(first.session);
  });

  it("replaces a malformed persisted install id", async () => {
    localStorage.setItem("dusk-install-id", "person@example.com");
    client.configure(config);
    await client.flush();
    expect(bodies()[0].install).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("queues before the origin is known and opens only once", async () => {
    client.configure({ ...config, origin: null });
    client.feature("bot_created");
    await client.flush();
    expect(fetcher).not.toHaveBeenCalled();
    client.configure(config);
    client.configure({ ...config, token: "omc_fixture" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events().map(event => event.name)).toEqual(["app_feature", "app_open"]);
  });

  it("sends batches of at most 50", async () => {
    client.configure(config);
    for (let i = 0; i < 121; ++i) client.feature("search_used");
    await client.flush();
    expect(bodies().map(body => body.events.length)).toEqual([50, 50, 22]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("drops the oldest events beyond the 200 event bound", async () => {
    client.configure({ ...config, origin: null });
    for (let i = 0; i < 205; ++i) client.error("test", `event_${i}`);
    client.configure(config);
    await client.flush();
    expect(events()).toHaveLength(200);
    expect(events()[0].props.code).toBe("event_6");
  });

  it("folds ids, removes query strings and dedupes consecutive folded screens", async () => {
    client.configure(config);
    for (const id of ["123", "a1b", "abcdefghijklmnopqrstuvwxyz", "ws_letters", "acct_letters", "bot_letters", "cface"]) client.screen(`/bots/${id}?q=private#private`);
    client.screen("/rooms/987");
    client.screen("/bots/456");
    client.screen("https://person.example/private");
    client.screen("//person.example/private");
    client.screen("/%invalid");
    client.screen("/calls");
    await client.flush();
    expect(events().filter(event => event.name === "app_screen").map(event => event.props.screen)).toEqual(["/bots/:id", "/rooms/:id", "/bots/:id", "/calls"]);
  });

  it("aggregates counts and rounds the median reply latency", async () => {
    client.configure(config);
    for (let i = 0; i < 5; ++i) client.messageSent();
    for (const ms of [901, 101, 301, 201]) client.replyReceived(ms);
    client.replyReceived(NaN);
    client.replyReceived(-1);
    await client.flush();
    expect(events().filter(event => event.name === "app_messages")).toEqual([{ name: "app_messages", at: Date.now(), props: { sent: 5, replies: 4, latencyMs: 251 } }]);
    await client.flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    client.replyReceived(12.7);
    await client.flush();
    expect(events().at(-1)?.props).toEqual({ sent: 0, replies: 1, latencyMs: 13 });
  });

  it("measures only matched messages and uses the first streamed reply once", async () => {
    client.configure(config);
    client.noteMessageSent("send-a");
    client.noteMessageSent("send-a");
    client.noteAcceptedMessage("send-a", "message-a");
    vi.setSystemTime(Date.now() + 120);
    client.noteReplyTurn("turn-a");
    vi.setSystemTime(Date.now() + 800);
    client.noteReplyTurn("turn-a", "message-a");
    client.noteReplyTurn("turn-a", "message-a");
    client.noteReplyTurn("unrelated", "another-message");
    await client.flush();
    expect(events().at(-1)?.props).toEqual({ sent: 1, replies: 1, latencyMs: 120 });
  });

  it("clears queued events and aggregates on opt-out and blocks further tracking", async () => {
    client.configure(config);
    client.messageSent();
    client.feature("bot_created");
    client.setUsageAnalytics(false);
    expect(localStorage.getItem("dusk-usage-analytics")).toBe("off");
    expect(client.usageAnalyticsEnabled()).toBe(false);
    client.feature("room_created");
    client.replyReceived(100);
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    expect(fetcher).not.toHaveBeenCalled();
    client.setUsageAnalytics(true);
    client.feature("search_used");
    await client.flush();
    expect(events().map(event => event.name)).toEqual(["app_feature"]);
  });

  it("honors persisted opt-out and disables tests unless forced", async () => {
    client.configure({ ...config, force: false });
    client.feature("bot_created");
    await client.flush();
    expect(fetcher).not.toHaveBeenCalled();
    localStorage.setItem("dusk-usage-analytics", "off");
    client.configure(config);
    await client.flush();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("adds a bearer header only while the configured token is set", async () => {
    client.configure(config);
    await client.flush();
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "content-type": "application/json" });
    client.configure({ ...config, token: "omc_fixture" });
    client.feature("search_used");
    await client.flush();
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ "content-type": "application/json", Authorization: "Bearer omc_fixture" });
    client.configure(config);
    client.feature("chat_opened");
    await client.flush();
    expect(fetcher.mock.calls[2][1]?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.stringify(bodies())).not.toContain("omc_fixture");
  });

  it("sends the keepalive contract on hidden and closes on pagehide", async () => {
    client.configure(config);
    vi.setSystemTime(Date.now() + 1234);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(fetcher.mock.calls[0][0]).toBe("https://accounts.example/v1/app/events");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", keepalive: true, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    expect(Object.keys(bodies()[0]).sort()).toEqual(["events", "install", "platform", "session", "version"]);
    expect(bodies()[0]).toMatchObject({ platform: "darwin", version: "1.2.3" });
    expect(events().filter(event => event.name === "app_close")).toEqual([{ name: "app_close", at: Date.now(), props: { ms: 1234 } }]);
    expect(events()[0]).toMatchObject({ name: "app_open", props: { kind: "desktop", platform: "darwin", appVersion: "1.2.3" } });
  });

  it("never throws when fetch rejects and retries only on the next flush", async () => {
    fetcher.mockRejectedValue(new Error("private network details"));
    client.configure(config);
    await expect(client.flush()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not restore an in-flight failed batch after opting out and back in", async () => {
    let reject!: (cause: Error) => void;
    fetcher.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    client.configure(config);
    const sending = client.flush();
    client.setUsageAnalytics(false);
    client.setUsageAnalytics(true);
    reject(new Error("offline"));
    await sending;
    await client.flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports window failures without their messages or stacks and drops extra props", async () => {
    client.configure(config);
    window.dispatchEvent(new ErrorEvent("error", { message: "private message", error: new Error("private stack") }));
    window.dispatchEvent(new Event("unhandledrejection"));
    client.track("app_feature", { feature: "file_uploaded", fileName: "secret.txt", email: "person@example.com", token: "private" });
    client.track("unknown", { text: "private prompt" });
    client.error("private message", "bad-code");
    client.feature("unknown" as "bot_created");
    await client.flush();
    expect(events().map(event => event.props)).toEqual([
      { kind: "desktop", platform: "darwin", appVersion: "1.2.3" },
      { kind: "window", code: "error" }, { kind: "window", code: "rejection" }, { feature: "file_uploaded" },
    ]);
    expect(JSON.stringify(bodies())).not.toMatch(/private|secret|person@example/);
  });

  it("counts observed routine runs once and ignores runs still queued or missed", async () => {
    client.configure(config);
    client.noteRoutineRun("run-a", "queued");
    client.noteRoutineRun("run-a", "running");
    client.noteRoutineRun("run-a", "completed");
    client.noteRoutineRun("run-b", "missed");
    await client.flush();
    expect(events().filter(event => event.name === "app_feature")).toHaveLength(1);
  });

  it("reports only final pairing failures with a coarse code", async () => {
    client.configure(config);
    await expect(client.observePairing(async () => "ok")).resolves.toBe("ok");
    const refused = { code: "expired", message: "private pairing code" };
    await expect(client.observePairing(async () => { throw refused; })).rejects.toBe(refused);
    await client.flush();
    expect(events().filter(event => event.name === "app_pair_failed")).toEqual([{ name: "app_pair_failed", at: Date.now(), props: { reason: "expired_code" } }]);
  });

  it("can track and opt out when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    client.configure(config);
    await expect(client.flush()).resolves.toBeUndefined();
    expect(bodies()[0].install).toMatch(/^[A-Za-z0-9_-]{22}$/);
    client.setUsageAnalytics(false);
    client.feature("bot_created");
    await client.flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the feature catalog and event properties compatible with the server", async () => {
    expect(client.APP_FEATURES).toEqual(SERVER_FEATURES);
    client.configure(config);
    client.screen("/bots/123");
    client.feature("bot_created");
    client.error("window", "error");
    client.pairFailed("expired_code");
    client.messageSent();
    client.replyReceived(123);
    await client.flush();
    for (const event of events()) expect(cleanProps(event.name as Parameters<typeof cleanProps>[0], event.props)).toEqual(event.props);
  });
});

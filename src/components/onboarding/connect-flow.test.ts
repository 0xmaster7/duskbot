import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_TIMEOUTS, ConnectFlow, LOST_AFTER, POLL_MS, connectsInApp, type ConnectDeps, type ConnectInstance, type ConnectState } from "./connect-flow";

type Route = (init?: { method?: string; body?: string; signal?: AbortSignal }) => unknown;

const codex = (snapshot: ConnectInstance["snapshot"], extra: Partial<ConnectInstance> = {}): ConnectInstance => ({
  instanceId: "codex", driverKind: "codex", snapshot, authentication: { method: "device-code" }, install: { server: { standalone: { downloadBytes: 40 * 1024 * 1024 } } }, ...extra,
});
const plan = (snapshot: ConnectInstance["snapshot"]): ConnectInstance => ({
  instanceId: "chatgpt", driverKind: "codex", snapshot, authentication: { method: "browser-pkce" }, install: { server: {} },
});
const waking = () => Object.assign(new Error("My Cloud is waking up"), { status: 503, body: { error: "waking" } });
const refused = () => Object.assign(new Error("Continue with ChatGPT on the computer running dusk bot."), { status: 403, body: {} });

function harness(lists: Array<ConnectInstance[] | (() => ConnectInstance[])>, routes: Record<string, Route>, extra: Partial<ConnectDeps> = {}) {
  const calls: string[] = [];
  const trail: Array<[string, Record<string, unknown>]> = [];
  const opened: string[] = [];
  let read = 0;
  const deps: ConnectDeps = {
    api: async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const key = Object.keys(routes).find((pattern) => `${init?.method ?? "GET"} ${path}`.startsWith(pattern));
      if (!key) throw new Error(`unrouted ${path}`);
      const answer = routes[key]!(init);
      return (answer instanceof Promise ? answer : Promise.resolve(answer)) as never;
    },
    refresh: async () => {
      const next = lists[Math.min(read++, lists.length - 1)]!;
      return typeof next === "function" ? next() : next;
    },
    open: async (link) => { opened.push(link); return true; },
    trail: (ev, fields) => { trail.push([ev, fields]); },
    ...extra,
  };
  const flow = new ConnectFlow(deps);
  const seen: ConnectState["stage"][] = [];
  flow.subscribe((state) => { if (seen.at(-1) !== state.stage) seen.push(state.stage); });
  return { flow, calls, trail, opened, seen };
}

const never = (init?: { signal?: AbortSignal }) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const device = { auth: { phase: "waiting", flowId: "f1", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-12345" } };
const target = { tile: "chatgpt", candidates: ["chatgpt", "codex"] };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("connect flow stages", () => {
  it("reuses a login that already works without starting a sign-in", async () => {
    const { flow, calls, seen, trail } = harness([[plan({ state: "available", authenticated: false }), codex({ state: "available", authenticated: true })]], {});
    flow.start(target);
    await vi.runAllTimersAsync();
    expect(flow.state).toEqual({ stage: "connected", reused: true });
    expect(seen).toEqual(["preparing", "connected"]);
    expect(calls).toEqual([]);
    expect(trail.find(([ev]) => ev === "connect.done")?.[1]).toMatchObject({ tile: "chatgpt", reused: true });
  });

  it("installs a missing helper, then opens the sign-in, waits for the code and confirms", async () => {
    let signedIn = false;
    const { flow, seen, opened, calls } = harness([
      [codex({ state: "unavailable", reason: "codex CLI not found" })],
      [codex({ state: "available", authenticated: false })],
      () => [codex({ state: "available", authenticated: signedIn })],
    ], {
      "POST /api/instances/codex/install": () => ({ instances: [] }),
      "POST /api/instances/codex/auth/start": () => device,
      "GET /api/instances/codex/auth/status": () => ({ auth: { phase: signedIn ? "succeeded" : "waiting" } }),
    });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "waiting", kind: "device", code: "ABCD-12345", link: "https://auth.openai.com/codex/device", opened: true });
    expect(opened).toEqual(["https://auth.openai.com/codex/device"]);
    signedIn = true;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(seen).toEqual(["preparing", "installing", "opening", "waiting", "confirming", "connected"]);
    expect(flow.state).toEqual({ stage: "connected", reused: false });
    expect(calls.filter((call) => call.includes("/install"))).toHaveLength(1);
  });

  it("says how big the official helper is while it downloads", async () => {
    const { flow } = harness([[codex({ state: "unavailable", reason: "codex CLI not found" })]], { "POST /api/instances/codex/install": never });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "installing", downloadBytes: 40 * 1024 * 1024 });
  });

  it("never downloads again while the server is still reading the status", async () => {
    const { flow, calls } = harness([
      [codex({ state: "unavailable", reason: "Checking engine status" })],
      [codex({ state: "available", authenticated: false })],
    ], { "POST /api/instances/codex/auth/start": () => device, "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }) });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flow.state.stage).toBe("waiting");
    expect(calls.some((call) => call.includes("/install"))).toBe(false);
  });

  it("falls back to the code sign-in when the ChatGPT plan sign-in is refused on this machine", async () => {
    const { flow, trail } = harness([[plan({ state: "available", authenticated: false }), codex({ state: "available", authenticated: false })]], {
      "POST /api/instances/chatgpt/auth/start": () => Promise.reject(refused()),
      "POST /api/instances/codex/auth/start": () => device,
      "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }),
    });
    flow.start(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "waiting", code: "ABCD-12345" });
    expect(flow.instance).toBe("codex");
    expect(trail.some(([ev]) => ev === "connect.fallback")).toBe(true);
  });

  it("passes over an instance that can't sign in here (the ChatGPT plan on a hosted cloud)", () => {
    expect(connectsInApp(plan({ state: "unavailable", authenticated: false, authenticationUnavailableReason: "hosted" }))).toBe(false);
    expect(connectsInApp(codex({ state: "available", authenticated: false }))).toBe(true);
  });

  it("waits for a cloud that is waking, then carries on", async () => {
    let awake = false;
    const { flow, seen } = harness([() => { if (!awake) throw waking(); return [codex({ state: "available", authenticated: false })]; }],
      { "POST /api/instances/codex/auth/start": () => device, "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }) });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state.stage).toBe("waking");
    awake = true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(seen).toEqual(["preparing", "waking", "preparing", "opening", "waiting"]);
  });

  it("starts in the waking stage when the cloud is asleep", async () => {
    let asleep = true;
    const { flow } = harness([[codex({ state: "available", authenticated: true })]], {}, { waking: () => asleep });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state.stage).toBe("waking");
    asleep = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(flow.state).toEqual({ stage: "connected", reused: true });
  });

  it("keeps the link to copy when the browser would not open", async () => {
    const { flow } = harness([[plan({ state: "available", authenticated: false })]], {
      "POST /api/instances/chatgpt/auth/start": () => ({ auth: { phase: "waiting", flowId: "f2", authorizationUrl: "https://auth.openai.com/api/accounts/authorize?x=1" } }),
      "GET /api/instances/chatgpt/auth/status": () => ({ auth: { phase: "waiting" } }),
    }, { open: async () => false });
    flow.start({ tile: "chatgpt", candidates: ["chatgpt"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "waiting", kind: "browser", opened: false, link: "https://auth.openai.com/api/accounts/authorize?x=1" });
  });

  it("takes a pasted code back for Claude", async () => {
    let done = false;
    const { flow, calls } = harness([
      [{ instanceId: "claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: false }, authentication: { method: "paste-code" } }],
      () => [{ instanceId: "claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: done } }],
    ], {
      "POST /api/instances/claude/auth/start": () => ({ auth: { phase: "waiting", flowId: "c1", authorizationUrl: "https://claude.ai/oauth/authorize?x=1" } }),
      "POST /api/instances/claude/auth/complete": () => { done = true; return { ok: true }; },
    });
    flow.start({ tile: "claude", candidates: ["claude"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "waiting", kind: "paste" });
    flow.submit(" CODE#123 ");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toContain("POST /api/instances/claude/auth/complete");
    expect(flow.state.stage).toBe("connected");
  });

  it("one at a time: starting another cancels the sign-in under way on the server", async () => {
    const { flow, calls, seen } = harness([[codex({ state: "available", authenticated: false }), { ...codex({ state: "available", authenticated: false }), instanceId: "githubCopilot", driverKind: "copilotAgent" }]], {
      "POST /api/instances/codex/auth/start": () => device,
      "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }),
      "POST /api/instances/codex/auth/cancel": () => ({ ok: true }),
      "POST /api/instances/githubCopilot/auth/start": () => ({ auth: { phase: "waiting", flowId: "g1", authorizationUrl: "https://github.com/login/device", userCode: "WXYZ-1234" } }),
      "GET /api/instances/githubCopilot/auth/status": () => ({ auth: { phase: "waiting" } }),
    });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    flow.start({ tile: "copilot", candidates: ["githubCopilot"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toContain("POST /api/instances/codex/auth/cancel");
    expect(flow.state).toMatchObject({ stage: "waiting", code: "WXYZ-1234", link: "https://github.com/login/device" });
    expect(flow.target?.tile).toBe("copilot");
    expect(seen.at(-1)).toBe("waiting");
  });

  it("cancel leaves nothing running", async () => {
    const { flow, trail } = harness([[codex({ state: "unavailable", reason: "codex CLI not found" })]], { "POST /api/instances/codex/install": never });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    flow.cancel();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS.installing * 2);
    expect(flow.state).toEqual({ stage: "idle" });
    expect(trail.some(([ev]) => ev === "connect.timeout")).toBe(false);
    expect(trail.find(([ev]) => ev === "connect.cancel")?.[1]).toMatchObject({ stage: "installing" });
  });
});

describe("connect flow timeouts", () => {
  const stuck = (stage: keyof typeof CONNECT_TIMEOUTS, lists: ConnectInstance[][], routes: Record<string, Route>, extra: Partial<ConnectDeps> = {}) => async () => {
    const { flow, trail } = harness(lists, routes, extra);
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS[stage] + POLL_MS);
    expect(flow.state).toMatchObject({ stage: "failed", at: stage, reason: "timeout" });
    expect(trail.find(([ev]) => ev === "connect.timeout")?.[1]).toMatchObject({ stage, tile: "chatgpt" });
  };

  it("ends a status read that never answers", async () => {
    const { flow } = harness([], {}, { refresh: () => new Promise(() => {}) });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS.preparing + 1);
    expect(flow.state).toMatchObject({ stage: "failed", at: "preparing", reason: "timeout" });
  });
  it("ends a download that runs too long", stuck("installing", [[codex({ state: "unavailable", reason: "codex CLI not found" })]], { "POST /api/instances/codex/install": never }));
  it("ends a sign-in that never starts", stuck("opening", [[codex({ state: "available", authenticated: false })]], { "POST /api/instances/codex/auth/start": never }));
  it("ends a sign-in nobody finishes, and stops it on the server", async () => {
    const { flow, calls } = harness([[codex({ state: "available", authenticated: false })]], {
      "POST /api/instances/codex/auth/start": () => device,
      "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }),
      "POST /api/instances/codex/auth/cancel": () => ({ ok: true }),
    });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS.waiting + POLL_MS);
    expect(flow.state).toMatchObject({ stage: "failed", at: "waiting", reason: "timeout", link: "https://auth.openai.com/codex/device" });
    expect(calls).toContain("POST /api/instances/codex/auth/cancel");
  });
  it("ends a sign-in that finished but never shows up as ready", stuck("confirming", [[codex({ state: "available", authenticated: false })]], {
    "POST /api/instances/codex/auth/start": () => ({ auth: { phase: "succeeded" } }),
  }));
  it("ends a cloud that never wakes", async () => {
    const { flow } = harness([], {}, { refresh: () => Promise.reject(waking()) });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS.waking + 3_000);
    expect(flow.state).toMatchObject({ stage: "failed", at: "waking", reason: "timeout" });
  });
  it("says it lost track after status checks in a row get no answer", async () => {
    const { flow } = harness([[codex({ state: "available", authenticated: false })]], {
      "POST /api/instances/codex/auth/start": () => device,
      "GET /api/instances/codex/auth/status": () => Promise.reject(new TypeError("unreachable")),
    });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(POLL_MS * LOST_AFTER + 10);
    expect(flow.state).toMatchObject({ stage: "failed", at: "waiting", reason: "lost" });
  });
  it("Try again starts over from the top", async () => {
    let start = 0;
    const { flow } = harness([[codex({ state: "available", authenticated: false })]], {
      "POST /api/instances/codex/auth/start": () => (++start === 1 ? Promise.reject(new Error("Codex could not start")) : device),
      "GET /api/instances/codex/auth/status": () => ({ auth: { phase: "waiting" } }),
    });
    flow.start({ tile: "chatgpt", candidates: ["codex"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state).toMatchObject({ stage: "failed", at: "opening", reason: "error", message: "Codex could not start" });
    flow.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.state.stage).toBe("waiting");
  });
});

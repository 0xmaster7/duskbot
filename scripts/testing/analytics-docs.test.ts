// @vitest-environment happy-dom
// docs/analytics.md is the promise of what the app sends: nothing until the person turns "help improve dusk bot" on,
// and then only the events its table lists.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The event names in the first column of the "## Events" table; one row may name several. */
function eventRows(docs: string): string[] {
  const start = docs.indexOf("\n## Events\n");
  const end = docs.indexOf("\n## ", start + 1);
  return docs.slice(start, end === -1 ? undefined : end).split("\n")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => [...line.split("|")[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("docs/analytics.md", () => {
  it("lists exactly the events the app's client accepts", () => {
    const accepted = [...read("src/lib/product-analytics.ts").matchAll(/case "(app_\w+)":/g)].map((match) => match[1]!);
    expect(accepted.length).toBeGreaterThan(0);
    expect(eventRows(read("docs/analytics.md")).sort()).toEqual([...new Set(accepted)].sort());
  });

  it("says it is off until turned on, and names no third-party SDK", () => {
    const docs = read("docs/analytics.md");
    expect(docs).toMatch(/off on a new\s+install/);
    expect(docs).not.toMatch(/posthog|\bfork\b/i);
  });

  it("holds the client to it: nothing is recorded or sent before opt-in", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const relay = { send: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
    const client = await import("../../src/lib/product-analytics");
    client.configure({ origin: "https://accounts.example", token: null, platform: "darwin", version: "1.2.3", kind: "desktop", force: true });
    client.feature("bot_created");
    client.action("env", { os: "darwin" });
    client.messageSent();
    await client.flush();
    client.configure({ origin: null, token: null, relay, platform: "darwin", version: "1.2.3", kind: "desktop", force: true });
    client.feature("bot_created");
    await client.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(relay.send).not.toHaveBeenCalled();
    expect(storage.has("dusk-install-id")).toBe(false);
  });
});

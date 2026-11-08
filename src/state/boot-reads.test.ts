import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_CONVERSATION_KEY } from "@/lib/last-conversation";
import { chatSnapshotPath, SESSION_PATH, startBootReads, takeBootRead } from "./boot-reads";

afterEach(() => { vi.unstubAllGlobals(); takeBootRead(SESSION_PATH); });

describe("the reads a page starts as it loads", () => {
  it("asks for the session and the last open chat's snapshot, each handed out once", () => {
    const stored = new Map([[LAST_CONVERSATION_KEY, "bot-7"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });
    const fetchImpl = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}"));
    startBootReads(fetchImpl as unknown as typeof fetch, 1_000);
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([SESSION_PATH, "/api/bots?messages=200&selected=bot-7"]);
    expect(takeBootRead(chatSnapshotPath("bot-7"), 2_000)).toBeDefined();
    expect(takeBootRead(chatSnapshotPath("bot-7"), 2_000)).toBeUndefined();
    expect(takeBootRead(chatSnapshotPath("another"), 2_000)).toBeUndefined();
  });

  it("drops a read nobody took soon, so a late reader asks the server again", () => {
    startBootReads(vi.fn(async () => new Response("{}")) as unknown as typeof fetch, 1_000);
    expect(takeBootRead(SESSION_PATH, 1_000 + 16_000)).toBeUndefined();
  });
});

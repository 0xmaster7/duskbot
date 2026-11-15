import { describe, expect, it } from "vitest";
import { connectedCards, readConnectedCache, writeConnectedCache } from "./ai-connected-cache";
import type { AiTileId } from "./funnel";

const available = { state: "available" };
const checking = { state: "unavailable", reason: "Checking engine status" };
const signedOut = { state: "unavailable", reason: "Not signed in" };

const tile = (id: AiTileId, ...snapshots: Array<{ state: string; reason?: string }>) => ({ id, candidates: snapshots.map((snapshot) => ({ snapshot })) });
const live = (entry: { candidates: ReadonlyArray<{ snapshot: { state: string } }> }) => entry.candidates[0]?.snapshot.state === "available";

describe("the AI grid's last known connected cards", () => {
  it("draws a card connected at once from the last answer while its engine is still being checked", () => {
    const { shown, next } = connectedCards([tile("claude", checking), tile("chatgpt", available), tile("grok", checking)], live, new Set<AiTileId>(["claude"]));
    expect([...shown].sort()).toEqual(["chatgpt", "claude"]);
    expect([...next].sort()).toEqual(["chatgpt", "claude"]);
  });

  it("takes the live answer once the engine has one, dropping a card that is no longer connected", () => {
    const { shown, next } = connectedCards([tile("claude", signedOut)], live, new Set<AiTileId>(["claude"]));
    expect(shown.size).toBe(0);
    expect(next.size).toBe(0);
  });

  it("keeps the cache across opens", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    writeConnectedCache(new Set<AiTileId>(["grok", "claude"]), storage);
    expect([...readConnectedCache(storage)]).toEqual(["claude", "grok"]);
    expect(readConnectedCache({ getItem: () => "{bad" }).size).toBe(0);
  });
});

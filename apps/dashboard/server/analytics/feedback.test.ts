import { describe, expect, it } from "vitest";
import { feedbackAnswer } from "./feedback.ts";
import { memoryUsageStore, type UsageRecord } from "./usage.ts";

const NOW = Date.UTC(2026, 10, 13, 12);
const base = { accountId: "acct_a", workspaceId: "ws_1" };
const records: UsageRecord[] = [
  { ...base, id: "frust00001", kind: "frustration", at: NOW - 3000, data: { id: "frust00001", at: NOW - 3000, engine: "claude", category: "email", tools: ["app"], apps: ["gmail"], signals: ["retried"], retries: 2,
    summary: "the bot kept failing to connect gmail and the person retried 3 times." } },
  { ...base, id: "session001", kind: "session", at: NOW - 2000, data: { id: "session001", at: NOW - 2000, engine: "codex", category: "coding", tools: ["terminal"], apps: ["github"], turns: 22, minutes: 50, failed: 1,
    summary: "a long coding session in the terminal; signing in to github took 2 tries." } },
  { ...base, id: "session002", kind: "session", at: NOW - 1000, data: { id: "session002", at: NOW - 1000, engine: "claude", category: "research", tools: ["browser"], apps: [], turns: 16, minutes: 30, failed: 0 } },
  { ...base, id: "digest0001", kind: "digest", at: NOW - 4000, data: { id: "digest0001", at: NOW - 4000, turns: 60, days: 5, summary: "they mostly use it for email and research; replies are sometimes slow." } },
  { ...base, id: "turn000001", kind: "turn", at: NOW - 500, data: { id: "turn000001", at: NOW - 500, engine: "claude", outcome: "ok", ms: 1000, tools: [], apps: [], category: "chat", from: "app", place: "desktop", room: false } },
];

describe("feedback view", () => {
  it("lists every kind of note newest first, never naming the account, with friction themes first", async () => {
    const store = memoryUsageStore(() => NOW);
    await store.insert(records);
    const answer = await feedbackAnswer(store, { now: NOW, kind: null, before: null });
    expect(answer.notes.map(note => `${note.kind}:${note.id}`)).toEqual(["big:session002", "big:session001", "bad:frust00001", "weekly:digest0001"]);
    expect(answer.notes[0]!.text).toBeNull();
    expect(JSON.stringify(answer)).not.toContain("acct_a");
    expect(answer.counts).toEqual({ bad: 1, big: 2, weekly: 1 });
    expect(answer.themes[0]!.pain).toBe(true);
    expect(answer.themes.map(theme => theme.key)).toContain("connecting");
  });
  it("filters by kind and pages with a cursor", async () => {
    const store = memoryUsageStore(() => NOW);
    await store.insert(records);
    const big = await feedbackAnswer(store, { now: NOW, kind: "big", before: null, limit: 1 });
    expect(big.notes.map(note => note.id)).toEqual(["session002"]);
    expect(big.next).toBe(NOW - 1000);
    const more = await feedbackAnswer(store, { now: NOW, kind: "big", before: big.next, limit: 1 });
    expect(more.notes.map(note => note.id)).toEqual(["session001"]);
    expect(more.next).toBeNull();
  });
});

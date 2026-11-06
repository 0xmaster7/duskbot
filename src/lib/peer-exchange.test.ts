import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { exchangeEntries, exchangeRuns, exchangeSummary } from "./peer-exchange";

const msg = (id: string, fields: Partial<Message>): Message => ({ id, role: "bot", kind: "text", at: 1, ...fields } as Message);
const ghosty = { id: "ghosty", name: "Ghosty" };
const amy = { id: "amy", name: "Amy" };

describe("exchangeSummary", () => {
  it("says one row as Messaged or Message from", () => {
    expect(exchangeSummary([{ direction: "outbound", peer: ghosty }])).toEqual({ kind: "single", direction: "outbound", peer: ghosty });
    expect(exchangeSummary([{ direction: "inbound", peer: ghosty }])).toMatchObject({ kind: "single", direction: "inbound" });
  });

  it("calls one message to each of several bots a fan-out, and counts anything else", () => {
    expect(exchangeSummary([{ direction: "outbound", peer: ghosty }, { direction: "outbound", peer: amy }])).toEqual({ kind: "fanout", peers: [ghosty, amy] });
    expect(exchangeSummary([{ direction: "inbound", peer: ghosty }, { direction: "outbound", peer: ghosty }, { direction: "inbound", peer: ghosty }]))
      .toEqual({ kind: "thread", count: 3, peers: [ghosty] });
  });
});

describe("exchangeEntries", () => {
  it("folds another bot's line and this bot's reply to it, but not the person's lines or cards", () => {
    const rows = [
      msg("you", { role: "user", text: "hi" }),
      msg("answer", { text: "hello", requestMessageId: "you" }),
      msg("asked", { role: "user", text: "[From @Ghosty (bot) · message · reply expected] status?", peerAsk: { botId: "ghosty", name: "Ghosty" } }),
      msg("reply", { text: "all good", requestMessageId: "asked" }),
      msg("card", { kind: "options", requestMessageId: "asked" }),
    ];
    const entries = exchangeEntries(rows, "me");
    expect([...entries.keys()]).toEqual(["asked", "reply"]);
    expect(entries.get("asked")).toEqual({ direction: "inbound", peer: ghosty });
    expect(entries.get("reply")).toEqual({ direction: "outbound", peer: ghosty });
  });

  it("reads sent rows as outbound, results as inbound, and leaves a bot's question to the person alone", () => {
    const rows = [
      msg("sent", { kind: "activity", tool: { name: "Sent to Ghosty", ok: true }, from: { botId: "me", name: "Me", color: "blue" }, threadRef: { botId: "ghosty", threadId: "t", title: "x" } }),
      msg("result", { kind: "activity", tool: { name: "Ghosty replied", ok: true }, roomRequest: { id: "r", phase: "result" }, from: { botId: "ghosty", name: "Ghosty", color: "green" }, threadRef: { botId: "ghosty", threadId: "t", title: "x" } }),
      msg("needs", { kind: "activity", tool: { name: "Ghosty needs your input: which?", ok: true }, from: { botId: "ghosty", name: "Ghosty", color: "green" }, threadRef: { botId: "ghosty", threadId: "t", title: "x" } }),
    ];
    const entries = exchangeEntries(rows, "me");
    expect(entries.get("sent")?.direction).toBe("outbound");
    expect(entries.get("result")?.direction).toBe("inbound");
    expect(entries.has("needs")).toBe(false);
  });
});

describe("exchangeRuns", () => {
  it("groups consecutive exchange items, stepping over rows the chat does not draw", () => {
    type Item = { rows: Message[]; hidden?: boolean };
    const items: Item[] = [
      { rows: [msg("a", { role: "user", text: "[From @Ghosty (bot) · message · x] one", peerAsk: { botId: "ghosty", name: "Ghosty" } })] },
      { rows: [msg("step", { kind: "activity", tool: { name: "Read", ok: true } })], hidden: true },
      { rows: [msg("b", { text: "two", requestMessageId: "a" })] },
      { rows: [msg("c", { role: "user", text: "mine" })] },
    ];
    const all = items.flatMap((item) => item.rows);
    const runs = exchangeRuns(items, (item) => item.rows, exchangeEntries(all, "me"), (item) => item.hidden === true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ start: 0, end: 2, summary: { kind: "thread", count: 2 } });
  });
});

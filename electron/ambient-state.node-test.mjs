import assert from "node:assert/strict";
import test from "node:test";
import { applyPrefsChange, parseAct, parsePrefs, parseSnapshot } from "./ambient-state.mjs";

const bot = (fields = {}) => ({ id: "nova", threadId: "t1", name: "Nova", color: "blue", status: "working", line: "Hi", at: 5, ...fields });

test("a summary keeps only the shapes the surfaces draw, each line cut short", () => {
  const parsed = parseSnapshot({
    lang: "de",
    labels: { idle: "Untätig", "bad key!": "x", working: "Arbeitet".repeat(40) },
    bots: [
      bot({ extra: "secret", line: "a ".repeat(400), avatar: "/api/avatars/nova.png", approval: { requestId: "r1", threadId: "t1", title: "Run npm test", more: 1 } }),
      bot(),
      bot({ id: "../etc", threadId: "t2" }),
      bot({ id: "quill", threadId: "t3", color: "neon", status: "dancing", avatar: "https://evil.example/x.png", body: "<svg>", asks: 1e9 }),
      "nope",
    ],
  });
  assert.equal(parsed.lang, "de");
  assert.deepEqual(Object.keys(parsed.labels), ["idle", "working"]);
  assert.equal(parsed.labels.working.length, 160);
  assert.deepEqual(parsed.bots.map((entry) => entry.id), ["nova", "quill"]);
  const [nova, quill] = parsed.bots;
  assert.equal(nova.extra, undefined);
  assert.equal(nova.line.length, 240);
  assert.equal(nova.avatar, "/api/avatars/nova.png");
  assert.deepEqual(nova.approval, { requestId: "r1", threadId: "t1", title: "Run npm test" });
  assert.deepEqual([quill.color, quill.status, quill.avatar, quill.body, quill.asks], ["green", "idle", null, null, 99]);
  assert.equal(parseSnapshot({ bots: "x" }), null);
  assert.equal(parseSnapshot(null), null);
});

test("the surfaces may only ask to reply, allow, deny or make a bot", () => {
  assert.deepEqual(parseAct({ kind: "reply", botId: "nova", threadId: "t1", text: "  on it  " }), { kind: "reply", botId: "nova", threadId: "t1", text: "on it" });
  assert.equal(parseAct({ kind: "reply", botId: "nova", threadId: "t1", text: "   " }), null);
  assert.deepEqual(parseAct({ kind: "allow", botId: "nova", threadId: "t1", requestId: "r1", text: "x" }), { kind: "allow", botId: "nova", threadId: "t1", requestId: "r1" });
  assert.equal(parseAct({ kind: "deny", botId: "nova", threadId: "t1" }), null);
  assert.deepEqual(parseAct({ kind: "new-bot", botId: "x" }), { kind: "new-bot" });
  assert.equal(parseAct({ kind: "delete", botId: "nova", threadId: "t1" }), null);
  assert.equal(parseAct({ kind: "reply", botId: "a b", threadId: "t1", text: "hi" }), null);
});

test("both surfaces start on only on macOS, and a change keeps to the known choices", () => {
  assert.deepEqual(parsePrefs(null, "darwin"), { island: true, dock: true, size: "medium", display: "active", order: [] });
  assert.equal(parsePrefs(null, "win32").island, false);
  assert.equal(parsePrefs({ island: false }, "darwin").island, false);
  const prefs = parsePrefs(null, "darwin");
  const changed = applyPrefsChange(prefs, { size: "large", display: "built-in", island: false, order: ["b", "a", "b", "../x"], evil: 1 });
  assert.deepEqual(changed, { island: false, dock: true, size: "large", display: "built-in", order: ["b", "a"] });
  assert.deepEqual(applyPrefsChange(prefs, { size: "giant", display: "left" }), prefs);
});

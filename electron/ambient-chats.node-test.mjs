import assert from "node:assert/strict";
import test from "node:test";
import { chatOfPage, chatText, createChatFiller } from "./ambient-chats.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const bot = (id, at, chat) => ({ id, threadId: `t-${id}`, name: id, at, ...(chat ? { chat } : { chat: [] }) });

test("a page of messages becomes the mini chat: what was said, plain, newest last", () => {
  assert.equal(chatText("**Booked** the [9:40](https://x.test) to `Lisbon`\n\n- receipt sent"), "Booked the 9:40 to Lisbon receipt sent");
  const chat = chatOfPage([
    { id: "a", role: "user", kind: "text", text: "Find a flight", at: 1 },
    { id: "b", role: "bot", kind: "activity", text: "", at: 2 },
    { id: "c", role: "bot", kind: "text", text: "  ", at: 3 },
    { id: "d", role: "bot", kind: "text", text: "Found **two**.", at: 4 },
  ]);
  assert.deepEqual(chat, [{ id: "a", from: "you", text: "Find a flight", at: 1 }, { id: "d", from: "bot", text: "Found two.", at: 4 }]);
  assert.equal(chatText("Five new emails:\n| From | About |\n| --- | --- |\n| Ana | Order 1187 |"), "Five new emails: From About Ana Order 1187");
  assert.equal(chatOfPage(Array.from({ length: 9 }, (_, index) => ({ id: `m${index}`, role: "bot", kind: "text", text: `line ${index}`, at: index }))).length, 6);
});

test("main reads the chats the page left out, once per bot's newest moment, and fills them in for the surfaces", async () => {
  const reads = [];
  let told = 0;
  const filler = createChatFiller({
    read: async (url) => {
      reads.push(url);
      return { threads: [{ threadId: "t-bolt", messages: [{ id: "x", role: "bot", kind: "text", text: "Deployed the fix.", at: 5 }] }] };
    },
    onChange: () => { told += 1; },
    setTimer: (fn) => { queueMicrotask(fn); return 1; },
  });
  const snapshot = { bots: [bot("bolt", 5), bot("ada", 3, [{ id: "y", from: "you", text: "hi", at: 3 }])] };
  filler.want(snapshot, "https://home.example");
  await tick(); await tick();
  // only the bot that came without a chat is read, from the page's own server, the newest few messages
  assert.deepEqual(reads, ["https://home.example/api/transcripts?limit=12&threads=t-bolt"]);
  assert.equal(told, 1);
  const filled = filler.fill(snapshot);
  assert.deepEqual(filled.bots[0].chat.map((entry) => entry.text), ["Deployed the fix."]);
  assert.deepEqual(filled.bots[1].chat.map((entry) => entry.text), ["hi"]);
  // the same moment again is not read again; something newer is
  filler.want(snapshot, "https://home.example");
  await tick(); await tick();
  assert.equal(reads.length, 1);
  filler.want({ bots: [bot("bolt", 9)] }, "https://home.example");
  await tick(); await tick();
  assert.equal(reads.length, 2);
  filler.stop();
});

test("a failed read shows nothing new and leaves the page's own chats alone", async () => {
  let told = 0;
  const filler = createChatFiller({ read: async () => { throw new Error("401"); }, onChange: () => { told += 1; }, setTimer: (fn) => { queueMicrotask(fn); return 1; } });
  const snapshot = { bots: [bot("bolt", 5)] };
  filler.want(snapshot, "https://home.example");
  await tick(); await tick();
  assert.equal(told, 0);
  assert.deepEqual(filler.fill(snapshot).bots[0].chat, []);
});

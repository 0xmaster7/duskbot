import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LAST_SEEN_BOTS, LAST_SEEN_MESSAGES, LAST_SEEN_TEXT, createLastSeenStore, parseLastSeen } from "./cloud-last-seen.mjs";

const ORIGIN = "https://d0123456789abcdef0123.desktops.example.test";
const message = (n, extra = {}) => ({ id: `m${n}`, role: n % 2 ? "bot" : "user", text: `line ${n}`, at: 1_700_000_000_000 + n, ...extra });
const bot = (n, messages = [message(1)]) => ({ id: `bot-${n}`, threadId: `thread-${n}`, name: `Bot ${n}`, color: "green", messages });
// a reversible stand-in for safeStorage: never plain JSON on disk
const encryption = (on = true) => ({ available: async () => on, encrypt: async (text) => Buffer.from(text).reverse(), decrypt: async (buffer) => Buffer.from(buffer).reverse().toString() });

test("a snapshot is checked and clipped: malformed bots and messages are dropped, never partly kept", () => {
  assert.equal(parseLastSeen(null), null);
  assert.equal(parseLastSeen({ bots: "x" }), null);
  const parsed = parseLastSeen({ bots: [
    bot(1, [message(1), { ...message(2), role: "system" }, { ...message(3), text: "  " }, message(4, { text: "x".repeat(LAST_SEEN_TEXT + 10), secret: "dropped" })]),
    { ...bot(2), name: "" }, { ...bot(3), color: "Not A Color" }, { id: "bot-4", name: "No thread", messages: [] },
  ] });
  assert.equal(parsed.bots.length, 2);
  assert.deepEqual(parsed.bots[0].messages.map((m) => m.id), ["m1", "m4"]);
  assert.equal(parsed.bots[0].messages[1].text.length, LAST_SEEN_TEXT);
  assert.equal("secret" in parsed.bots[0].messages[1], false);
  assert.equal("color" in parsed.bots[1], false);
  const many = parseLastSeen({ bots: Array.from({ length: LAST_SEEN_BOTS + 5 }, (_, n) => bot(n, Array.from({ length: LAST_SEEN_MESSAGES + 5 }, (_, i) => message(i)))) });
  assert.equal(many.bots.length, LAST_SEEN_BOTS);
  assert.equal(many.bots[0].messages.length, LAST_SEEN_MESSAGES);
  assert.equal(many.bots[0].messages.at(-1).id, `m${LAST_SEEN_MESSAGES + 4}`, "the newest are kept");
});

test("kept encrypted, for one Cloud's address, and read back after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "last-seen-")), file = join(dir, "cloud-last-seen.bin");
  const store = createLastSeenStore({ file, encryption: encryption(), now: () => 42 });
  assert.equal(await store.write(ORIGIN, { bots: [bot(1)] }), true);
  assert.equal(readFileSync(file).toString().includes("line 1"), false, "never in the clear");
  const again = createLastSeenStore({ file, encryption: encryption() });
  assert.deepEqual(await again.read(ORIGIN), { savedAt: 42, bots: [bot(1)] });
  assert.equal(await again.read("https://another.example.test"), null);
  await again.forget();
  assert.equal(existsSync(file), false);
  assert.equal(await again.read(ORIGIN), null);
});

test("without encryption nothing reaches the disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "last-seen-")), file = join(dir, "cloud-last-seen.bin");
  const store = createLastSeenStore({ file, encryption: encryption(false) });
  assert.equal(await store.write(ORIGIN, { bots: [bot(1)] }), false);
  assert.equal(existsSync(file), false);
  assert.equal(await store.write(ORIGIN, "junk"), false);
});

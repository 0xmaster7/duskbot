// My Cloud's chats as this computer last saw them, for the screen the window shows while My Cloud sleeps: opening the app
// never wakes it, so its page can't load, and the person reads these until they type, click or send. My Cloud's own page
// sends them (home:last-seen-save); they are kept encrypted on this computer only, never without encryption.
import { readFile, rm, writeFile } from "node:fs/promises";

export const LAST_SEEN_BOTS = 12;
export const LAST_SEEN_MESSAGES = 40;
export const LAST_SEEN_TEXT = 4_000;
const NAME = 80, ID = 200;
const COLOR = /^[a-z][a-z0-9-]{0,23}$/;

const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const id = value => (typeof value === "string" && value.length > 0 && value.length <= ID && !/\p{Cc}/u.test(value) ? value : null);
const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

/** A page's snapshot, checked and clipped: bots in the order sent, each with its open chat's last text messages. A malformed
 *  bot or message is dropped, never partly kept. */
export function parseLastSeen(input) {
  if (!record(input) || !Array.isArray(input.bots)) return null;
  const bots = [];
  for (const bot of input.bots) {
    if (bots.length >= LAST_SEEN_BOTS) break;
    if (!record(bot) || !id(bot.id) || !id(bot.threadId) || typeof bot.name !== "string" || !bot.name.trim() || !Array.isArray(bot.messages)) continue;
    const messages = [];
    for (const message of bot.messages.slice(-LAST_SEEN_MESSAGES)) {
      if (!record(message) || !id(message.id) || !["bot", "user"].includes(message.role) || typeof message.text !== "string" || !message.text.trim()
        || !Number.isSafeInteger(message.at) || message.at <= 0) continue;
      messages.push({ id: message.id, role: message.role, text: clip(message.text, LAST_SEEN_TEXT), at: message.at });
    }
    bots.push({ id: bot.id, threadId: bot.threadId, name: clip(bot.name.trim(), NAME), ...(typeof bot.color === "string" && COLOR.test(bot.color) ? { color: bot.color } : {}), messages });
  }
  return { bots };
}

/** `encryption`: main's safeStorage (`available`, `encrypt`, `decrypt`). One snapshot, for one Cloud's address. */
export function createLastSeenStore({ file, encryption, fs = { readFile, writeFile, rm }, now = Date.now }) {
  let kept;
  async function load() {
    if (kept !== undefined) return kept;
    kept = null;
    try {
      if (!(await encryption.available())) return kept;
      const sealed = await fs.readFile(file);
      const value = JSON.parse(await encryption.decrypt(sealed));
      const snapshot = parseLastSeen(value?.snapshot);
      if (typeof value?.origin === "string" && snapshot) kept = { origin: value.origin, savedAt: Number(value.savedAt) || 0, snapshot };
    } catch {}
    return kept;
  }
  return {
    /** The snapshot for `origin` with when it was saved, or null (none, another Cloud's, or nothing to decrypt with). */
    async read(origin) {
      const value = await load();
      return value && origin && value.origin === origin ? { savedAt: value.savedAt, ...value.snapshot } : null;
    },
    async write(origin, input) {
      const snapshot = parseLastSeen(input);
      if (!snapshot || typeof origin !== "string" || !origin) return false;
      kept = { origin, savedAt: now(), snapshot };
      if (!(await encryption.available().catch(() => false))) return false;
      await fs.writeFile(file, await encryption.encrypt(JSON.stringify(kept)), { mode: 0o600 });
      return true;
    },
    async forget() {
      kept = null;
      await fs.rm(file, { force: true }).catch(() => {});
    },
  };
}

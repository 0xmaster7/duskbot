// The mini chat's messages when the app's page sends none: a page served by an older build (a remote workspace not yet
// updated) or a bot whose transcript that page has not loaded. Main reads the newest few messages of those bots'
// conversations itself, from the same server the page came from, with that window's own session, as a background read
// (it never wakes a sleeping Cloud home). One read at a time, and a conversation is read again only once its bot has
// something newer.
export const CHAT_PAGE = 6;
/** Read a few more than shown: a page also holds steps and cards that say nothing. */
const READ_PAGE = 12;
const CHAT_TEXT = 500;
/** At most this often, so a burst of summaries is one read. */
export const CHATS_EVERY_MS = 1_500;

/** Plain text of a message as the mini chat shows it: markdown marks and links reduced to their words, one line. */
export function chatText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/gm, "")
    // a table's rule line goes, and its cells read as words
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_TEXT);
}

/** The newest things said in a page of messages, as the summary's `chat` (src/ambient/summary.ts chatOf). */
export function chatOfPage(messages) {
  if (!Array.isArray(messages)) return [];
  const said = [];
  for (let index = messages.length - 1; index >= 0 && said.length < CHAT_PAGE; index--) {
    const message = messages[index];
    if (!message || message.kind !== "text" || (message.role !== "user" && message.role !== "bot")) continue;
    const text = chatText(message.text);
    if (!text) continue;
    said.unshift({ id: String(message.id ?? `m${index}`), from: message.role === "user" ? "you" : "bot", text, at: Number.isFinite(message.at) ? message.at : 0 });
  }
  return said;
}

/**
 * @param {{ read: (url: string) => Promise<unknown>, onChange: () => void, now?: () => number,
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} deps `read`: GETs a URL through the app window's
 * own session and gives the JSON (or throws). `onChange`: newer chats arrived; the surfaces should be told.
 */
export function createChatFiller({ read, onChange, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const known = new Map(); // threadId -> { at, chat }
  let reading = false, timer = null, lastRead = 0, wanted = null;

  /** The bots that came without a chat get the one main read for them, if it is as new as they are. */
  function fill(snapshot) {
    if (!snapshot) return snapshot;
    return { ...snapshot, bots: snapshot.bots.map((bot) => {
      if (bot.chat?.length) return bot;
      const held = known.get(bot.threadId);
      return held?.chat.length ? { ...bot, chat: held.chat } : bot;
    }) };
  }

  /** Notes which conversations need a read (no chat from the page, and newer than what main holds), then reads them. */
  function want(snapshot, origin) {
    if (!snapshot || !origin) return;
    const threads = snapshot.bots.filter((bot) => !bot.chat?.length && (known.get(bot.threadId)?.at ?? -1) < bot.at).map((bot) => [bot.threadId, bot.at]);
    if (!threads.length) return;
    wanted = { origin, threads };
    schedule();
  }

  function schedule() {
    if (reading || timer || !wanted) return;
    timer = setTimer(run, Math.max(0, lastRead + CHATS_EVERY_MS - now()));
    timer?.unref?.();
  }

  async function run() {
    timer = null;
    const job = wanted;
    wanted = null;
    if (!job) return;
    reading = true;
    lastRead = now();
    let changed = false;
    try {
      const ids = job.threads.map(([threadId]) => threadId);
      const answer = await read(`${job.origin}/api/transcripts?limit=${READ_PAGE}&threads=${ids.map(encodeURIComponent).join(",")}`);
      const pages = Array.isArray(answer?.threads) ? answer.threads : [];
      const at = new Map(job.threads);
      for (const page of pages) {
        if (!at.has(page?.threadId)) continue;
        known.set(page.threadId, { at: at.get(page.threadId), chat: chatOfPage(page.messages) });
        changed = true;
      }
    } catch {
      // a read that fails is tried again with the next summary
    } finally {
      reading = false;
    }
    if (changed) onChange();
    schedule();
  }

  return { fill, want, stop() { if (timer) clearTimer(timer); timer = null; wanted = null; } };
}

// How bots sound in a group chat: the room's talk rules, the per-turn reminder, and a last safety net on what a bot wrote.
import { isMentionBoundary, isMentionNameContinuation } from "../shared/mention-boundary.ts";
import { proseOnly } from "../shared/person-mention.ts";

const nameList = (names: readonly string[]) => names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Rules for every turn, whatever the engine or style: they ride with the talking-style guide in the stable half. */
export const VOICE_RULES = "\n\nIn every message you write (a chat, a group, a routine's result, a report to a teammate):" +
  "\n- Never use em dashes. Use a comma, a period or a new line." +
  "\n- Never start with your own name or a label (\"Nova:\", \"Status update:\"). The app already shows who is talking." +
  "\n- Call the person \"you\", or by their name. Never \"@you\", \"the user\" or \"the human\"." +
  "\n- Talk, don't file a report: no \"No new work completed\", \"Next up is…\", \"Still the same from me\" or \"Same as the last check-in\". If nothing changed, say so once, in a few words of your own.\n";

/** The room's own rules, in its system prompt. `person` is the person's name when known. */
export function roomTalkRules(input: { person?: string; dm?: boolean }): string {
  const person = input.person?.trim();
  return [
    `You are in a group chat. Talk like a person in it, not a status report: usually one to three short sentences, in the talking style below.`,
    `Talk to ${person ? `${person} as "you" (their name is ${person})` : `the person as "you"`}; never write "@you".`,
    `Use @Name only for a teammate, when you hand them something or ask them a question; it wakes them, they see the conversation and respond. To credit or thank someone, write their name without the @.`,
    !input.dm && person ? `When you're blocked on ${person} and need them to act, tag them once as @${person}.` : "",
    !input.dm ? `When the answer needs something you don't have (a fact, a date, their part of the work), don't answer with a gap and don't ask the person for it: first @mention the teammate in this chat most likely to know, with the question, and give the full answer once they reply. Ask the person only if no teammate could know.` : "",
    `Speak for your own part. Don't repeat what a teammate already said in the chat or redo work they did or have in hand, and don't list the team's open items unless you were asked to.`,
    `When a teammate already covered everything you would say, reply with just (pass): it isn't shown.`,
    `When everyone is asked the same thing and nothing changed for you, one short line in your own words is enough.`,
    `A "[reacted 👍 to …]" line is that person's whole reply to the message it names: 👍 means yes, go ahead, and 👎 means no.`,
  ].filter(Boolean).join(" ");
}

/** The reminder at the end of a room turn's prompt, right where the reply is written. */
export function roomTurnVoiceNote(input: { alsoAnswering?: readonly string[] }): string {
  const others = (input.alsoAnswering ?? []).filter(Boolean);
  const base = "Short and human, in the person's talking style: no name prefix, no em dashes, no status-report lines, and \"you\" for the person. Missing a piece a teammate here may have? @mention them for it instead of leaving a gap.";
  if (!others.length) return base;
  return `${base} ${nameList(others)} ${others.length === 1 ? "is" : "are"} answering this same message at the same time and can't see your reply: speak only for your own part, in a line or two, and leave their work and the team's open list out.`;
}

/** Why this bot speaks now, when a teammate's @mention woke it rather than the person. */
export function mentionCueNote(cue: { by: { name: string }; closing: boolean }, person?: string): string {
  const by = cue.by.name;
  const who = person?.trim() || "the person";
  if (cue.closing) {
    return `${by} answered what you handed them, just above. This is your last turn on this request: check their part against what ${who} asked, ` +
      `then give ${who} one short wrap-up of the result and anything still open. Don't hand out new work now; a teammate you @mention won't be woken. ` +
      `If you said you would finish something once they answered, finish it now in that reply. ` +
      `Only if ${by}'s reply already answers ${who} fully, reply with just (pass).`;
  }
  return `${by} @mentioned you just above. Do the part ${by} asked of you, not the whole request again, and don't restate what ${by} or anyone else already said. ` +
    `If ${by} asked you a question or needs your result to finish (to check it, carry on, or give ${who} the full answer), end with @${by} once so they are woken; only when your answer settles everything for ${who} yourself, don't tag anyone.`;
}

/** For a bot answering the person's message after teammates already did, in the same round. */
export function answeredAboveNote(names: readonly string[]): string {
  const others = names.filter(Boolean);
  if (!others.length) return "";
  return `${nameList(others)} already answered this message just above: add only what's new from your side and don't repeat them. If they covered your part, reply with just (pass).`;
}

type Edit = { start: number; end: number; text: string };

const URL_LIKE = /\b(?:https?|ftp|mailto|file):\S+|\bwww\.\S+/gi;

/** The text with code and links blanked, offsets kept: nothing in them is ever rewritten. */
function maskedProse(text: string): string {
  return proseOnly(text).replace(URL_LIKE, (url) => " ".repeat(url.length));
}

const LINE_LEAD = /^[ \t]*(?:[-*+>][ \t]+|\d+[.)][ \t]+)?[*_~]*$/;
const SENTENCE_END = /^[*_~]*[ \t]*(?:[.!?]+|$)/;
const AFTER_PUNCT = /[,;:"'“”‘’)\]]$/;
// words that take "you" as their object ("waiting on @you."); after any other word a closing tag is a call ("want it @you?")
const TAKES_YOU = /\b(?:on|for|to|with|from|by|at|about|of|than|like|behind|toward|towards|without|via|over|ask|asking|asked|tell|telling|told|need|needs|needed|thank|ping|pinging|let|help|show|send|give|remind|see|hear|tag|tagging|cc|leave|leaving|left|count|counting|trust)$/i;

function capitalizeAt(text: string, at: number): Edit | null {
  const match = /\p{Ll}/u.exec(text.slice(at, at + 1));
  return match ? { start: at, end: at + 1, text: match[0].toUpperCase() } : null;
}

/** "@you" as the person's tag, rewritten as plain words: "@you's" is "your", a leading or closing tag is dropped. */
function personTagEdits(text: string, prose: string): Edit[] {
  const edits: Edit[] = [];
  const pattern = /@you/gi;
  for (let hit = pattern.exec(prose); hit; hit = pattern.exec(prose)) {
    const at = hit.index;
    let end = at + 4;
    if (!isMentionBoundary(prose, at)) continue;
    const possessive = /^['’]s\b/i.exec(prose.slice(end));
    if (!possessive && isMentionNameContinuation(prose.slice(end))) continue;
    if (possessive) end += possessive[0].length;
    const lineStart = prose.lastIndexOf("\n", at - 1) + 1;
    const before = prose.slice(lineStart, at);
    const after = prose.slice(end, prose.indexOf("\n", end) === -1 ? undefined : prose.indexOf("\n", end));
    const capital = text[at + 1] === "Y";
    if (!possessive && LINE_LEAD.test(before)) {
      // a tag that opens the line is a call for attention: drop it and its comma
      const gap = /^[ \t]*[,:]?[ \t]*/.exec(after)![0].length;
      edits.push({ start: at, end: end + gap, text: "" });
      const cap = capitalizeAt(text, end + gap);
      if (cap) edits.push(cap);
      continue;
    }
    if (!possessive && SENTENCE_END.test(after) && (AFTER_PUNCT.test(before.trimEnd()) || !TAKES_YOU.test(before.trimEnd()))) {
      // a closing tag after the sentence's own words: drop it with the space before it
      const space = before.length - before.trimEnd().length;
      edits.push({ start: at - space, end, text: "" });
      continue;
    }
    const sentenceStart = /(?:^|[.!?][ \t]+)[*_~]*$/.test(before);
    const word = possessive ? "your" : "you";
    edits.push({ start: at, end, text: capital || sentenceStart ? word[0]!.toUpperCase() + word.slice(1) : word });
  }
  return edits;
}

const DASH = /[ \t]*(?:\u2014|(?<=\s)\u2013(?=\s))[ \t]*/g;

/** Em dashes (and a spaced en dash used as one) in prose, as a comma, or a list marker at a line's start. */
function dashEdits(prose: string): Edit[] {
  const edits: Edit[] = [];
  for (let hit = DASH.exec(prose); hit; hit = DASH.exec(prose)) {
    const start = hit.index, end = start + hit[0].length;
    const lineStart = prose.lastIndexOf("\n", start - 1) + 1;
    const before = prose.slice(lineStart, start);
    const next = prose[end];
    if (!before.trim()) edits.push({ start, end, text: "- " });
    else if (next === undefined || next === "\n") edits.push({ start, end, text: "" });
    else if (/[,.;:!?(]$/.test(before.trimEnd()) || /^[,.;:!?)]/.test(next)) edits.push({ start, end, text: " " });
    else edits.push({ start, end, text: ", " });
  }
  return edits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A leading "Name:" in the bot's own name, and a closing "- Name" sign-off. */
function selfNameEdits(text: string, prose: string, name: string): Edit[] {
  const clean = name.trim();
  if (!clean) return [];
  const edits: Edit[] = [];
  const own = escapeRegExp(clean);
  const lead = new RegExp(`^\\s*[*_]{0,2}${own}[*_]{0,2}\\s*[:\uFF1A][*_]{0,2}[ \\t]*`, "iu").exec(prose);
  if (lead && prose.slice(lead[0].length).trim()) {
    edits.push({ start: 0, end: lead[0].length, text: "" });
    const cap = capitalizeAt(text, lead[0].length);
    if (cap) edits.push(cap);
  }
  const sign = new RegExp(`\\n[ \\t]*(?:[-\u2013\u2014~]+[ \\t]*)${own}[.!]?[ \\t]*$`, "iu").exec(prose);
  if (sign && prose.slice(0, sign.index).trim()) edits.push({ start: sign.index, end: prose.length, text: "" });
  return edits;
}

/** What a bot wrote, with its own-name prefix, "@you" tags and em dashes rewritten outside code and links.
 * `taggedLine`: the line that tagged the person, rewritten, so a mention still reaches them after the tag is gone. */
export function cleanBotVoice(text: string, selfName?: string, nested = false): { text: string; taggedLine?: string } {
  if (!text || !/[@\u2014\u2013:~-]/.test(text)) return { text };
  const prose = maskedProse(text);
  const tags = personTagEdits(text, prose);
  const edits = [...selfNameEdits(text, prose, selfName ?? ""), ...tags, ...dashEdits(prose)].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  out += text.slice(cursor);
  const first = nested ? undefined : tags[0];
  const lineAt = first ? text.lastIndexOf("\n", first.start - 1) + 1 : 0, lineEnd = first ? text.indexOf("\n", first.start) : -1;
  const taggedLine = first ? cleanBotVoice(text.slice(lineAt, lineEnd === -1 ? undefined : lineEnd), undefined, true).text.trim() || text.trim() : "";
  // a message that was only a tag keeps its words rather than vanishing
  return { text: out.trim() ? out : text, ...(taggedLine ? { taggedLine } : {}) };
}

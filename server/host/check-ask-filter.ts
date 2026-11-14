// One ask per human check: the card says what the person does, so a bot's own lines that only say it again ("Pastebin
// is showing a Cloudflare check, please complete it on the cloud computer") are dropped, server side, whatever the
// model wrote. Lines with anything new (what it tried, what it found, what comes next) stay.
import type { Message } from "../store.ts";

/** Words of the check itself. */
const CHECK = /\b(?:(?:this|the|a|that) (?:quick )?check|human (?:check|verification)|security (?:check|verification)|verif(?:y|ying|ication)|captcha|turnstile|cloudflare|are you (?:a )?(?:human|robot)|not a robot|bot check|press (?:and|&) hold|just a moment|take ?over)\b/iu;
/** Words that make a line about the check an ask, or a narration of it the card already gives. */
const ASK = /\b(?:take ?over|tap|complete|tick|solve|click|press|needs? you|please|can you|could you|once you|after you|when you|let me know|on the (?:cloud )?computer|in the browser|on your (?:computer|screen)|i(?:'|’)?ll (?:carry|continue|pick|resume)|carry on|waiting|wait for you|is showing|showing|shows|hit|ran into|asking|asks|wants|stuck|blocked|appeared|came up|popped up)\b/iu;
/** A line about another route or a finding is news, even when it names the check. */
const NEWS = /\b(?:instead|so i|i used|i switched|switched to|another (?:site|route|way|service)|the api|connected app|gist|dpaste|done|finished|posted|saved|link is|here(?:'|’)?s)\b/iu;

/** A line that only follows an ask ("I'll carry on from there"): dropped with it, never on its own. */
const FOLLOW = /^(?:i(?:'|\u2019)?ll (?:carry on|continue|pick (?:it|this|things) up|resume|take it from there)|thanks?(?: you)?|let me know (?:when|once)|once (?:that(?:'|\u2019)?s|it(?:'|\u2019)?s) done)\b[^.!?]*[.!?]?$/iu;

/** Whether one sentence only restates the ask a human-check card makes. */
export function restatesCheckAsk(sentence: string): boolean {
  const line = sentence.trim();
  return Boolean(line) && CHECK.test(line) && ASK.test(line) && !NEWS.test(line);
}

/** The text without its sentences that restate the check's ask; "" when nothing else was said. */
export function withoutCheckAsk(text: string): string {
  let asked = false;
  const paragraphs = text.split(/\n{2,}/u).map((paragraph) => paragraph.split(/\n/u).map((line) => line.split(/(?<=[.!?])\s+/u).filter((sentence) => {
    if (!restatesCheckAsk(sentence)) return true;
    asked = true;
    return false;
  })));
  // nothing restated: the text as it was, spacing and all
  if (!asked) return text.trim();
  const kept: string[] = [];
  for (const lines of paragraphs) {
    const shown = lines.map((sentences) => sentences.filter((sentence) => !(asked && FOLLOW.test(sentence.trim()))).join(" ").trim()).filter(Boolean);
    if (shown.length) kept.push(shown.join("\n"));
  }
  return kept.join("\n\n").trim();
}

/** The human-check card still waiting in the current task (after the person's latest message), or null. */
export function pendingCheckCard(path: readonly Message[], botId?: string): Message | null {
  for (let index = path.length - 1; index >= 0; index--) {
    const message = path[index]!;
    if (message.role === "user") return null;
    const card = message.kind === "signin" ? message.signIn : undefined;
    if (!card?.check || (botId && message.from?.botId && message.from.botId !== botId)) continue;
    if (card.done !== true && card.cancelled !== true && card.superseded !== true && card.answeredInChat !== true && card.stopped !== true) return message;
    return null;
  }
  return null;
}

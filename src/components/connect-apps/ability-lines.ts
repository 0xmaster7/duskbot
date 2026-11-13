// what an app can do, as plain lines: composio names its actions after api calls ("Get ACL Rule", "Patch Calendar List
// Entry"); a person reads what that lets a bot do ("See who can access a calendar"), the everyday ones first.

/** api verbs, said the way a person would; the order is how useful the kind of action usually is */
const VERBS: Array<[RegExp, string, number]> = [
  [/^(create|new|compose|schedule|book)$/i, "Create", 0],
  [/^(add|insert|post)$/i, "Add", 0],
  [/^(find|search|query|lookup|look)$/i, "Find", 1],
  [/^(list|browse)$/i, "See", 2],
  [/^(get|fetch|retrieve|read|view|show|describe)$/i, "See", 3],
  [/^(send|reply|forward|share|invite|publish)$/i, "", 1],
  [/^(update|patch|edit|change|modify|set|rename|move|reschedule)$/i, "Change", 4],
  [/^(delete|remove|trash|clear|archive|cancel|destroy)$/i, "", 5],
];

/** internals few people ask a bot for: listed after the rest */
const INTERNAL = /\b(acl|webhooks?|watch|channel stop|stop channel|colou?r definitions?|batch|bulk|sync tokens?|metadata|schemas?|raw|settings? list|restrictions?|runners?|contexts?|enterprise|alias|cse|identit(?:y|ies)|key pairs?|auth|installations?|secrets?|scim|oauth|tokens?|permissions?)\b/i;
/** what people mostly ask a bot to work with, in any app */
const EVERYDAY = /\b(events?|emails?|messages?|drafts?|issues?|pull requests?|tasks?|pages?|files?|folders?|contacts?|meetings?|comments?|documents?|docs?|sheets?|rows?|records?|deals?|tickets?|cards?|notes?|posts?|replies|reply|threads?|invoices?|customers?|leads?|repositor(?:y|ies)|projects?|channels?|calendars?|reminders?|lists?)\b/i;

/** api words with a plain meaning */
const PLAIN: Array<[RegExp, string]> = [
  [/^(?:see|find) (?:all )?acl rules?$/i, "See who can access a calendar"],
  [/^create acl rule$/i, "Give someone access"],
  [/^change acl rule$/i, "Change someone's access"],
  [/^delete acl rule$/i, "Remove someone's access"],
  [/^watch acl changes$/i, "Watch for access changes"],
  [/\bacl rules?\b/gi, "access"],
  [/\bsee single\b/gi, "See one"],
  [/\b(?:a new|new)\b/gi, "a"],
  [/\b(?:calendar )?list entry\b/gi, "calendar in your list"],
  [/\binto list\b/gi, "to your list"],
  [/\bfrom list\b/gi, "from your list"],
  [/\bby id\b/gi, ""],
  [/\bcolou?r definitions\b/gi, "available colors"],
  [/\bevent instances\b/gi, "each time a repeating event happens"],
];

const plural = (word: string) => /s$/i.test(word) ? word : /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

/** What an action is about: its last word, singular and lowercase ("List Events" is about "event"). */
const subject = (name: string) => (name.trim().split(/\s+/).pop() ?? "").toLowerCase().replace(/ies$/, "y").replace(/s$/, "");

/** One action's name as a short plain line, and how early it belongs in the list (lower is earlier). */
export function abilityLine(name: string): { text: string; rank: number } {
  const words = name.trim().split(/\s+/);
  const verb = VERBS.find(([pattern]) => pattern.test(words[0] ?? ""));
  let text = name.trim();
  let rank = 6;
  if (verb) {
    const [, said, order] = verb;
    rank = order;
    const rest = words.slice(1);
    if (said === "See" && /^list$/i.test(words[0]!) && rest.length) rest[rest.length - 1] = plural(rest[rest.length - 1]!);
    text = said ? [said, ...rest].join(" ") : words.join(" ");
    if (said === "See" && /^list$/i.test(words[0]!) && !/^(all|your)\b/i.test(rest.join(" "))) text = `See all ${rest.join(" ")}`.trim();
  }
  for (const [pattern, plain] of PLAIN) {
    if (pattern.flags.includes("g")) text = text.replace(pattern, plain);
    else if (pattern.test(text)) { text = plain; break; }
  }
  text = text.replace(/\s{2,}/g, " ").trim();
  if (INTERNAL.test(name)) rank += 10;
  else if (EVERYDAY.test(name)) rank -= 1;
  // long or id-bound names are the fine print
  if (name.split(/\s+/).length > 4 || /\b(id|ids)\b/i.test(name)) rank += 3;
  return { text, rank };
}

/** An app's actions as plain lines, the everyday ones first, each said once. What the app is mostly about (the
 * subjects most of its actions share, a calendar's events) leads. */
export function abilityLines(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const name of names) counts.set(subject(name), (counts.get(subject(name)) ?? 0) + 1);
  const main = new Set([...counts.entries()].filter(([word]) => word.length > 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word));
  return names
    .map((name, index) => {
      const line = abilityLine(name);
      return { ...line, rank: line.rank - (main.has(subject(name)) && line.rank < 10 ? 2 : 0), index };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((one) => one.text)
    .filter((text) => {
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

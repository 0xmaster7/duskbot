/** single words that keep their capital wherever they appear: other companies, their products, people, places, days */
export const KEEP_WORDS: ReadonlySet<string> = new Set([
  // companies and products
  "Agentcard", "Android", "Anthropic", "Antigravity", "Apple", "Azure", "Bionic", "Caddy", "Cerebras", "Chatterbox", "Chrome",
  "Claude", "Clef", "Cloudflare", "Codex", "Composio", "Cua", "Cursor", "Debian", "Discord", "Docker", "Electron", "Entra", "Firefox",
  "Foundry", "Gemini", "Gmail", "Google", "Greenference", "Grok", "Groq", "Jev", "Kimi", "Linux", "Mac", "Markdown",
  "Mermaid", "Meta", "Microsoft", "Mistral", "Moonshot", "Muse", "Node", "Notion", "Ollama", "OpenClaw", "Outlook", "Pi", "Podman",
  "PowerShell", "Qwen", "Reddit", "Safari", "Slack", "Stripe", "Tailscale", "Telegram", "Terminal", "Twitter", "Ubuntu",
  "Unsloth", "Venice", "Vercel", "Wayland", "Whop", "Windows", "Xorg", "Accessibility",
  // people and places
  "Milind", "Omkar", "Karan", "Bansal", "Europe", "Lisbon",
  // days, months, languages
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
  "English", "Japanese", "German", "French", "Spanish", "Italian", "Portuguese", "Russian", "Polish", "Turkish", "Ukrainian",
  "Vietnamese", "Chinese", "Korean", "Hindi",
  "Halloween",
]);

/** names of more than one word, or words that are only a name in one context */
export const KEEP_PHRASES: readonly string[] = [
  "System Settings → Privacy & Security → Microphone", "System Settings → Keyboard", "System Settings", "Privacy & Security",
  "Screen Recording", "Speech Recognition", "Microphone and Speech Recognition", "Dictation in System Settings → Keyboard", "Dictation in System Settings",
  "Authorization: Bearer", "Authorization, with Bearer", "Gmail, Calendar",
  "Home Screen", "App Store", "Google Play", "Apple Pay", "Google Pay", "G Pay", "Mac mini",
  "Dusk Bot", "Claude Code", "Hermes Agent", "Kimi Code", "Fish Audio", "LM Studio", "Google AI Studio", "Hacker News", "Vercel AI Gateway",
  "Cloudflare Workers AI", "OpenCode Zen, Go", "OpenCode Zen and Go", "DeepSeek Harness", "Grok Imagine", "Muse Wonder",
  "Cua Driver", "Node.js", "Wi-Fi", "Gmail, Calendar or Drive", "Outlook, Calendar or OneDrive", "Google Drive",
  "1Password", "AirPods Pro", "Google Calendar", "Google Sheets", "Google Docs", "Google Meet", "Microsoft Teams", "X Developer",
];

/** whole strings left alone: the remote desktop's key caps, drawn as keys */
export const EXEMPT_KEYS: readonly RegExp[] = [/^desktopViewer\.key/];

const PROTECT = new RegExp([
  "\\{[^}]*\\}",                                   // placeholders
  "`[^`]*`",                                       // code
  "\\b(?:https?|wss?|file)://[^\\s)]+",            // links
  "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",              // emails
  "~?[\\w.-]*/[\\w./~*-]+",                        // paths
  "\\b[\\w-]+\\.(?:md|json|js|mjs|ts|tsx|py|sh|txt|csv|tsv|png|jpe?g|webp|gif|pdf|zip|yaml|yml|toml|env|app|exe|dmg|log)\\b", // file names
  "\\b[A-Z][A-Za-z]*(?:[+–][A-Z][\\w/]*)+",        // key combos: Shift+Enter, Ctrl–Alt–Del
  ...[...KEEP_PHRASES].sort((a, b) => b.length - a.length).map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
].join("|"), "g");

const WORD = /[A-Za-z][A-Za-z'’]*/g;

function caseWord(word: string): string {
  const base = word.replace(/['’]s$/, "");
  if (KEEP_WORDS.has(base)) return word;
  if (/^I(['’][a-z]+)?$/.test(word) || word === "A") return word.toLowerCase();
  if (/^[A-Z][a-z]+(['’][a-z]+)?$/.test(word)) return word.toLowerCase();
  return word;
}

function caseRun(text: string): string {
  return text
      .replace(/\b([A-Z])-([A-Z][a-z]+)\b/g, (whole, letter: string, rest: string) => (KEEP_WORDS.has(rest) ? whole : `${letter.toLowerCase()}-${rest.toLowerCase()}`))
    .replace(WORD, caseWord);
}

/** Dusk writes its own words in lowercase; other companies' names keep the case they write them in. */
export function brandCase(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PROTECT)) {
    out += caseRun(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + caseRun(text.slice(last));
}

export function brandCaseEntry(key: string, value: string): string {
  return EXEMPT_KEYS.some((pattern) => pattern.test(key)) ? value : brandCase(value);
}

/** last key segments that are labels, whatever their value looks like: headings, buttons, tabs, field names, prompts */
const LABEL_LEAF = /^(title|heading|label|placeholder|aria\w*|tab|chip|menu|button|name|short|cta|tooltip|\w+(Title|Heading|Label|Placeholder|Name))$/i;

/** button, subject-line and step-name keys, wherever they sit */
const LABEL_PATH = /(^|\.)(dismiss|copy|subject|step)(\.|$)/;

/** keys that hold a message even when it has no closing full stop ("Resets in 5 days", "No messages yet") */
const MESSAGE_KEY = /(^|\.)(error|failed|banner|notices?|toasts?|resets?|resetsIn|empty|emptyHint|emptyBody|body|loadError|loadFailed|saveError|deleteError|openFailed)(\.|$)|(Error|Failed|Notice|Banner|Toast|Resets?)$/;

/** prompts the user sends as themselves; these read as typed, not as app messages */
const PROMPT_KEYS: readonly RegExp[] = [/^onboarding\.start\.job\./];

const wordCount = (value: string) => value.replace(/\{[^}]*\}/g, "x").trim().split(/\s+/).length;

/** the chat window: banners and notices (the corner cards over it, cloudIntro, twoPlaces, cloudNotice and routines.late, included), the helper's first-run greeting and its chips, composer, message actions, turn status lines, approval cards, thread errors. Everything here, buttons and fragments included, reads in sentence case. Sidebar and settings labels are not listed, so they stay lowercase; the bot panel has its own list below. */
const CHAT_KEYS = /^(chat|composer|approval|question|failedReply|toolStep|toolDetail|nativeUsage|notices?|contextWarning|secretCard|thread|conversation|ask|limits|error|needsYou|goalRun|trace|server\.status|cloudIntro|twoPlaces|cloudNotice|routines\.late|helperIntro)\./;

/** spoken-only or machine-read text keeps its case in the chat window too */
const CHAT_QUIET = /(^|\.)(aria\w*)(\.|$)/i;

/** words that sit between other chat pieces, never at the start of one */
const CHAT_FRAGMENTS = /^(chat\.event\.and|approval\.voice\.action\w+|helperIntro\.followup\.(botsNone|botOne|bots|routinesNone|routineOne|routines|more))$/;

/** the bot side panel (and a group chat's panel) owns these keys: every label, heading, button and row starts with a capital, as
 * messages do, and so do the cloud move sheets it opens (cloudMove, vpsMove) and its cloud desktop row (place.cloudDesktop). Words it shares
 * with the left sidebar, settings or a chat line get a copy of their own under botPanel.ui, and the move progress lines under botPanel.move.
 * The place hub's own words (runsOn.status, runsOn.hint) stay lowercase. */
const PANEL_KEYS = /^(botPanel|room\.(panel|jev|folder)|runsOn|cloudMove|vpsMove|place\.cloudDesktop)\./;
const PANEL_LOWER = /^runsOn\.(status|hint)\./;

/** the bots' own lines (server.*) are chat-window lines and read in sentence case, short status rows included; these are the
 * pieces the server fills into the middle of another line, so they stay lowercase */
const SERVER_FRAGMENTS = /^server\.(runs\.state|incidents\.where|reports\.(when|why))\.|^server\.(connect\.thisApp|rooms\.sameName\.chief|teammates\.(room|handedWork)|mcp\.card\.(newKey|newClientSecret))$/;

/** single labels outside the panel that read in sentence case too */
const SENTENCE_LABELS: ReadonlySet<string> = new Set(["sidebar.connectApps"]);

export function isPanelEntry(key: string): boolean {
  if (SENTENCE_LABELS.has(key)) return true;
  return PANEL_KEYS.test(key) && !PANEL_LOWER.test(key) && !CHAT_QUIET.test(key) && !EXEMPT_KEYS.some((pattern) => pattern.test(key)) && !PROMPT_KEYS.some((pattern) => pattern.test(key));
}

export function isChatEntry(key: string): boolean {
  return CHAT_KEYS.test(key) && !CHAT_FRAGMENTS.test(key) && !CHAT_QUIET.test(key) && !EXEMPT_KEYS.some((pattern) => pattern.test(key)) && !PROMPT_KEYS.some((pattern) => pattern.test(key));
}

/**
 * Whether a string is a full-sentence message (notice, banner, status or reset line, error, toast, empty state,
 * dialog body, sentence hint, the bots' own system lines) rather than a UI label.
 * Labels (buttons, nav, row titles, headings, menu items, tabs, chips) stay lowercase.
 */
export function isSentenceEntry(key: string, value: string): boolean {
  if (EXEMPT_KEYS.some((pattern) => pattern.test(key)) || PROMPT_KEYS.some((pattern) => pattern.test(key))) return false;
  if (isChatEntry(key) || isPanelEntry(key)) return true;
  if (key.startsWith("server.")) return !SERVER_FRAGMENTS.test(key);
  const leaf = key.split(".").pop() ?? key;
  if (LABEL_LEAF.test(leaf) || LABEL_PATH.test(key)) return false;
  const words = wordCount(value);
  if (MESSAGE_KEY.test(key) && words >= 3) return true;
  if (/^[^.!?]+\?$/.test(value.trim()) && words <= 6) return false; // a short question is a heading ("send on your behalf?")
  return words >= 3 && /[.!?]["”’)]*$/.test(value.trim());
}

const ABBREVIATION_BEFORE = /\b(?:e\.g|i\.e|etc|vs|approx)\.\s*$/i;

/** capitalises the first letter of each sentence, and the pronoun I; names, placeholders, code, links and "dusk" stay as they are */
export function sentenceCase(text: string): string {
  const spans = [...text.matchAll(PROTECT)].map((m) => [m.index as number, (m.index as number) + m[0].length] as const);
  const protectedAt = (index: number) => spans.some(([from, to]) => index >= from && index < to);
  const chars = text.split("");
  const starts = [0];
  // the sentence after a filled-in reason: "could not load: {reason} please try again"
  for (const m of text.matchAll(/\{(?:reason|detail|error|message|why)\}\s+/g)) starts.push((m.index as number) + m[0].length);
  for (const m of text.matchAll(/[.!?]["”’)]*\s+/g)) {
    const at = (m.index as number) + m[0].length;
    if (!ABBREVIATION_BEFORE.test(text.slice(0, at))) starts.push(at);
  }
  for (const start of starts) {
    const lead = text.slice(start).match(/^[“"'([]*/)?.[0].length ?? 0;
    const at = start + lead;
    if (protectedAt(at)) continue;
    const word = text.slice(at).match(/^[a-z][a-z'’]*(?![A-Za-z0-9_@/]|:\S)/)?.[0];
    if (!word || word === "dusk") continue;
    chars[at] = chars[at].toUpperCase();
  }
  const out = chars.join("");
  let result = "";
  let last = 0;
  const pronoun = (run: string) => run.replace(/\bi(?=['’][a-z]+\b|(?![\w.'’]))/g, "I");
  for (const [from, to] of spans) {
    result += pronoun(out.slice(last, from)) + out.slice(from, to);
    last = to;
  }
  return result + pronoun(out.slice(last));
}

/** the policy for one English entry: lowercase labels, sentence-case messages */
export function entryCase(key: string, value: string): string {
  const lowered = brandCaseEntry(key, value);
  return isSentenceEntry(key, value) ? sentenceCase(lowered) : lowered;
}

/** single words that keep their capital wherever they appear: other companies, their products, people, places, days */
export const KEEP_WORDS: ReadonlySet<string> = new Set([
  // companies and products
  "Agentcard", "Android", "Anthropic", "Antigravity", "Apple", "Azure", "Bionic", "Caddy", "Cerebras", "Chatterbox", "Chrome",
  "Claude", "Clef", "Cloudflare", "Codex", "Composio", "Cua", "Cursor", "Discord", "Docker", "Electron", "Entra", "Firefox",
  "Foundry", "Gemini", "Gmail", "Google", "Greenference", "Grok", "Groq", "Jev", "Kimi", "Linux", "Mac", "Markdown",
  "Mermaid", "Meta", "Microsoft", "Mistral", "Moonshot", "Muse", "Node", "Notion", "Ollama", "Outlook", "Pi", "Podman",
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
  "Dusk Bot", "Claude Code", "Kimi Code", "Fish Audio", "LM Studio", "Google AI Studio", "Hacker News", "Vercel AI Gateway",
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

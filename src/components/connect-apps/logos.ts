const FILES = import.meta.glob<string>("../../assets/app-logos/*.{png,svg}", { eager: true, import: "default" });

export interface AppLogo {
  src: string;
  /** A bare mark Grok sets inside the tile (68% of it) rather than an app icon that fills it. */
  padded?: boolean;
  /** The tile's own paint behind a mark that needs it. */
  background?: string;
  /** The mark's share of the tile when it isn't Grok's usual 68%. */
  scale?: number;
}

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string> = {
  twitter: "x", xtwitter: "x", jira: "atlassian", confluence: "atlassian", shopify: "shopifymerchant",
  onepassword: "1password", apollo: "apolloio", gohighlevel: "highlevel",
};

// grok fills the tile with app icons, and sets these bare marks inside it
const GROK_PADDED = new Set(["supabase", "cloudflare", "atlassian", "vercel", "posthog", "brevo", "shopifymerchant", "1password"]);
const BACKGROUND: Record<string, string> = { vercel: "#ffffff", sentry: "rgb(21 23 28)", "1password": "rgb(48 49 54)" };
const SCALE: Record<string, number> = { "1password": 0.55 };

const LOGOS = new Map<string, AppLogo>(Object.entries(FILES).map(([path, src]) => {
  const file = path.split("/").pop()!;
  const name = key(file.replace(/\.(png|svg)$/, ""));
  const mark = file.endsWith(".svg") || GROK_PADDED.has(name);
  return [name, { src, ...(mark ? { padded: true } : {}), ...(BACKGROUND[name] ? { background: BACKGROUND[name] } : {}), ...(SCALE[name] ? { scale: SCALE[name] } : {}) }];
}));

/** Grok's own logo for an app, or the brand mark we keep for it, by its id or its name. */
export function appLogo(...names: Array<string | null | undefined>): AppLogo | undefined {
  for (const name of names) {
    if (!name) continue;
    const id = key(name);
    const found = LOGOS.get(ALIASES[id] ?? id);
    if (found) return found;
  }
  return undefined;
}

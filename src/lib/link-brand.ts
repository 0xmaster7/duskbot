// grok sets a service's own mark before links to the apps it knows (github, notion, slack, figma) and the site's
// favicon before the rest; these are the hosts we keep a mark for.
const HOSTS: ReadonlyArray<readonly [host: string, logo: string, path?: RegExp]> = [
  ["github.com", "github"],
  ["notion.so", "notion"], ["notion.site", "notion"], ["notion.com", "notion"],
  ["slack.com", "slack"],
  ["figma.com", "figma"],
  ["linear.app", "linear"],
  ["docs.google.com", "google-docs", /^\/document\//],
  ["docs.google.com", "googlesheets", /^\/spreadsheets\//],
  ["docs.google.com", "google-slides", /^\/presentation\//],
  ["drive.google.com", "google-drive"],
  ["calendar.google.com", "google-calendar"],
  ["mail.google.com", "gmail"],
  ["x.com", "x"], ["twitter.com", "x"],
  ["dropbox.com", "dropbox"],
  ["discord.com", "discord"], ["discord.gg", "discord"],
  ["reddit.com", "reddit"],
  ["trello.com", "trello"],
  ["airtable.com", "airtable"],
  ["asana.com", "asana"],
];

/** Bare marks drawn dark on transparent: grok plates them in white on a dark theme. */
export const PLATED_LOGOS: ReadonlySet<string> = new Set(["github"]);

export function linkBrand(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const found = HOSTS.find(([domain, , path]) => (host === domain || host.endsWith(`.${domain}`)) && (!path || path.test(url.pathname)));
  return found ? found[1] : null;
}

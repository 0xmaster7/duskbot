// Refuses when BOT_DESKTOP_IMAGE (shared/bot-desktop.ts) is not published where servers pull it: anonymously, with an
// image for both linux/amd64 and linux/arm64. A server build or release pointing at an image nobody can pull leaves
// every new bot computer unable to start, so both run this first.
//
//   node scripts/check-bot-desktop-published.mjs            # exit 1 with the reason when it is not
//   node scripts/check-bot-desktop-published.mjs --image ghcr.io/owner/name:tag
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLATFORMS = ["linux/amd64", "linux/arm64"];

export function botDesktopImage() {
  const source = readFileSync(join(root, "shared", "bot-desktop.ts"), "utf8");
  const match = /^export const BOT_DESKTOP_IMAGE = "([^"]+)";/m.exec(source);
  if (!match) throw new Error("shared/bot-desktop.ts has no BOT_DESKTOP_IMAGE");
  return match[1];
}

/** ghcr.io/<owner>/<name>:<tag> only: the registry the workflow publishes to. */
export function parseGhcrImage(image) {
  const match = /^ghcr\.io\/([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.exec(image);
  if (!match) throw new Error(`${image} is not a ghcr.io/<owner>/<name>:<tag> image`);
  return { repository: match[1], tag: match[2] };
}

/** The platforms the published tag serves, or the reason it can't be pulled anonymously. */
export async function publishedPlatforms(image, fetchImpl = fetch) {
  const { repository, tag } = parseGhcrImage(image);
  const tokenResponse = await fetchImpl(`https://ghcr.io/token?scope=repository:${repository}:pull`);
  if (!tokenResponse.ok) return { error: `${image} can't be pulled without signing in (the package is private or missing): make it public` };
  const { token } = await tokenResponse.json();
  const manifest = await fetchImpl(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
    },
  });
  if (manifest.status === 404) return { error: `${image} is not published: run the "Bot computer image" workflow` };
  if (!manifest.ok) return { error: `${image} can't be pulled without signing in (HTTP ${manifest.status}): make the package public` };
  const body = await manifest.json();
  const platforms = (body.manifests ?? [])
    .map((entry) => entry.platform && `${entry.platform.os}/${entry.platform.architecture}`)
    .filter(Boolean);
  return { platforms };
}

export async function checkBotDesktopPublished(image = botDesktopImage(), fetchImpl = fetch) {
  const result = await publishedPlatforms(image, fetchImpl);
  if (result.error) return result.error;
  const missing = PLATFORMS.filter((platform) => !result.platforms.includes(platform));
  return missing.length ? `${image} is published without ${missing.join(" and ")}` : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--image");
  const image = at === -1 ? botDesktopImage() : process.argv[at + 1];
  const problem = await checkBotDesktopPublished(image).catch((error) => `${image} could not be checked: ${error.message}`);
  if (problem) {
    console.error(`bot computer image: ${problem}`);
    process.exit(1);
  }
  console.log(`bot computer image: ${image} is published for ${PLATFORMS.join(" and ")}`);
}

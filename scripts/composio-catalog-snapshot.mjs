// Writes the bundled Composio catalog Connect apps shows when the live one is unavailable (no broker, no key), and
// fills in what the live one leaves out (counts, sign-in kinds, actions).
//
// The source is Composio's own public docs data (MIT), the file docs.composio.dev renders its toolkit pages from, so
// no API key is needed:
//   node scripts/composio-catalog-snapshot.mjs                 fetch the latest from GitHub
//   node scripts/composio-catalog-snapshot.mjs --from file.json use a downloaded copy
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "ComposioHQ/composio";
const BRANCH = "next";
const PATH = "docs/public/data/toolkits.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "composio");
// keep in sync with src/components/connect-apps/composio-snapshot.ts
const SHARDS = 16;
const ACTIONS_KEPT = 30;

export function shardOf(slug) {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % SHARDS;
}

const defaultLogo = (slug) => `https://logos.composio.dev/api/${slug}`;
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/\u2014/g, ", ").trim();

export function snapshotOf(toolkits) {
  const seen = new Set();
  const list = [];
  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const raw of toolkits) {
    const slug = String(raw.slug ?? "").trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const auth = [...new Set((raw.authSchemes ?? []).map(String))];
    const entry = { slug, name: clean(raw.name) || slug, description: clean(raw.description), category: clean(raw.category).toLowerCase() };
    if (raw.logo && raw.logo !== defaultLogo(slug)) entry.logo = raw.logo;
    if (auth.length) entry.auth = auth;
    if ((raw.composioManagedAuthSchemes ?? []).length) entry.managed = true;
    entry.tools = Number(raw.toolCount ?? raw.tools?.length ?? 0);
    if (Number(raw.triggerCount)) entry.triggers = Number(raw.triggerCount);
    list.push(entry);
    const actions = (raw.tools ?? []).slice(0, ACTIONS_KEPT).map((tool) => clean(tool.name)).filter(Boolean);
    const triggers = (raw.triggers ?? []).slice(0, ACTIONS_KEPT).map((trigger) => clean(trigger.name)).filter(Boolean);
    if (actions.length || triggers.length) shards[shardOf(slug)][slug] = { actions, ...(triggers.length ? { triggers } : {}) };
  }
  return { list, shards };
}

async function main() {
  const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;
  let text;
  let commit = null;
  if (from) text = readFileSync(from, "utf8");
  else {
    const latest = await fetch(`https://api.github.com/repos/${REPO}/commits?path=${PATH}&sha=${BRANCH}&per_page=1`).then((response) => response.json());
    commit = Array.isArray(latest) ? latest[0]?.sha ?? null : null;
    const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit ?? BRANCH}/${PATH}`);
    if (!response.ok) throw new Error(`fetch ${PATH}: HTTP ${response.status}`);
    text = await response.text();
  }
  const { list, shards } = snapshotOf(JSON.parse(text));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "actions"), { recursive: true });
  const about = {
    source: `https://github.com/${REPO}/blob/${commit ?? BRANCH}/${PATH}`,
    sha256: createHash("sha256").update(text).digest("hex"),
    fetched: new Date().toISOString().slice(0, 10),
    count: list.length,
  };
  writeFileSync(join(OUT, "toolkits.json"), `${JSON.stringify({ ...about, toolkits: list })}\n`);
  shards.forEach((shard, index) => writeFileSync(join(OUT, "actions", `${index}.json`), `${JSON.stringify(shard)}\n`));
  writeFileSync(join(OUT, "README.md"), [
    "# Composio toolkit catalog",
    "",
    `- **toolkits.json**: ${list.length} toolkits (slug, name, description, category, sign-in kinds, action and trigger counts; a logo only where it is not \`logos.composio.dev/api/<slug>\`).`,
    `- **actions/*.json**: the first ${ACTIONS_KEPT} action and trigger names of each toolkit, in ${SHARDS} files a detail page loads one at a time.`,
    "",
    `Source: [Composio's docs data](${about.source}) (MIT), SHA-256 \`${about.sha256}\`, fetched ${about.fetched}. Regenerate with \`node scripts/composio-catalog-snapshot.mjs\`.`,
    "Connect apps shows this list when the live catalog is unavailable and merges it under the live one when it is.",
    "",
  ].join("\n"));
  console.log(`wrote ${list.length} toolkits to ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

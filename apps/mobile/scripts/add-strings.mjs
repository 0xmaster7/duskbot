// merges new English strings into src/locales/en.json: node apps/mobile/scripts/add-strings.mjs strings.json
// refuses to overwrite an existing key with different text, so parallel writers cannot clobber each other
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../../../src/locales/en.json", import.meta.url));
const add = JSON.parse(readFileSync(process.argv[2], "utf8"));
const en = JSON.parse(readFileSync(target, "utf8"));
let added = 0;
for (const [key, text] of Object.entries(add)) {
  if (!key.startsWith("mobile.")) throw new Error(`not a mobile key: ${key}`);
  if (typeof text !== "string" || /—/.test(text)) throw new Error(`bad text for ${key}`);
  if (key in en && en[key] !== text) throw new Error(`${key} already says "${en[key]}"`);
  if (!(key in en)) { en[key] = text; added++; }
}
const tmp = `${target}.${process.pid}.tmp`;
writeFileSync(tmp, `${JSON.stringify(en, null, 2)}\n`);
renameSync(tmp, target);
console.log(`added ${added} strings`);

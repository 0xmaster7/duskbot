import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { entryCase } from "../src/locales/brand-case.ts";

const dir = new URL("../src/locales/", import.meta.url);
const enPath = new URL("en.json", dir);
const hashPath = new URL("source-hashes.json", dir);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const raw = readFileSync(enPath, "utf8");
const en = JSON.parse(raw) as Record<string, string>;
const hashes = JSON.parse(readFileSync(hashPath, "utf8")) as { version: number; locales: Record<string, Record<string, string>> };
let changed = 0;
let rehashed = 0;
for (const [key, before] of Object.entries(en)) {
  const after = entryCase(key, before);
  if (after === before) continue;
  changed += 1;
  en[key] = after;
  // a translation current against the old English is current against the same words in lowercase
  for (const record of Object.values(hashes.locales)) {
    if (record[key] === hash(before)) { record[key] = hash(after); rehashed += 1; }
  }
}
const indent = raw.match(/^\{\n( +)/)?.[1] ?? "  ";
writeFileSync(enPath, `${JSON.stringify(en, null, indent)}${raw.endsWith("\n") ? "\n" : ""}`);
const hashRaw = readFileSync(hashPath, "utf8");
writeFileSync(hashPath, `${JSON.stringify(hashes, null, hashRaw.match(/^\{\n( +)/)?.[1] ?? "  ")}${hashRaw.endsWith("\n") ? "\n" : ""}`);
console.log(`${changed} strings recased, ${rehashed} translation hashes carried over`);

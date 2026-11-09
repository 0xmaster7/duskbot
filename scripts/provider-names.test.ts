import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_NAME, PROVIDER_WORD, SHIPPED_PATHS } from "./provider-names.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|mp3|mp4|wav|zip|gz|tgz|wasm|node|dylib|so|exe|pdf)$/i;

function shippedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...SHIPPED_PATHS], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter(Boolean);
}

describe("the managed cloud's provider is not named in what ships", () => {
  it("in no shipped file's path or contents", () => {
    const files = shippedFiles();
    expect(files.length).toBeGreaterThan(1000);
    const named: string[] = [];
    for (const file of files) {
      if (PROVIDER_NAME.test(file)) { named.push(`${file} (path)`); continue; }
      if (BINARY.test(file)) continue;
      let text: string;
      try { text = readFileSync(join(ROOT, file), "utf8"); } catch { continue; }
      text.split("\n").forEach((line, index) => { if (PROVIDER_NAME.test(line)) named.push(`${file}:${index + 1}`); });
    }
    expect(named).toEqual([]);
  });

  it("catches the name in any case", () => {
    for (const text of [PROVIDER_WORD, PROVIDER_WORD.toLowerCase(), `${PROVIDER_WORD.toLowerCase()}.dev`, `place.${PROVIDER_WORD.toLowerCase()}.title`]) expect(PROVIDER_NAME.test(text), text).toBe(true);
  });
});

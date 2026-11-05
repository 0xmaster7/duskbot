import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// the theme has a colour named `inset`, so tailwind's ring-inset also sets the ring colour to it and can override the
// ring colour beside it; inset-ring draws the same inside hairline with no such clash.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("inside hairlines", () => {
  it("use inset-ring, never ring-inset", () => {
    const offenders = sourceFiles(srcRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g)]
        .filter((match) => /(^|[\s:])ring-inset(?=$|\s)/.test(match[1] ?? match[2] ?? match[3] ?? ""))
        .map((match) => `${relative(srcRoot, path)}:${source.slice(0, match.index).split("\n").length}`);
    });
    expect(offenders).toEqual([]);
  });
});
